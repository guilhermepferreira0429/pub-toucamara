/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { LicencasService } from '../../src/modules/licencas/licencas.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
  pedirLicenca,
  smsPara,
} from './app';

/** Um dia útil daqui a `dias` dias (AAAA-MM-DD). */
function daquiA(dias = 25): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** O próximo sábado com pelo menos 10 dias de distância. */
function sabadoDistante(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 10);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Pedidos que cumprem todas as regras por omissão, com todos os dados. */
const CUMPRE: Record<string, { dados: Record<string, unknown> }> = {
  ruido: {
    dados: {
      atividade: 'festa_privada',
      descricao: 'Festa de anos no quintal',
      morada: 'Rua do Teste 10, Guimarães',
      data: sabadoDistante(),
      hora_inicio: '20:00',
      hora_fim: '01:00',
      pessoas: 40,
      musica_amplificada: true,
    },
  },
  ocupacao_via: {
    dados: {
      equipamento: 'andaime',
      descricao: 'Pintar a fachada',
      morada: 'Rua de Santo António 10, Guimarães',
      data_inicio: daquiA(),
      dias: 10,
      area_m2: 12,
      passeio_livre_m: 1.5,
      ocupa_estrada: false,
    },
  },
  esplanada: {
    dados: {
      estabelecimento: 'Café do Teste',
      morada: 'Largo do Toural 5, Guimarães',
      data_inicio: daquiA(),
      meses: 6,
      area_m2: 12,
      mesas: 4,
      passeio_livre_m: 2,
      estrado: false,
      centro_historico: false,
    },
  },
  distico_residente: {
    dados: {
      morada: 'Rua Nova 5, Guimarães',
      matricula: 'AA-12-BB',
      disticos_ja_tem: 0,
      morada_comprovada: true,
      viatura_em_nome: true,
    },
  },
  publicidade: {
    dados: {
      suporte: 'placa',
      estabelecimento: 'Sapataria do Teste',
      mensagem: 'Sapataria',
      morada: 'Rua da Rainha 4, Guimarães',
      largura_m: 2,
      altura_m: 1,
      iluminado: false,
      no_proprio_estabelecimento: true,
      centro_historico: false,
      data_inicio: daquiA(),
      meses: 6,
    },
  },
  recinto_improvisado: {
    dados: {
      descricao: 'Arraial do teste',
      morada: 'Largo da Oliveira, Guimarães',
      data_inicio: daquiA(),
      dias: 2,
      lotacao: 100,
      estruturas: ['palco'],
      musica: false,
    },
  },
};

/**
 * "Os humanos só tratam das exceções" e "Regras públicas e verificáveis":
 * dentro das regras decide-se sozinho em todos os tipos; as exceções vão a
 * uma pessoa com o motivo concreto; a câmara escolhe por tipo; as regras,
 * o histórico, o verificador e o "porque foi aprovada" são públicos.
 */
