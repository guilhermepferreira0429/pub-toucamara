/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { hojeLisboa, somarDiasUteis } from '../../src/common/dias-uteis';
import { ArmazenamentoService } from '../../src/modules/armazenamento/armazenamento.service';
import { FiscalizacaoService } from '../../src/modules/fiscalizacao/fiscalizacao.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
  smsPara,
  TIPO_CP_ID,
} from './app';

const BASE = '/v1/painel/fiscalizacao';

function diasDepois(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function feriadosDe(ctx: Contexto): Promise<Set<string>> {
  return new Set(
    (
      await linhas<{ dia: string }>(
        ctx.db,
        `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
         WHERE municipio_id IS NULL OR municipio_id = $1`,
        [MUNICIPIO_ID],
      )
    ).map((f) => f.dia),
  );
}

async function novoMunicipe(ctx: Contexto, telefone: string): Promise<string> {
  const m = await linha<{ id: string }>(
    ctx.db,
    `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Munícipe Fiscalização')
     RETURNING id`,
    [MUNICIPIO_ID, telefone],
  );
  return m!.id;
}

async function novaOcorrencia(
  ctx: Contexto,
  municipeId: string,
  duplicadaDe: string | null = null,
): Promise<{ id: string; numero: string }> {
  const cat = await linha<{ id: string }>(
    ctx.db,
    `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 AND nome = 'Buraco na via'`,
    [MUNICIPIO_ID],
  );
  const numero = `OC-F${randomInt(1e9)}`;
  const o = await linha<{ id: string }>(
    ctx.db,
    `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, municipe_id, duplicada_de)
     VALUES ($1, $2, $3, 'Obra a ocupar o passeio sem licença', 'Rua da Fiscalização, 7', 41.45, -8.29, $4, $5)
     RETURNING id`,
    [MUNICIPIO_ID, numero, cat!.id, municipeId, duplicadaDe],
  );
  return { id: o!.id, numero };
}

/**
 * Fiscalização: visitas a partir de ocorrências, processos ou à mão, plano
 * do dia por proximidade, relatório ditado (texto do telemóvel; áudio só
 * com S3), efeito na ocorrência e no processo, nova visita por infração,
 * PDF e permissões. Sem IA nos testes: o relatório fica "livre".
 */
describe('Fiscalização (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let tecnicoId: string;
  let feriados: Set<string>;
  const hoje = hojeLisboa();

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    tecnicoId = await criarUtilizador(ctx, 'tecnico');
    tecnico = await entrarPainel(ctx, tecnicoId);
    feriados = await feriadosDe(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('permissões', () => {
    it('atendimento e vereador não entram; técnico entra; configuração só a chefia', async () => {
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      const vereador = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'vereador'),
      );
      for (const h of [atendimento, vereador]) {
        const r = await ctx.http().get(`${BASE}/visitas`).set(h).expect(403);
        expect(r.body.erro).toMatchObject({
          codigo: 'sem_permissao',
          detalhes: { recurso: 'fiscalizacao' },
        });
      }
      await ctx.http().get(`${BASE}/visitas`).set(tecnico).expect(200);
      await ctx.http().get(`${BASE}/visitas`).expect(401);

      const eu = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(tecnico)
        .expect(200);
      expect(eu.body.permissoes.fiscalizacao).toBe(true);

      const op = await ctx
        .http()
        .get(`${BASE}/opcoes`)
        .set(tecnico)
        .expect(200);
      expect(op.body.tipos.map((t: { tipo: string }) => t.tipo)).toContain(
        'vistoria_utilizacao',
      );
      expect(op.body.config.demonstracao).toBe(true);
      expect(op.body.demonstracao).toBe(true);
      expect(op.body.transcricao_audio).toEqual({
        armazenamento: false,
        elevenlabs: false,
      });
      expect(op.body.fiscais.map((f: { id: string }) => f.id)).toContain(
        tecnicoId,
      );

      const cfg = { ...op.body.config, velocidade_kmh: 40 };
      const proibido = await ctx
        .http()
        .put(`${BASE}/config`)
        .set(tecnico)
        .send(cfg)
        .expect(403);
      expect(proibido.body.erro.codigo).toBe('sem_permissao');
    });
  });

  describe('a partir de uma ocorrência', () => {
    let telefone: string;
    let ocorrencia: { id: string; numero: string };
    let duplicada: { id: string; numero: string };
    let telefoneDup: string;
    let visitaId: string;

    beforeAll(async () => {
      telefone = novoTelefone();
      ocorrencia = await novaOcorrencia(ctx, await novoMunicipe(ctx, telefone));
      telefoneDup = novoTelefone();
      duplicada = await novaOcorrencia(
        ctx,
        await novoMunicipe(ctx, telefoneDup),
        ocorrencia.id,
      );
    });

    it('cria a visita com a morada, as coordenadas e a checklist; a ocorrência passa à fiscalização', async () => {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(tecnico)
        .send({ origem: 'ocorrencia', ocorrencia_id: ocorrencia.id })
        .expect(201);
      visitaId = r.body.id;
      expect(r.body).toMatchObject({
        numero: expect.stringMatching(/^FIS \d+\/\d{4}$/),
        tipo: 'ocorrencia',
        origem: 'ocorrencia',
        estado: 'por_agendar',
        morada: 'Rua da Fiscalização, 7',
        lat: 41.45,
        lng: -8.29,
        ocorrencia: {
          id: ocorrencia.id,
          numero: ocorrencia.numero,
          estado: 'com_equipa',
        },
        relatorio: null,
        valores_demonstracao: true,
      });
      expect(r.body.motivo).toContain(ocorrencia.numero);
      expect(r.body.checklist.map((i: { chave: string }) => i.chave)).toEqual([
        'problema_existe',
        'perigo_imediato',
        'responsavel_identificado',
      ]);
      const ev = await linha(
        ctx.db,
        `SELECT dados FROM ocorrencia_eventos WHERE ocorrencia_id = $1 AND tipo = 'fiscalizacao'`,
        [ocorrencia.id],
      );
      expect(ev!.dados).toMatchObject({
        visita_id: visitaId,
        nota: 'Passada à fiscalização.',
      });
    });

    it('não cria outra visita aberta para a mesma ocorrência (nem pelo duplicado)', async () => {
      for (const id of [ocorrencia.id, duplicada.id]) {
        const r = await ctx
          .http()
          .post(`${BASE}/visitas`)
          .set(tecnico)
          .send({ origem: 'ocorrencia', ocorrencia_id: id })
          .expect(409);
        expect(r.body.erro).toMatchObject({
          codigo: 'visita_ja_existe',
          detalhes: { visita_id: visitaId },
        });
      }
    });

    it('agendar: dia e fiscal → agendada; janela invertida → 400', async () => {
      const r = await ctx
        .http()
        .patch(`${BASE}/visitas/${visitaId}`)
        .set(tecnico)
        .send({ dia: hoje, fiscal_id: tecnicoId })
        .expect(200);
      expect(r.body).toMatchObject({
        estado: 'agendada',
        dia: hoje,
        fiscal_id: tecnicoId,
        fiscal_nome: 'Teste tecnico',
      });
      const inv = await ctx
        .http()
        .patch(`${BASE}/visitas/${visitaId}`)
        .set(tecnico)
        .send({ janela_inicio: '11:00', janela_fim: '10:00' })
        .expect(400);
      expect(inv.body.erro.codigo).toBe('janela_invalida');
    });

    it('áudio e fotos sem S3 → 503 claro; transcrever sem áudio → 409', async () => {
      const a = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/relatorio/audio`)
        .set(tecnico)
        .send({ mime: 'audio/webm;codecs=opus' })
        .expect(503);
      expect(a.body.erro.codigo).toBe('armazenamento_indisponivel');
      expect(a.body.erro.mensagem).toContain('texto');
      const f = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/fotos`)
        .set(tecnico)
        .send({ mime: 'image/jpeg' })
        .expect(503);
      expect(f.body.erro.codigo).toBe('armazenamento_indisponivel');
      const t = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/relatorio/audio/transcrever`)
        .set(tecnico)
        .expect(409);
      expect(t.body.erro.codigo).toBe('sem_audio');
      await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/relatorio/audio`)
        .set(tecnico)
        .send({ mime: 'video/mp4' })
        .expect(400);
    });

    it('concluir sem relatório → 409', async () => {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/concluir`)
        .set(tecnico)
        .expect(409);
      expect(r.body.erro.codigo).toBe('sem_relatorio');
    });

    it('relatório por texto, sem IA: relatório livre com a checklist feita à mão', async () => {
      const texto =
        'Cheguei ao local às dez. A obra ocupa o passeio com entulho, sem licença de ocupação. ' +
        'Falei com o encarregado e dei um prazo de 10 dias para corrigir. Tirei a foto 1 do passeio.';
      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/relatorio`)
        .set(tecnico)
        .send({
          texto,
          checklist: [
            {
              chave: 'problema_existe',
              resposta: 'sim',
              nota: 'entulho no passeio',
            },
            { chave: 'perigo_imediato', resposta: 'nao' },
          ],
        })
        .expect(200);
      expect(r.body.aviso).toContain('relatório livre');
      expect(r.body.relatorio).toMatchObject({
        fonte: 'texto',
        transcrito_por: 'dispositivo',
        transcricao: texto,
        estruturado_por: 'manual',
        conclusao: 'com_infracoes',
        fechado_em: null,
        estruturado: {
          livre: true,
          prazo_dias: 10,
          fotos_referidas: ['Tirei a foto 1 do passeio.'],
          infracoes: [
            {
              descricao:
                'O problema reportado existe no local: entulho no passeio',
              artigo: null,
            },
          ],
        },
      });
      expect(
        r.body.checklist.find(
          (i: { chave: string }) => i.chave === 'problema_existe',
        ),
      ).toMatchObject({ resposta: 'sim', nota: 'entulho no passeio' });
    });

    it('o fiscal revê: acrescenta a medida e o artigo', async () => {
      const r = await ctx
        .http()
        .patch(`${BASE}/visitas/${visitaId}/relatorio`)
        .set(tecnico)
        .send({
          medidas: ['Notificado o encarregado para retirar o entulho'],
          infracoes: [
            {
              descricao: 'Ocupação do passeio com entulho sem licença',
              artigo: 'Regulamento municipal de ocupação do espaço público',
            },
          ],
        })
        .expect(200);
      expect(r.body.relatorio.estruturado).toMatchObject({
        medidas: ['Notificado o encarregado para retirar o entulho'],
        prazo_dias: 10,
      });
      expect(r.body.relatorio.conclusao).toBe('com_infracoes');
    });

    it('PDF do relatório (rascunho)', async () => {
      const r = await ctx
        .http()
        .get(`${BASE}/visitas/${visitaId}/pdf`)
        .set(tecnico)
        .buffer(true)
        .parse((res, cb) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(r.headers['content-disposition']).toMatch(
        /vistoria-FIS-\d+-\d{4}\.pdf/,
      );
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('concluir com infração: visita feita, prazo, nova visita agendada, ocorrência e SMS a quem reportou', async () => {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/concluir`)
        .set(tecnico)
        .expect(200);
      const prazo = diasDepois(hoje, 10);
      const diaNova = somarDiasUteis(prazo, 1, feriados);
      expect(r.body).toMatchObject({
        estado: 'feita',
        dia: hoje,
        relatorio: { prazo_correcao: prazo, fechado_em: expect.any(String) },
        efeitos: {
          conclusao: 'com_infracoes',
          prazo_correcao: { data: prazo, dias: 10, dito_pelo_fiscal: true },
          nova_visita: { dia: diaNova, prazo_correcao: prazo },
          ocorrencia: { id: ocorrencia.id, estado: 'com_equipa', avisados: 2 },
          processo: null,
        },
      });
      expect(r.body.efeitos.ocorrencia.nota_publica).toContain(
        `corrigir até ${prazo.split('-').reverse().join('/')}`,
      );
      expect(r.body.novas_visitas).toHaveLength(1);

      const o = await linha(
        ctx.db,
        `SELECT estado, prevista_para::text AS prevista_para FROM ocorrencias WHERE id = $1`,
        [ocorrencia.id],
      );
      expect(o).toEqual({ estado: 'com_equipa', prevista_para: prazo });
      const ev = await linha(
        ctx.db,
        `SELECT dados FROM ocorrencia_eventos WHERE ocorrencia_id = $1 AND tipo = 'fiscalizacao_relatorio'`,
        [ocorrencia.id],
      );
      expect(ev!.dados).toMatchObject({
        conclusao: 'com_infracoes',
        nota_publica: r.body.efeitos.ocorrencia.nota_publica,
      });

      for (const t of [telefone, telefoneDup]) {
        const sms = await smsPara(ctx, t, 'ocorrencia');
        expect(sms).toHaveLength(1);
        expect(sms[0].corpo).toContain(ocorrencia.numero);
        expect(sms[0].corpo).toContain('pediu ao responsável para corrigir');
        expect(sms[0].corpo).toMatch(/\/r\/[A-Z0-9]+$/);
      }

      const nova = await ctx
        .http()
        .get(`${BASE}/visitas/${r.body.efeitos.nova_visita.id}`)
        .set(tecnico)
        .expect(200);
      expect(nova.body).toMatchObject({
        tipo: 'reinspecao',
        origem: 'reinspecao',
        estado: 'agendada',
        visita_anterior_id: visitaId,
        ocorrencia_id: ocorrencia.id,
        fiscal_id: tecnicoId,
        prazo_correcao: prazo,
      });
      expect(
        nova.body.checklist.map((i: { rotulo: string }) => i.rotulo),
      ).toEqual([
        'As medidas pedidas na visita anterior foram cumpridas?',
        'Foi corrigida: Ocupação do passeio com entulho sem licença?',
      ]);

      // Fechado: não se altera nem se conclui outra vez.
      const outra = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/concluir`)
        .set(tecnico)
        .expect(409);
      expect(outra.body.erro.codigo).toBe('visita_fechada');

      const aud = await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE acao = 'concluir_visita' AND objeto_id = $1`,
        [visitaId],
      );
      expect(aud!.dados).toMatchObject({
        conclusao: 'com_infracoes',
        infracoes: 1,
      });
      const acessos = await ctx
        .http()
        .get('/v1/painel/equipa/acessos')
        .set(chefe)
        .expect(200);
      expect(JSON.stringify(acessos.body)).toContain(
        'fechou o relatório de uma visita de fiscalização',
      );
    });

    it('na nova visita, tudo corrigido: a ocorrência fica resolvida e quem reportou recebe o SMS', async () => {
      const lista = await ctx
        .http()
        .get(`${BASE}/visitas?ocorrencia_id=${ocorrencia.id}&abertas=true`)
        .set(tecnico)
        .expect(200);
      expect(lista.body.itens).toHaveLength(1);
      const nova = lista.body.itens[0];
      expect(nova).toMatchObject({ tipo: 'reinspecao', por_responder: 2 });

      const rel = await ctx
        .http()
        .post(`${BASE}/visitas/${nova.id}/relatorio`)
        .set(tecnico)
        .send({
          texto:
            'Voltei ao local. O passeio está limpo e o entulho foi retirado.',
          checklist: [
            { chave: 'medidas_cumpridas', resposta: 'sim' },
            { chave: 'corrigida_1', resposta: 'sim' },
          ],
        })
        .expect(200);
      expect(rel.body.relatorio.conclusao).toBe('conforme');

      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${nova.id}/concluir`)
        .set(tecnico)
        .expect(200);
      expect(r.body.efeitos).toMatchObject({
        conclusao: 'conforme',
        nova_visita: null,
        prazo_correcao: null,
        ocorrencia: { estado: 'resolvida', avisados: 2 },
      });
      const o = await linha(
        ctx.db,
        'SELECT estado FROM ocorrencias WHERE id = $1',
        [ocorrencia.id],
      );
      expect(o!.estado).toBe('resolvida');
      const sms = await smsPara(ctx, telefone, 'ocorrencia');
      expect(sms).toHaveLength(2);
      expect(sms[1].corpo).toContain('foi resolvida');
    });
  });

  describe('a partir de um processo (vistoria)', () => {
    let telefone: string;
    let processoId: string;
    let visitaId: string;

    beforeAll(async () => {
      telefone = novoTelefone();
      const municipe = await novoMunicipe(ctx, telefone);
      const p = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, lat, lng, fase)
         VALUES ($1, $2, $3, $4, 'Moradia nova', 'Rua do Processo, 3', 41.46, -8.3, 'apreciacao') RETURNING id`,
        [MUNICIPIO_ID, `LU ${randomInt(1e6)}/2026`, TIPO_CP_ID, municipe],
      );
      processoId = p!.id;
    });

    it('marca a vistoria com dia e janela: linha do tempo e SMS ao requerente', async () => {
      const dia = somarDiasUteis(hoje, 3, feriados);
      const r = await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(chefe)
        .send({
          origem: 'processo',
          processo_id: processoId,
          fiscal_id: tecnicoId,
          dia,
          janela_inicio: '10:00',
          janela_fim: '11:00',
        })
        .expect(201);
      visitaId = r.body.id;
      expect(r.body).toMatchObject({
        tipo: 'vistoria_utilizacao',
        origem: 'processo',
        estado: 'agendada',
        janela_inicio: '10:00',
        janela_fim: '11:00',
        morada: 'Rua do Processo, 3',
        processo: { id: processoId },
      });
      expect(r.body.checklist.length).toBeGreaterThanOrEqual(4);
      const ev = await linhas(
        ctx.db,
        `SELECT tipo, descricao, interno FROM processo_eventos WHERE processo_id = $1 ORDER BY id`,
        [processoId],
      );
      expect(ev).toEqual([
        expect.objectContaining({ tipo: 'vistoria_pedida', interno: true }),
        expect.objectContaining({
          tipo: 'vistoria_marcada',
          interno: false,
          descricao: `Vistoria marcada para ${dia.split('-').reverse().join('/')}, entre as 10:00 e as 11:00.`,
        }),
      ]);
      const sms = await smsPara(ctx, telefone, 'processo');
      expect(sms).toHaveLength(1);
      expect(sms[0].corpo).toContain('Vistoria marcada');
    });

    it('relatório conforme: evento no processo e SMS; sem nova visita', async () => {
      const op = await ctx
        .http()
        .get(`${BASE}/opcoes`)
        .set(tecnico)
        .expect(200);
      const chaves = op.body.tipos
        .find((t: { tipo: string }) => t.tipo === 'vistoria_utilizacao')
        .checklist.map((i: { chave: string }) => i.chave);
      await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/relatorio`)
        .set(tecnico)
        .send({
          texto:
            'Vistoria feita com o requerente. Tudo de acordo com o projeto aprovado.',
          checklist: chaves.map((chave: string) => ({
            chave,
            resposta: 'sim',
          })),
        })
        .expect(200);
      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${visitaId}/concluir`)
        .set(tecnico)
        .expect(200);
      expect(r.body.efeitos).toMatchObject({
        conclusao: 'conforme',
        nova_visita: null,
        ocorrencia: null,
        processo: { id: processoId, avisado: true },
      });
      const ev = await linha(
        ctx.db,
        `SELECT descricao, interno, dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'vistoria'`,
        [processoId],
      );
      expect(ev).toMatchObject({
        interno: false,
        descricao: expect.stringContaining('sem desconformidades'),
        dados: { visita_id: visitaId, conclusao: 'conforme' },
      });
      const sms = await smsPara(ctx, telefone, 'processo');
      expect(sms).toHaveLength(2);
      expect(sms[1].corpo).toContain('sem desconformidades');
      // Na página pública do processo aparece (evento não interno).
      const publico = await linhas(
        ctx.db,
        `SELECT descricao FROM processo_eventos WHERE processo_id = $1 AND NOT interno`,
        [processoId],
      );
      expect(publico).toHaveLength(2);
    });

    it('vistoria com infração cria nova vistoria e o evento diz o prazo', async () => {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(tecnico)
        .send({ origem: 'processo', processo_id: processoId })
        .expect(201);
      await ctx
        .http()
        .post(`${BASE}/visitas/${r.body.id}/relatorio`)
        .set(tecnico)
        .send({
          texto: 'O livro de obra não estava no local.',
          checklist: [{ chave: 'livro_obra', resposta: 'nao' }],
        })
        .expect(200);
      const c = await ctx
        .http()
        .post(`${BASE}/visitas/${r.body.id}/concluir`)
        .set(tecnico)
        .expect(200);
      // Sem prazo dito: os 30 dias de demonstração.
      const prazo = diasDepois(hoje, 30);
      expect(c.body.efeitos.prazo_correcao).toMatchObject({
        data: prazo,
        dito_pelo_fiscal: false,
        valor_de_demonstracao: true,
      });
      expect(c.body.efeitos.nova_visita).toMatchObject({
        dia: somarDiasUteis(prazo, 1, feriados),
      });
      expect(c.body.efeitos.processo.evento).toContain('há 1 ponto a corrigir');
      const nova = await linha(
        ctx.db,
        'SELECT processo_id, tipo, estado FROM fiscalizacao_visitas WHERE id = $1',
        [c.body.efeitos.nova_visita.id],
      );
      expect(nova).toEqual({
        processo_id: processoId,
        tipo: 'reinspecao',
        estado: 'agendada',
      });
    });
  });

  describe('plano do dia', () => {
    const dia = '2027-03-10';
    const ids: Record<string, string> = {};

    async function manual(nome: string, extra: object) {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(chefe)
        .send({
          origem: 'manual',
          tipo: 'ocupacao_via',
          motivo: `Esplanada ${nome}`,
          morada: `Praça ${nome}`,
          fiscal_id: tecnicoId,
          dia,
          ...extra,
        })
        .expect(201);
      ids[nome] = r.body.id;
      return r.body;
    }

    beforeAll(async () => {
      const op = await ctx.http().get(`${BASE}/config`).set(chefe).expect(200);
      await ctx
        .http()
        .put(`${BASE}/config`)
        .set(chefe)
        .send({
          ...op.body.config,
          ponto_partida: { nome: 'Edifício da câmara', lat: 41.44, lng: -8.29 },
          velocidade_kmh: 30,
          fator_percurso: 1,
          hora_inicio: '09:00',
        })
        .expect(200);
      await manual('A', { lat: 41.45, lng: -8.29 });
      await manual('B', { lat: 41.47, lng: -8.29 });
      await manual('C', {
        lat: 41.46,
        lng: -8.29,
        janela_inicio: '11:00',
        janela_fim: '12:00',
      });
      // Sem coordenadas (a geocodificação falsa não conhece a morada).
      await manual('D', {});
      // Doutro fiscal e cancelada: não entram.
      const outro = await criarUtilizador(ctx, 'tecnico');
      await manual('E', { lat: 41.441, lng: -8.29, fiscal_id: outro });
      const f = await manual('F', { lat: 41.441, lng: -8.29 });
      await ctx
        .http()
        .post(`${BASE}/visitas/${f.id}/cancelar`)
        .set(chefe)
        .send({ motivo: 'Esplanada já retirada' })
        .expect(200);
    });

    it('ordena por proximidade a partir da câmara, respeita a janela e regressa', async () => {
      const r = await ctx
        .http()
        .get(`${BASE}/plano?dia=${dia}&fiscal_id=${tecnicoId}`)
        .set(tecnico)
        .expect(200);
      expect(r.body.partida).toMatchObject({
        nome: 'Edifício da câmara',
        origem: 'configuracao',
      });
      expect(r.body.paragens.map((p: { id: string }) => p.id)).toEqual([
        ids.A,
        ids.B,
        ids.C,
      ]);
      expect(r.body.paragens[0]).toMatchObject({
        chegada: '09:03',
        inicio: '09:03',
        fim: '09:23',
        visita: {
          numero: expect.any(String),
          morada: 'Praça A',
          tipo: 'ocupacao_via',
        },
      });
      expect(r.body.paragens[2]).toMatchObject({
        inicio: '11:00',
        janela: { inicio: '11:00', fim: '12:00' },
      });
      expect(r.body.paragens[2].espera_min).toBeGreaterThan(0);
      expect(r.body.sem_localizacao.map((v: { id: string }) => v.id)).toEqual([
        ids.D,
      ]);
      expect(r.body.regresso).toMatchObject({ distancia_km: 2.2 });
      expect(r.body.avisos.join(' ')).toContain('sem coordenadas');
      expect(r.body.parametros).toMatchObject({ velocidade_kmh: 30 });
    });

    it('sem fiscal_id usa o próprio; ponto de partida e hora no pedido', async () => {
      const r = await ctx
        .http()
        .get(
          `${BASE}/plano?dia=${dia}&partida_lat=41.48&partida_lng=-8.29&inicio=08:00&regressar=false`,
        )
        .set(tecnico)
        .expect(200);
      expect(r.body.fiscal.id).toBe(tecnicoId);
      expect(r.body.partida.origem).toBe('pedido');
      expect(r.body.paragens[0].id).toBe(ids.B);
      expect(r.body.regresso).toBeNull();
      await ctx.http().get(`${BASE}/plano`).set(tecnico).expect(400);
    });

    it('a visita cancelada não aceita relatório', async () => {
      const r = await ctx
        .http()
        .post(`${BASE}/visitas/${ids.F}/relatorio`)
        .set(tecnico)
        .send({ texto: 'Ditado de uma visita que foi cancelada.' })
        .expect(409);
      expect(r.body.erro.codigo).toBe('visita_fechada');
    });
  });

  describe('validação', () => {
    it('manual exige tipo, motivo e morada; ocorrência inexistente → 404', async () => {
      await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(tecnico)
        .send({ origem: 'manual', motivo: 'Sem morada' })
        .expect(400);
      const r = await ctx
        .http()
        .post(`${BASE}/visitas`)
        .set(tecnico)
        .send({
          origem: 'ocorrencia',
          ocorrencia_id: '00000000-0000-0000-0000-00000000dead',
        })
        .expect(404);
      expect(r.body.erro.codigo).toBe('ocorrencia_nao_encontrada');
      await ctx
        .http()
        .get(`${BASE}/visitas/nao-e-uuid`)
        .set(tecnico)
        .expect(400);
    });
  });
});

/**
 * Áudio com armazenamento (S3 falso) e o ElevenLabs falso: o áudio fica
 * guardado, é transcrito e o relatório estrutura-se como o do texto.
 */
describe('Fiscalização · relatório em áudio (e2e)', () => {
  let ctx: Contexto;
  let tecnico: Record<string, string>;
  const guardados = new Map<string, Buffer>();
  const pedidosStt: { url: string; corpo: FormData }[] = [];

  const s3Falso = {
    disponivel: true,
    chave: (slug: string, pasta: string, ext: string) =>
      `${slug}/${pasta}/teste-${randomInt(1e9)}.${ext}`,
    urlEnvio: (chave: string) =>
      Promise.resolve(`https://s3.falso/${chave}?assinado`),
    urlLeitura: (chave: string) =>
      Promise.resolve(`https://s3.falso/${chave}?ler`),
    ler: (chave: string) => {
      const b = guardados.get(chave);
      return b ? Promise.resolve(b) : Promise.reject(new Error('NoSuchKey'));
    },
    guardar: () => Promise.resolve(),
    apagar: () => Promise.resolve([]),
  };

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) =>
        b.overrideProvider(ArmazenamentoService).useValue(s3Falso),
    });
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
  });
  afterAll(() => ctx.fechar());

  it('URL assinada → (envio) → transcrever: sem ELEVENLABS_API_KEY 503; com ela transcreve e estrutura', async () => {
    const v = await ctx
      .http()
      .post(`${BASE}/visitas`)
      .set(tecnico)
      .send({
        origem: 'manual',
        tipo: 'obra',
        motivo: 'Obra denunciada',
        morada: 'Rua do Áudio, 1',
        lat: 41.44,
        lng: -8.29,
      })
      .expect(201);
    const id = v.body.id;

    const envio = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/relatorio/audio`)
      .set(tecnico)
      .send({ mime: 'audio/webm' })
      .expect(201);
    expect(envio.body).toMatchObject({
      url_envio: expect.stringContaining('https://s3.falso/teste/gravacoes/'),
      metodo: 'PUT',
      cabecalhos: { 'Content-Type': 'audio/webm' },
    });
    const chave = new URL(envio.body.url_envio).pathname.slice(1);

    // Ainda não enviou: o áudio não está no armazenamento.
    const svc = ctx.app.get(FiscalizacaoService);
    svc.chaveElevenlabs = () => '';
    const sem = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/relatorio/audio/transcrever`)
      .set(tecnico)
      .expect(503);
    expect(sem.body.erro.codigo).toBe('transcricao_indisponivel');

    svc.chaveElevenlabs = () => 'chave-e2e';
    svc.buscar = (url, init) => {
      pedidosStt.push({ url, corpo: init.body as FormData });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            text: 'O aviso não está afixado. O livro de obra está no local. Prazo de 5 dias para corrigir.',
            language_code: 'por',
          }),
          { status: 200 },
        ),
      );
    };
    const antes = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/relatorio/audio/transcrever`)
      .set(tecnico)
      .expect(409);
    expect(antes.body.erro.codigo).toBe('audio_por_enviar');

    // Concluir com áudio por transcrever → 409 claro.
    const cedo = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/concluir`)
      .set(tecnico)
      .expect(409);
    expect(cedo.body.erro.codigo).toBe('relatorio_por_transcrever');

    guardados.set(chave, Buffer.from('áudio'));
    const r = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/relatorio/audio/transcrever`)
      .set(tecnico)
      .expect(200);
    expect(pedidosStt).toHaveLength(1);
    expect(pedidosStt[0].url).toBe(
      'https://api.elevenlabs.io/v1/speech-to-text',
    );
    expect(pedidosStt[0].corpo.get('model_id')).toBeTruthy();
    expect(r.body.relatorio).toMatchObject({
      fonte: 'audio',
      transcrito_por: 'elevenlabs',
      transcricao: expect.stringContaining('aviso não está afixado'),
      estruturado_por: 'manual',
      audio: { mime: 'audio/webm', url: expect.stringContaining('?ler') },
    });

    // Sem IA, a checklist preenche-se à mão (relatório livre acompanha).
    const p = await ctx
      .http()
      .patch(`${BASE}/visitas/${id}/relatorio`)
      .set(tecnico)
      .send({ checklist: [{ chave: 'aviso_afixado', resposta: 'nao' }] })
      .expect(200);
    expect(p.body.relatorio.conclusao).toBe('com_infracoes');
    expect(p.body.relatorio.estruturado.infracoes).toEqual([
      {
        descricao:
          'O aviso da licença ou comunicação prévia está afixado e visível',
        artigo: 'RJUE, art. 78.º',
      },
    ]);

    // Fotografia: URL assinada.
    const f = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/fotos`)
      .set(tecnico)
      .send({ mime: 'image/jpeg', legenda: 'Fachada sem aviso' })
      .expect(201);
    expect(f.body.url_envio).toContain('https://s3.falso/teste/documentos/');
    const d = await ctx
      .http()
      .get(`${BASE}/visitas/${id}`)
      .set(tecnico)
      .expect(200);
    expect(d.body.fotos).toEqual([
      expect.objectContaining({
        legenda: 'Fachada sem aviso',
        mime: 'image/jpeg',
      }),
    ]);

    const c = await ctx
      .http()
      .post(`${BASE}/visitas/${id}/concluir`)
      .set(tecnico)
      .expect(200);
    expect(c.body.efeitos).toMatchObject({
      conclusao: 'com_infracoes',
      prazo_correcao: { dias: 5, dito_pelo_fiscal: true },
      ocorrencia: null,
      processo: null,
    });
    expect(c.body.efeitos.nova_visita).not.toBeNull();
  });
});
