/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`. */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ClaudeService } from '../../src/ia/claude.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

/** IA falsa: devolve o que o teste preparar, a partir do que recebeu. */
class IaFalsa {
  ligada = false;
  pedidos: { sistema: string; conteudo: string }[] = [];
  responder: (conteudo: string) => unknown = () => null;
  get disponivel() {
    return this.ligada;
  }
  extrair(_e: z.ZodType, p: { sistema: string; conteudo: string }) {
    this.pedidos.push(p);
    return Promise.resolve(this.responder(p.conteudo));
  }
  escrever() {
    return Promise.resolve('');
  }
}

/**
 * "Pergunte ao concelho": pergunta → análise com suporte; sem IA → contagens;
 * poucos dados; sem dados pessoais mesmo que a IA os devolva; permissões;
 * auditoria; guardar e partilhar.
 */
describe('Pergunte ao concelho (e2e)', () => {
  let ctx: Contexto;
  const ia = new IaFalsa();
  let chefe: Record<string, string>;
  const sufixo = randomUUID().slice(0, 6);
  const FREG = `Vila Alta ${sufixo}`;
  const PEQUENA = `Vila Baixa ${sufixo}`;
  const NOME = `Joaquina Testemunha${sufixo.replace(/\d/g, '')}`;
  let temaId: string;
  const ids: string[] = [];

  async function conversa(o: {
    freguesia: string;
    dias: number;
    resumo: string;
    frases: string[];
    municipeId?: string | null;
  }) {
    const c = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO conversas (municipio_id, municipe_id, canal, iniciada_em, terminada_em, resultado, tema_id, resumo, freguesia)
       VALUES ($1, $2, 'telefone', now() - make_interval(days => $3) - interval '1 hour',
               now() - make_interval(days => $3) - interval '50 minutes', 'resolvida', $4, $5, $6)
       RETURNING id`,
      [
        MUNICIPIO_ID,
        o.municipeId ?? null,
        o.dias,
        temaId,
        o.resumo,
        o.freguesia,
      ],
    );
    for (const [i, f] of o.frases.entries()) {
      await ctx.db.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto) VALUES ($1, $2, 'municipe', $3)`,
        [c!.id, i + 1, f],
      );
    }
    return c!.id;
  }

  const analisar = (corpo: object, h = chefe) =>
    ctx.http().post('/v1/painel/concelho/analisar').set(h).send(corpo);

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ClaudeService).useValue(ia),
    });
    chefe = await entrarPainel(ctx);
    temaId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO temas (municipio_id, nome) VALUES ($1, $2) RETURNING id`,
      [MUNICIPIO_ID, `Estacionamento ${sufixo}`],
    ))!.id;
    const mu = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, $3) RETURNING id`,
      [MUNICIPIO_ID, novoTelefone(), NOME],
    );
    // 12 nos últimos 7 dias, 3 antes (para comparar).
    for (let i = 0; i < 12; i++) {
      ids.push(
        await conversa({
          freguesia: FREG,
          dias: i % 6,
          municipeId: i === 0 ? mu!.id : null,
          resumo: `Não há onde estacionar desde a obra; número ${i}.`,
          frases:
            i === 0
              ? [
                  `Sou a ${NOME}, moro na Rua Direita, 12, o meu telefone é 912 345 678 e não há onde estacionar.`,
                ]
              : [
                  'Desde que começou a obra não há um único lugar para estacionar perto de casa.',
                ],
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      await conversa({
        freguesia: FREG,
        dias: 40 + i,
        resumo: 'Perguntou pelo dístico de residente.',
        frases: ['Como é que peço o dístico de residente para a minha rua?'],
      });
    }
    for (let i = 0; i < 3; i++) {
      await conversa({
        freguesia: PEQUENA,
        dias: 2,
        resumo: 'Queixa de estacionamento.',
        frases: ['Ninguém consegue estacionar na praça desde a feira.'],
      });
    }
  });
  afterAll(() => ctx.fechar());

  it('sem IA: contagens, palavras e a explicação de que a IA está indisponível', async () => {
    ia.ligada = false;
    const r = await analisar({
      pergunta: `O que irrita as pessoas em ${FREG} esta semana?`,
    }).expect(200);
    expect(r.body.ia).toBe(false);
    expect(r.body.motivo_sem_ia).toMatch(/indisponível/);
    expect(r.body.filtros.freguesias).toEqual([FREG]);
    expect(r.body.filtros.deduzidos).toEqual(
      expect.arrayContaining(['periodo', 'freguesias']),
    );
    expect(r.body.conversas.total).toBe(12);
    expect(r.body.conversas.lidas).toBe(12);
    expect(r.body.poucos_dados).toBe(false);
    expect(r.body.contagens.temas[0]).toMatchObject({
      n: 12,
      chave: `Estacionamento ${sufixo}`,
    });
    expect(
      r.body.palavras.map((p: { palavra: string }) => p.palavra),
    ).toContain('estacionar');
    expect(r.body.citacoes.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(
      /912 345 678|Joaquina|Rua Direita, 12/,
    );
    expect(ia.pedidos).toHaveLength(0);
  });

  it('com IA: temas com suporte, números nossos, nada pessoal mesmo que a IA o devolva', async () => {
    ia.ligada = true;
    ia.pedidos = [];
    ia.responder = (conteudo) => {
      const refs = [...conteudo.matchAll(/^(C\d+) ·/gm)].map((m) => m[1]);
      const excertos = [...conteudo.matchAll(/^ {2}(E\d+): /gm)].map(
        (m) => m[1],
      );
      return {
        sintese: `A ${NOME} (912 345 678, NIF 123456789) diz que 90% não tem lugar. Mora na Rua Direita, 12.`,
        temas: [
          {
            tema: 'Falta de estacionamento depois da obra',
            descricao: 'Não há lugares perto de casa.',
            conversas: [...refs.slice(0, 8), 'C999'],
            causas: [
              {
                texto: 'A obra ocupou os lugares',
                conversas: refs.slice(0, 3),
              },
            ],
          },
          {
            tema: 'Sem suporte',
            descricao: 'Inventado',
            conversas: [],
            causas: [],
          },
        ],
        irritacao: refs.map((r, i) => ({ conversa: r, nivel: i < 4 ? 3 : 1 })),
        citacoes: excertos
          .slice(0, 4)
          .map((e) => ({ excerto: e, tema: 'Estacionamento' })),
        sugestoes: [
          {
            texto: `Ligar à ${NOME} para o 912345678`,
            tema: 'Estacionamento',
            conversas: refs.slice(0, 2),
          },
          { texto: 'Sem factos', tema: 'x', conversas: [] },
        ],
      };
    };
    const r = await analisar({
      pergunta: 'O que sentem as pessoas?',
      filtros: { freguesias: [FREG] },
    }).expect(200);
    expect(r.body.ia).toBe(true);
    // O que a IA leu já ia sem dados pessoais.
    expect(ia.pedidos[0].conteudo).not.toMatch(
      /912 345 678|Joaquina|Rua Direita, 12/,
    );
    const a = r.body.analise;
    expect(a.temas).toHaveLength(1);
    expect(a.temas[0].conversas_n).toBe(8);
    expect(a.temas[0].pct_lidas).toBe(66.7);
    expect(a.temas[0].conversas.every((id: string) => ids.includes(id))).toBe(
      true,
    );
    expect(a.temas[0].causas[0].conversas_n).toBe(3);
    expect(a.irritacao.conversas_classificadas).toBe(12);
    expect(a.sugestoes).toHaveLength(1);
    expect(a.citacoes.length).toBeGreaterThan(0);
    expect(a.texto_verificado).toBe(false);
    const tudo = JSON.stringify(r.body);
    expect(tudo).not.toMatch(
      /912 ?345 ?678|123456789|Joaquina|Testemunha|Rua Direita, 12|90%/,
    );
    expect(r.body.pode_ver_conversas).toBe(true);
  });

  it('poucos dados: aviso e sem frases (ninguém se reconhece)', async () => {
    ia.ligada = false;
    const r = await analisar({
      pergunta: 'Do que se queixam?',
      filtros: { freguesias: [PEQUENA] },
    }).expect(200);
    expect(r.body.conversas.total).toBe(3);
    expect(r.body.poucos_dados).toBe(true);
    expect(r.body.avisos.join(' ')).toMatch(/Poucos dados/);
    expect(r.body.citacoes).toEqual([]);
  });

  it('sem conversas: diz que não há dados', async () => {
    const r = await analisar({
      pergunta: 'E aqui?',
      filtros: { freguesias: [`Nenhuma ${sufixo}`] },
    }).expect(200);
    expect(r.body.conversas.total).toBe(0);
    expect(r.body.avisos[0]).toMatch(/Não há conversas/);
  });

  it('permissões: atendimento não entra; vereador vê contagens mas não os ids', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await analisar({ pergunta: 'O que sentem?' }, atendimento).expect(403);
    await ctx
      .http()
      .get('/v1/painel/concelho/opcoes')
      .set(atendimento)
      .expect(403);

    ia.ligada = true;
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    const r = await analisar(
      { pergunta: 'O que sentem?', filtros: { freguesias: [FREG] } },
      vereador,
    ).expect(200);
    expect(r.body.pode_ver_conversas).toBe(false);
    expect(r.body.analise.temas[0].conversas).toBeNull();
    expect(r.body.analise.temas[0].conversas_n).toBe(8);
    expect(
      r.body.analise.citacoes.every(
        (c: { conversa_id: unknown }) => c.conversa_id === null,
      ),
    ).toBe(true);
  });

  it('auditoria, histórico e guardar/partilhar', async () => {
    ia.ligada = false;
    const r = await analisar({
      pergunta: `Como está ${FREG}?`,
    }).expect(200);
    const id = r.body.id as string;
    const audit = await linhas(
      ctx.db,
      `SELECT acao, dados FROM audit_log WHERE objeto_tipo = 'analise_concelho' AND objeto_id = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].acao).toBe('perguntar_concelho');
    expect(audit[0].dados.conversas_total).toBe(12);

    const hist = await ctx
      .http()
      .get('/v1/painel/concelho/analises')
      .set(chefe)
      .expect(200);
    expect(hist.body.itens.map((x: { id: string }) => x.id)).toContain(id);

    // Outro utilizador não vê o que não foi guardado.
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .get(`/v1/painel/concelho/analises/${id}`)
      .set(tecnico)
      .expect(404);

    const g = await ctx
      .http()
      .post(`/v1/painel/concelho/analises/${id}/guardar`)
      .set(chefe)
      .send({ titulo: 'Estacionamento depois da obra' })
      .expect(200);
    expect(g.body.titulo).toBe('Estacionamento depois da obra');
    const partilhada = await ctx
      .http()
      .get(`/v1/painel/concelho/analises/${id}`)
      .set(tecnico)
      .expect(200);
    expect(partilhada.body.conversas.total).toBe(12);
    const guardadas = await ctx
      .http()
      .get('/v1/painel/concelho/analises?guardadas=true')
      .set(tecnico)
      .expect(200);
    expect(guardadas.body.itens.map((x: { id: string }) => x.id)).toContain(id);
    const ag = await linha(
      ctx.db,
      `SELECT count(*)::int AS n FROM audit_log WHERE objeto_id = $1 AND acao = 'guardar_analise_concelho'`,
      [id],
    );
    expect(ag!.n).toBe(1);
  });

  it('opções e sinais gerados a partir dos dados', async () => {
    const o = await ctx
      .http()
      .get('/v1/painel/concelho/opcoes')
      .set(chefe)
      .expect(200);
    expect(o.body.freguesias).toEqual(expect.arrayContaining([FREG, PEQUENA]));
    expect(o.body.escala_irritacao).toHaveLength(4);
    const s = await ctx
      .http()
      .get('/v1/painel/concelho/sinais')
      .set(chefe)
      .expect(200);
    const sinal = s.body.sinais.find((x: { texto: string }) =>
      x.texto.startsWith(`${FREG}:`),
    );
    expect(sinal).toBeDefined();
    expect(sinal.filtros.freguesias).toEqual([FREG]);
  });
});