describe('Regras públicas e decisão automática (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  async function licencaDe(numero: string) {
    const l = await linha<{
      id: string;
      processo_id: string;
      codigo_verificacao: string;
    }>(
      ctx.db,
      `SELECT l.id, l.processo_id, l.codigo_verificacao
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [numero],
    );
    if (!l) throw new Error(`Licença ${numero} não encontrada`);
    return l;
  }

  async function pagar(processoId: string) {
    const l = await linha(
      ctx.db,
      `SELECT lc.codigo FROM pagamentos pg
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE pg.processo_id = $1 ORDER BY lc.expira_em DESC LIMIT 1`,
      [processoId],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${l.codigo}/simular-pagamento`)
      .send({})
      .expect((r) => expect([200, 201]).toContain(r.status));
  }

  /** Pede pela ferramenta, paga se houver taxa e corre o job; devolve o detalhe do painel. */
  async function pedirEPagar(
    tipo: string,
    mudanca: Record<string, unknown> = {},
    telefone?: string,
  ) {
    const c = CUMPRE[tipo];
    const chamada = {
      ...novaChamada(tipo.slice(0, 3)),
      ...(telefone ? { telefone } : {}),
    };
    const r = await pedirLicenca(ctx, chamada, tipo, {
      ...c.dados,
      ...mudanca,
    }).expect(200);
    const l = await licencaDe(r.body.numero);
    if (r.body.pagamento) await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const d = await ctx
      .http()
      .get(`/v1/painel/licencas/${l.id}`)
      .set(chefe)
      .expect(200);
    return { r: r.body, d: d.body, l };
  }

  describe('os humanos só tratam das exceções', () => {
    it.each(Object.keys(CUMPRE))(
      '%s: cumpre as regras → decidida automaticamente e emitida (com QR), sem clique',
      async (tipo) => {
        const { r, d } = await pedirEPagar(tipo);
        expect(r).toMatchObject({ proposta: 'aprovar', decisao: 'automatica' });
        expect(d).toMatchObject({
          estado: 'emitida',
          decisao: 'automatica',
          decidida_por_nome: null,
          excecao: [],
          codigo_verificacao: expect.stringMatching(/^[A-Z0-9]{10}$/),
        });
        const pub = await ctx
          .http()
          .get(`/v1/public/licencas/${d.codigo_verificacao}`)
          .expect(200);
        expect(pub.body).toMatchObject({
          valida: true,
          decidida_automaticamente: true,
          pdf: true,
        });
      },
    );

    it('publicidade sem taxa: emitida logo na chamada, com o SMS do QR', async () => {
      const telefone = `+3519${String(Date.now()).slice(-8)}`;
      const { r, d } = await pedirEPagar(
        'publicidade',
        { largura_m: 1, altura_m: 0.5 },
        telefone,
      );
      expect(r).toMatchObject({
        pagamento: null,
        emitida: true,
        dizer: expect.stringContaining('emitida já'),
      });
      expect(d.estado).toBe('emitida');
      const sms = await smsPara(ctx, telefone);
      expect(sms.map((s) => s.corpo).join(' ')).toContain('/licenca/');
    });

    it('viola uma regra → exceção para técnico, com o motivo concreto no painel', async () => {
      const { r, d } = await pedirEPagar('ruido', { pessoas: 500 });
      expect(r).toMatchObject({ proposta: 'tecnico', decisao: 'excecao' });
      expect(d).toMatchObject({ estado: 'para_tecnico', decisao: 'excecao' });
      expect(d.excecao).toEqual([
        expect.objectContaining({
          tipo: 'regra',
          id: 'pessoas',
          rotulo: 'Número de pessoas',
          texto: expect.stringContaining('500 pessoas'),
        }),
      ]);
    });

    it('falta um dado que a regra usa → exceção: paga, mas fica à espera de uma pessoa', async () => {
      const sem = Object.fromEntries(
        Object.entries(CUMPRE.ruido.dados).filter(([k]) => k !== 'pessoas'),
      );
      const r = await pedirLicenca(
        ctx,
        novaChamada('rui'),
        'ruido',
        sem,
      ).expect(200);
      expect(r.body).toMatchObject({
        proposta: 'aprovar',
        decisao: 'excecao',
        dizer: expect.stringContaining('um funcionário confirma'),
      });
      const l = await licencaDe(r.body.numero);
      await pagar(l.processo_id);
      await ctx.app.get(LicencasService).sincronizar();
      const d = await ctx
        .http()
        .get(`/v1/painel/licencas/${l.id}`)
        .set(chefe)
        .expect(200);
      // Pago, mas nada que não se saiba é aprovado sozinho.
      expect(d.body).toMatchObject({
        estado: 'por_aprovar',
        decisao: 'excecao',
      });
      expect(d.body.excecao).toEqual([
        expect.objectContaining({ tipo: 'dado_em_falta', id: 'pessoas' }),
      ]);
      // Uma pessoa confirma com um clique.
      await ctx
        .http()
        .post(`/v1/painel/licencas/${l.id}/aprovar`)
        .set(chefe)
        .expect(200);
    });

    it('nem forçando a BD: uma licença marcada automática mas com uma regra falhada não se emite sozinha', async () => {
      const r = await pedirLicenca(
        ctx,
        novaChamada('rui'),
        'ruido',
        CUMPRE.ruido.dados,
      ).expect(200);
      const l = await licencaDe(r.body.numero);
      await ctx.db.query(
        `UPDATE licencas SET avaliacao = jsonb_set(avaliacao, '{regras,0,ok}', 'false') WHERE id = $1`,
        [l.id],
      );
      await pagar(l.processo_id);
      await ctx.app.get(LicencasService).sincronizar();
      const d = await ctx
        .http()
        .get(`/v1/painel/licencas/${l.id}`)
        .set(chefe)
        .expect(200);
      expect(d.body.estado).toBe('por_aprovar');
    });

    it('a câmara escolhe por tipo (só a chefia, com auditoria e histórico); o indicador mostra a % e os motivos', async () => {
      const tecnico = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      await ctx
        .http()
        .put('/v1/painel/licencas/aprovacao/esplanada')
        .set(tecnico)
        .send({ aprovacao: 'funcionario' })
        .expect(403);
      await ctx
        .http()
        .put('/v1/painel/licencas/aprovacao/esplanada')
        .set(chefe)
        .send({ aprovacao: 'talvez' })
        .expect(400);
      // Outros ficheiros também mudam as regras (a BD é partilhada).
      const antes =
        (
          await linha<{ v: number | null }>(
            ctx.db,
            `SELECT max(versao) AS v FROM regras_versoes
             WHERE municipio_id = $1 AND ambito = 'licenca' AND chave = 'esplanada'`,
            [MUNICIPIO_ID],
          )
        )?.v ?? 1;
      const m = await ctx
        .http()
        .put('/v1/painel/licencas/aprovacao/esplanada')
        .set(chefe)
        .send({ aprovacao: 'funcionario' })
        .expect(200);
      expect(m.body).toMatchObject({
        aprovacao: 'funcionario',
        mudou: true,
        versao: antes + 1,
      });
      const audit = await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE acao = 'mudar_aprovacao_licenca' AND municipio_id = $1
         ORDER BY em DESC LIMIT 1`,
        [MUNICIPIO_ID],
      );
      expect(audit.dados).toMatchObject({
        tipo: 'esplanada',
        versao: antes + 1,
        alteracoes: [
          expect.objectContaining({
            campo: 'aprovacao',
            depois: 'um funcionário confirma',
          }),
        ],
      });

      // Agora, dentro das regras, um funcionário confirma.
      const { r, d } = await pedirEPagar('esplanada');
      expect(r.decisao).toBe('funcionario');
      expect(d).toMatchObject({
        estado: 'por_aprovar',
        decisao: 'funcionario',
      });

      // Indicador (quem trata dos processos vê; quem atende não).
      await ctx
        .http()
        .get('/v1/painel/licencas/indicador')
        .set(atendimento)
        .expect(403);
      const ind = await ctx
        .http()
        .get('/v1/painel/licencas/indicador')
        .set(tecnico)
        .expect(200);
      expect(ind.body.dias).toBe(30);
      expect(ind.body.total).toBeGreaterThan(0);
      expect(ind.body.automatica).toBeGreaterThanOrEqual(6);
      const ruido = ind.body.por_tipo.find(
        (x: { tipo: string }) => x.tipo === 'ruido',
      );
      expect(ruido.excecao).toBeGreaterThanOrEqual(2);
      expect(ruido.pct_automatica).toBe(
        Math.round((ruido.automatica / ruido.total) * 100),
      );
      expect(ruido.motivos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tipo: 'regra',
            id: 'pessoas',
            rotulo: 'Número de pessoas',
          }),
          expect.objectContaining({ tipo: 'dado_em_falta', id: 'pessoas' }),
        ]),
      );
      const esp = ind.body.por_tipo.find(
        (x: { tipo: string }) => x.tipo === 'esplanada',
      );
      expect(esp).toMatchObject({ aprovacao: 'funcionario' });
      expect(esp.funcionario).toBeGreaterThanOrEqual(1);

      await ctx
        .http()
        .put('/v1/painel/licencas/aprovacao/esplanada')
        .set(chefe)
        .send({ aprovacao: 'automatica' })
        .expect(200);
    });
  });

  describe('regras públicas e verificáveis', () => {
    it('página pública (sem login, com cache): todas as licenças com regras, valores, fonte e demonstração', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}`)
        .expect(200);
      expect(r.headers['cache-control']).toContain('public');
      expect(r.body.licencas).toHaveLength(6);
      for (const l of r.body.licencas) {
        expect(l.regras.length).toBeGreaterThan(0);
        expect(l.valores.length).toBeGreaterThan(0);
        expect(l.taxas.join(' ')).toContain('€');
        expect(l.demonstracao).toBe(true);
        expect(l.fonte.titulo.length).toBeGreaterThan(3);
        expect(l.vigor_desde).toMatch(/^\d{4}-/);
        expect(l.historico).toBeUndefined();
      }
      const ruido = r.body.licencas.find(
        (x: { tipo: string }) => x.tipo === 'ruido',
      );
      expect(ruido.regras.map((x: { id: string }) => x.id)).toContain(
        'pessoas',
      );
      expect(ruido.dados_necessarios).toEqual(['Número de pessoas']);
      await ctx.http().get('/v1/public/regras/nao-existe').expect(404);
      await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/licencas/nada`)
        .expect(404);
    });

    it('o verificador dá exatamente o mesmo resultado que um pedido real', async () => {
      for (const [mudanca, via] of [
        [{}, 'automatica'],
        [{ pessoas: 500, hora_fim: '04:00' }, 'excecao'],
      ] as const) {
        const real = await pedirEPagar('ruido', mudanca);
        const v = await ctx
          .http()
          .post(`/v1/public/regras/${MUNICIPIO}/licencas/ruido/verificar`)
          .send({ ...CUMPRE.ruido.dados, ...mudanca })
          .expect(200);
        expect(v.body.decisao.via).toBe(via);
        expect(v.body.decisao.via).toBe(real.d.decisao);
        expect(v.body.proposta).toBe(real.d.proposta);
        expect(
          v.body.regras.map(
            (x: { id: string; ok: boolean; texto: string }) => ({
              id: x.id,
              ok: x.ok,
              texto: x.texto,
            }),
          ),
        ).toEqual(real.d.avaliacao.regras);
        expect(v.body.condicoes).toEqual(real.d.avaliacao.condicoes);
        expect(v.body.taxa.total_cent).toBe(real.d.taxa_se_aprovada_cent);
        // Cada resultado aponta a regra pública que o explica.
        expect(
          v.body.regras.every((x: { regra: string | null }) => x.regra),
        ).toBe(true);
      }
      // O verificador não grava nada.
      const antes = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM licencas',
      );
      await ctx
        .http()
        .post(
          `/v1/public/regras/${MUNICIPIO}/licencas/distico_residente/verificar`,
        )
        .send({
          matricula: 'AA-12-BB',
          morada_comprovada: false,
          viatura_em_nome: true,
        })
        .expect(200)
        .expect((r) => {
          expect(r.body.decisao.motivos).toEqual([
            expect.objectContaining({ tipo: 'regra', id: 'morada' }),
          ]);
        });
      expect(
        (await linha(ctx.db, 'SELECT count(*)::int AS n FROM licencas')).n,
      ).toBe(antes.n);
      // Dados inválidos: 400 com o que está mal.
      await ctx
        .http()
        .post(`/v1/public/regras/${MUNICIPIO}/licencas/ruido/verificar`)
        .send({ atividade: 'festa_privada' })
        .expect(400);
    });

    it('histórico: o que mudou, quando e o cargo (nunca o nome); "porque foi aprovada" mostra a versão desse dia', async () => {
      // Uma licença emitida com as regras de agora.
      const { d } = await pedirEPagar('ruido');
      const porqueAntes = await ctx
        .http()
        .get(`/v1/public/licencas/${d.codigo_verificacao}/porque`)
        .expect(200);
      expect(porqueAntes.body).toMatchObject({
        estado: 'emitida',
        decisao: 'automatica',
        decidida_por: 'Regras automáticas da câmara',
        versao: { em_vigor_hoje: true },
      });
      const versaoDoDia = porqueAntes.body.versao.numero as number;

      // A chefia muda o limite de pessoas.
      const atual = await ctx
        .http()
        .get('/v1/painel/licencas/regras/ruido')
        .set(chefe)
        .expect(200);
      const g = await ctx
        .http()
        .put('/v1/painel/licencas/regras/ruido')
        .set(chefe)
        .send({ ...atual.body.config, pessoas_max: 90 })
        .expect(200);
      expect(g.body.versao).toBe(versaoDoDia + 1);

      const pub = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/licencas/ruido`)
        .expect(200);
      expect(pub.body.versao).toBe(versaoDoDia + 1);
      expect(
        pub.body.regras.find((x: { id: string }) => x.id === 'pessoas').texto,
      ).toContain('Até 90 pessoas');
      expect(pub.body.historico[0]).toMatchObject({
        versao: versaoDoDia + 1,
        cargo: 'Chefe de divisão',
        alteracoes: [
          {
            campo: 'pessoas_max',
            rotulo: 'Pessoas (sem análise)',
            antes: '150',
            depois: '90',
          },
        ],
      });
      expect(pub.body.historico.at(-1)).toMatchObject({
        versao: 1,
        inicial: true,
        cargo: null,
      });
      expect(
        pub.body.verificador.map((c: { chave: string }) => c.chave),
      ).toContain('pessoas');
      // O nome e o email de quem mudou não são públicos.
      const texto = JSON.stringify(pub.body);
      expect(texto).not.toContain('Chefe Teste');
      expect(texto).not.toContain('chefe@teste.pt');

      // A licença antiga continua a mostrar as regras do dia em que foi pedida.
      const porque = await ctx
        .http()
        .get(`/v1/public/licencas/${d.codigo_verificacao}/porque`)
        .expect(200);
      expect(porque.body.versao).toMatchObject({
        numero: versaoDoDia,
        atual: versaoDoDia + 1,
        em_vigor_hoje: false,
      });
      expect(
        porque.body.versao.valores.find(
          (x: { chave: string }) => x.chave === 'pessoas_max',
        ).valor,
      ).toBe('150');
      expect(porque.body.regras.every((x: { ok: boolean }) => x.ok)).toBe(true);

      // E a página pública reflete logo a mudança (a cache cai com a versão nova).
      const resumo = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}`)
        .expect(200);
      expect(
        resumo.body.licencas.find((x: { tipo: string }) => x.tipo === 'ruido')
          .versao,
      ).toBe(versaoDoDia + 1);

      await ctx
        .http()
        .put('/v1/painel/licencas/regras/ruido')
        .set(chefe)
        .send(atual.body.config)
        .expect(200);
    });

    it('export JSON com o histórico, para auditar', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/regras.json`)
        .expect(200);
      expect(r.headers['content-disposition']).toContain('attachment');
      expect(r.body).toMatchObject({
        formato: 'toucamara.regras/1',
        municipio: { slug: MUNICIPIO },
      });
      expect(r.body.licencas).toHaveLength(6);
      const ruido = r.body.licencas.find(
        (x: { tipo: string }) => x.tipo === 'ruido',
      );
      expect(ruido.historico.length).toBeGreaterThanOrEqual(3);
      expect(ruido.config).toMatchObject({
        aprovacao: 'automatica',
        demonstracao: true,
      });
    });

    it('zonas do PDM: regras por obra, histórico com o cargo e o verificador = o mesmo motor do agente', async () => {
      // A BD é partilhada pelos ficheiros de teste: se fomos nós a carregar
      // as zonas, tiram-se no fim (o e2e do ordenamento começa sem PDM).
      const carregou =
        (
          await ctx
            .http()
            .post('/v1/painel/ordenamento/demonstracao')
            .set(chefe)
        ).status === 201;
      try {
        await verZonas();
      } finally {
        if (carregou) {
          await ctx.db.query(
            `DELETE FROM consultas_pdm WHERE municipio_id = $1;
             DELETE FROM regras_versoes WHERE municipio_id = $1 AND ambito = 'zona';
             DELETE FROM zonas_pdm WHERE municipio_id = $1;`.replace(
              /\$1/g,
              `'${MUNICIPIO_ID}'`,
            ),
          );
        }
      }
    });

    async function verZonas() {
      const lista = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}`)
        .expect(200);
      expect(lista.body.zonas.map((z: { codigo: string }) => z.codigo)).toEqual(
        expect.arrayContaining(['CH', 'ERC', 'EA', 'EF']),
      );
      const erc = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/zonas/erc`)
        .expect(200);
      expect(erc.body).toMatchObject({ codigo: 'ERC', demonstracao: true });
      expect(
        erc.body.obras.find((o: { obra: string }) => o.obra === 'anexo')
          .frases[0],
      ).toContain('10 m²');

      // Verificador vs a ferramenta do agente numa morada dessa zona.
      const morada = 'Rua do Verificador 7';
      ctx.geo.moradas.set(morada, { lat: 41.45, lng: -8.305 });
      const agente = await ferramenta(
        ctx,
        novaChamada('pdm'),
        'o_que_posso_fazer',
        {
          morada,
          obra: 'anexo',
          area_m2: 20,
          altura_m: 2.5,
        },
      ).expect(200);
      const v = await ctx
        .http()
        .post(`/v1/public/regras/${MUNICIPIO}/zonas/ERC/verificar`)
        .send({ obra: 'anexo', area_m2: 20, altura_m: 2.5 })
        .expect(200);
      expect(v.body.controlo).toBe(agente.body.controlo);
      expect(v.body.limites).toEqual(agente.body.limites);
      expect(v.body.passos).toEqual(agente.body.passos);
      const falta = await ctx
        .http()
        .post(`/v1/public/regras/${MUNICIPIO}/zonas/ERC/verificar`)
        .send({ obra: 'anexo' })
        .expect(200);
      expect(falta.body).toMatchObject({
        controlo: null,
        em_falta: ['area_m2', 'altura_m'],
      });

      // A chefia muda o muro: versão nova no histórico público.
      const zona = await linha(
        ctx.db,
        `SELECT id, regras FROM zonas_pdm WHERE municipio_id = $1 AND codigo = 'ERC'`,
        [MUNICIPIO_ID],
      );
      await ctx
        .http()
        .put(`/v1/painel/ordenamento/zonas/${zona.id}/regras`)
        .set(chefe)
        .send({
          regras: {
            ...zona.regras,
            muro: { degraus: [], acima: 'licenca', notas: [] },
          },
        })
        .expect(200);
      const depois = await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/zonas/ERC`)
        .expect(200);
      expect(depois.body.historico[0]).toMatchObject({
        cargo: 'Chefe de divisão',
        alteracoes: [
          expect.objectContaining({
            campo: 'muro',
            depois: 'Precisa de licença.',
          }),
        ],
      });
      expect(depois.body.historico.at(-1)).toMatchObject({ versao: 1 });
      await ctx
        .http()
        .put(`/v1/painel/ordenamento/zonas/${zona.id}/regras`)
        .set(chefe)
        .send({ regras: zona.regras })
        .expect(200);
      await ctx
        .http()
        .get(`/v1/public/regras/${MUNICIPIO}/zonas/XPTO`)
        .expect(404);
    }
  });
});
