/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { UtilizadorPainel } from '../../common/pedido.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { ClaudeService } from '../../ia/claude.service.js';
import type { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import type { MensagensService } from '../comunicacao/mensagens.service.js';
import type { ConhecimentoService } from '../conhecimento/conhecimento.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { esquemaResumoProcesso } from './apoio.js';
import { ProcessosApoioService } from './processos-apoio.service.js';
import { ProcessosAvisosService } from './processos-avisos.service.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import type { ProcessosVerificacoesService } from './processos-verificacoes.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';

/*
 * Integração com o Postgres (todas as migrações aplicadas), numa transação
 * desfeita no fim. Só corre com TESTE_BD=1:
 *
 *   TESTE_BD=1 DB_NAME=toucamara_tec npx jest src/modules/processos/processos-apoio.bd.spec.ts
 *
 * IA, pesquisa no conhecimento e SMS são falsos; sem armazenamento.
 */
const correr = process.env.TESTE_BD === '1' ? describe : describe.skip;

const TEXTO_BASE =
  'Estão isentas de controlo prévio as obras de alteração no interior de edifícios que não impliquem modificações na estrutura.';

correr('apoio ao técnico (BD)', () => {
  let client: Client;
  let apoio: ProcessosApoioService;
  let painel: ProcessosPainelService;
  let m: Municipio;
  let u: UtilizadorPainel;
  let processoId: string;
  const sms = jest.fn().mockResolvedValue({ id: 'x' });
  const extrair = jest.fn();
  const escrever = jest.fn();
  const claude = { disponivel: true, extrair, escrever };
  // As verificações têm testes próprios; aqui só se vê que entram nos rascunhos.
  const verificacoes = {
    obter: jest.fn().mockResolvedValue({
      itens: [
        {
          codigo: 'ia_paredes',
          estado: 'atencao',
          titulo: 'Parede a abrir: confirmar que não é estrutural',
          detalhe:
            'O projeto diz “não estrutural”, mas não há planta de estruturas',
          evidencias: [],
          origem: 'ia',
          a_confirmar: true,
          demonstracao: false,
          notas: [],
        },
      ],
      contagem: { ok: 0, atencao: 1, falha: 0, nao_verificavel: 0 },
      gerado_em: new Date(),
      versao: { motor: '1', documentos: 'd', regras: 'r' },
    }),
  };
  const q = async (sql: string, p?: unknown[]) =>
    (await client.query(sql, p)).rows;

  beforeAll(async () => {
    client = new Client({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 54330),
      user: 'toucamara',
      password: process.env.DB_PASSWORD ?? 'toucamara',
      database: process.env.DB_NAME ?? 'toucamara',
    });
    await client.connect();
    await client.query('BEGIN');

    let n = 0;
    const tx = { query: q };
    const db = {
      query: q,
      transaction: async <T>(fn: (t: Tx) => Promise<T>) => {
        const sp = `sp${++n}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const r = await fn(tx);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw e;
        }
      },
    } as unknown as DatabaseService;

    const config = { get: () => 'https://t.pt' } as unknown as ConfigService;
    const mensagens = {
      sms,
      email: jest.fn(),
    } as unknown as MensagensService;
    const armazenamento = {
      disponivel: false,
    } as unknown as ArmazenamentoService;
    const auditoria = new AuditoriaService(db);
    const municipios = new MunicipiosService(db);
    const tipos = new TiposProcessoService(db, auditoria);
    const processos = new ProcessosService(
      db,
      config,
      tipos,
      municipios,
      new LinksCurtosService(db, config),
      mensagens,
      auditoria,
    );
    const avisos = new ProcessosAvisosService(
      db,
      processos,
      municipios,
      mensagens,
    );
    painel = new ProcessosPainelService(
      db,
      processos,
      tipos,
      municipios,
      armazenamento,
      auditoria,
      mensagens,
      avisos,
    );
    const conhecimento = {
      procurar: (_m: string, pergunta: string) =>
        Promise.resolve({
          sem_fonte: false,
          respostas: [],
          trechos: [
            {
              trecho_id: '00000000-0000-0000-0000-000000000001',
              referencia: 'art. 11.º',
              texto: `O pedido de elementos suspende o prazo. (${pergunta.length})`,
              titulo: 'RJUE',
              url: 'https://exemplo.pt/rjue',
              tipo_fonte: 'lei',
              entidade: 'Câmara',
              lida_em: '2026-10-01T10:00:00Z',
              pontuacao: 1,
            },
          ],
        }),
    } as unknown as ConhecimentoService;
    apoio = new ProcessosApoioService(
      db,
      claude as unknown as ClaudeService,
      conhecimento,
      painel,
      processos,
      avisos,
      armazenamento,
      auditoria,
      verificacoes as unknown as ProcessosVerificacoesService,
    );

    // Dados falsos.
    [m] = await q(
      `INSERT INTO municipios (slug, nome) VALUES ('teste-apoio', 'Câmara de Teste')
       RETURNING id, slug, nome, fuso`,
    );
    const [ent] = await q(
      `INSERT INTO entidades (municipio_id, nome, tipo) VALUES ($1, 'Câmara', 'camara') RETURNING id`,
      [m.id],
    );
    const [fonte] = await q(
      `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url)
       VALUES ($1, $2, 'RJUE', 'lei', 'https://exemplo.pt/rjue') RETURNING id`,
      [m.id, ent.id],
    );
    const [fv] = await q(
      `INSERT INTO fonte_versoes (fonte_id, hash, texto) VALUES ($1, 'h1', $2) RETURNING id`,
      [fonte.id, TEXTO_BASE],
    );
    const [tr] = await q(
      `INSERT INTO trechos (fonte_versao_id, ordem, referencia, texto)
       VALUES ($1, 1, 'art. 6.º, n.º 1', $2) RETURNING id`,
      [fv.id, TEXTO_BASE],
    );
    const [tipo] = await q(
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, base_legal_trecho, formulario)
       VALUES ($1, 'CP', 'Comunicação prévia', 20, $2, $3) RETURNING id`,
      [
        m.id,
        tr.id,
        JSON.stringify([
          {
            chave: 'descricao',
            rotulo: 'Descrição da obra',
            tipo: 'texto',
            obrigatorio: true,
          },
          { chave: 'nif', rotulo: 'NIF', tipo: 'nif', obrigatorio: true },
        ]),
      ],
    );
    await q(
      `INSERT INTO tipo_processo_documentos (tipo_processo_id, nome, ordem) VALUES ($1, 'Planta de localização', 1)`,
      [tipo.id],
    );
    [u] = await q(
      `INSERT INTO utilizadores (municipio_id, email, nome, perfil)
       VALUES ($1, 'tecnico@teste-apoio.pt', 'Ana Costa', 'tecnico') RETURNING id, nome, email, perfil`,
      [m.id],
    );
    const [mun] = await q(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, '+351912345678', 'Maria Fernandes') RETURNING id`,
      [m.id],
    );
    const [conv] = await q(
      `INSERT INTO conversas (municipio_id, municipe_id, canal, resumo) VALUES ($1, $2, 'telefone', 'Quer abrir uma porta.') RETURNING id`,
      [m.id, mun.id],
    );
    const [p] = await q(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id, assunto, fase)
       VALUES ($1, 'CP 1/2026', $2, $3, $4, 'Porta na cozinha', 'documentos') RETURNING id`,
      [m.id, tipo.id, mun.id, conv.id],
    );
    processoId = p.id;
    await q(
      `INSERT INTO requerimentos (municipio_id, municipe_id, conversa_id, tipo_processo_id, dados, estado, processo_id)
       VALUES ($1, $2, $3, $4, $5, 'entregue', $6)`,
      [
        m.id,
        mun.id,
        conv.id,
        tipo.id,
        JSON.stringify({ descricao: 'Abrir uma porta', nif_registado: true }),
        p.id,
      ],
    );
    await q(
      `INSERT INTO modelos_resposta (municipio_id, canal, nome, corpo, estado)
       VALUES ($1, 'oficio', 'Pedido de elementos', 'Exmo(a). Senhor(a) {nome}', 'aprovado')`,
      [m.id],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  const resumoIa = {
    o_caso: 'Pede para abrir uma porta na cozinha.',
    requerente: 'Maria F., NIF 123456789.',
    o_que_ja_ha: 'Requerimento assinado.',
    o_que_falta: 'Planta de localização.',
    prazos: 'O prazo da câmara ainda não começou.',
    pontos_de_atencao: ['Falta a planta.'],
    proximo_passo_sugerido: 'Pedir a planta.',
  };

  it('a ficha diz que ainda não há apoio', async () => {
    const d = await painel.detalhe(m, processoId);
    expect(d.apoio).toEqual({
      resumo: null,
      regulamento: null,
      rascunhos: { total: 0, rascunho: 0, aprovado: 0, descartado: 0 },
    });
  });

  it('resumo: gera, guarda em cache e regenera quando o processo muda', async () => {
    extrair.mockImplementation((esquema: unknown) =>
      Promise.resolve(esquema === esquemaResumoProcesso ? resumoIa : null),
    );
    const r1 = await apoio.resumo(m, u, processoId, false);
    expect(r1.em_cache).toBe(false);
    expect(r1.requerente).toBe('Maria F., NIF [omitido].');
    expect(extrair).toHaveBeenCalledTimes(1);
    const conteudo = extrair.mock.calls[0][1].conteudo as string;
    expect(conteudo).toContain('Descrição da obra: Abrir uma porta');
    expect(conteudo).toContain('Quer abrir uma porta.');

    const r2 = await apoio.resumo(m, u, processoId, false);
    expect(r2.em_cache).toBe(true);
    expect(extrair).toHaveBeenCalledTimes(1);

    await painel.nota(m, u, processoId, {
      descricao: 'Ver a fachada.',
      interno: true,
    });
    expect((await painel.detalhe(m, processoId)).apoio.resumo).toMatchObject({
      atualizado: false,
    });
    const r3 = await apoio.resumo(m, u, processoId, false);
    expect(r3.em_cache).toBe(false);
    expect(extrair).toHaveBeenCalledTimes(2);

    await apoio.resumo(m, u, processoId, true);
    expect(extrair).toHaveBeenCalledTimes(3);

    const [a] = await q(
      `SELECT count(*)::int AS n FROM audit_log WHERE acao = 'ver_resumo' AND objeto_id = $1`,
      [processoId],
    );
    expect(a.n).toBe(4);
  });

  it('resumo sem IA: 503', async () => {
    claude.disponivel = false;
    await expect(apoio.resumo(m, u, processoId, true)).rejects.toMatchObject({
      codigo: 'ia_indisponivel',
    });
    claude.disponivel = true;
  });

  it('regulamento sem IA: trechos sem destaques, sem cache', async () => {
    claude.disponivel = false;
    const r = await apoio.regulamento(m, u, processoId, false);
    claude.disponivel = true;
    expect(r.destacado).toBe(false);
    expect(r.trechos.map((t) => t.origem)).toEqual(['base_legal', 'pesquisa']);
    expect(r.trechos[0].destaques).toEqual([]);
    expect(r.perguntas).toHaveLength(2);
  });

  it('regulamento com IA: destaques validados e cache', async () => {
    extrair.mockReset().mockResolvedValue({
      trechos: [
        {
          n: 1,
          porque_se_aplica: 'A obra é no interior.',
          frases: ['obras de alteração no interior', 'frase inventada'],
        },
      ],
    });
    const r = await apoio.regulamento(m, u, processoId, false);
    expect(r.destacado).toBe(true);
    expect(r.trechos).toHaveLength(1);
    const [d] = r.trechos[0].destaques;
    expect(TEXTO_BASE.slice(d.inicio, d.fim)).toBe(
      'obras de alteração no interior',
    );
    const r2 = await apoio.regulamento(m, u, processoId, false);
    expect(r2.em_cache).toBe(true);
    expect(extrair).toHaveBeenCalledTimes(1);
  });

  it('pedido de elementos: rascunho, edição, aprovação com pedido e SMS', async () => {
    escrever.mockResolvedValue(
      '```\nExma. Senhora,\n\nNos termos do art. 6.º, pedimos a planta.\n```',
    );
    const [doc] = await q(
      `SELECT id FROM tipo_processo_documentos WHERE nome = 'Planta de localização'
       AND tipo_processo_id = (SELECT tipo_processo_id FROM processos WHERE id = $1)`,
      [processoId],
    );
    const r = await apoio.criarRascunho(m, u, processoId, {
      tipo: 'pedido_elementos',
      documentos_pedidos: [
        { tipo_documento_id: doc.id },
        { texto: 'Fotografia da fachada' },
      ],
      prazo_dias_uteis: 10,
    });
    expect(r).toMatchObject({
      estado: 'rascunho',
      versao: 1,
      corpo: 'Exma. Senhora,\n\nNos termos do art. 6.º, pedimos a planta.',
      artigos_citados: [{ referencia: 'art. 6.º, n.º 1', fonte: 'RJUE' }],
    });
    expect(r.modelo_id).not.toBeNull();
    expect(escrever.mock.calls[0][0].conteudo).toContain(
      'Destinatário: Maria Fernandes',
    );
    expect(escrever.mock.calls[0][0].conteudo).toContain(
      '[ATENÇÃO] Parede a abrir: confirmar que não é estrutural',
    );

    const e = await apoio.editarRascunho(m, u, r.id, {
      corpo: 'Exma. Senhora,\n\nPedimos a planta e a fotografia.',
    });
    expect(e.versao).toBe(2);
    expect(e.versoes.map((v) => v.origem)).toEqual(['ia', 'tecnico']);
    expect(e.artigos_citados).toEqual([]);

    const a = await apoio.aprovarRascunho(m, u, r.id);
    expect(a).toMatchObject({
      estado: 'aprovado',
      assinatura_simulada: true,
      assinado_por: { id: u.id, nome: 'Ana Costa' },
      aviso: 'sms',
      pdf_url: null,
    });
    expect(a.pdf_aviso).toMatch(/Sem armazenamento/);
    expect(a.pedido_ids).toHaveLength(2);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(sms.mock.calls[0][0].corpo).toContain(
      'Planta de localização, Fotografia da fachada',
    );
    const ev = await q(
      `SELECT tipo, interno FROM processo_eventos WHERE processo_id = $1 AND tipo IN ('pedido_elementos', 'documento_pedido')`,
      [processoId],
    );
    expect(ev).toHaveLength(3);
    expect(ev.every((x: { interno: boolean }) => !x.interno)).toBe(true);

    await expect(apoio.aprovarRascunho(m, u, r.id)).rejects.toMatchObject({
      codigo: 'rascunho_fechado',
    });
  });

  it('ofício descartado e contagens na ficha', async () => {
    escrever.mockResolvedValue('Exma. Senhora, informamos.');
    const r = await apoio.criarRascunho(m, u, processoId, {
      tipo: 'oficio',
      prazo_dias_uteis: 10,
    });
    const d = await apoio.descartarRascunho(m, u, r.id);
    expect(d.estado).toBe('descartado');
    const l = await apoio.listarRascunhos(m, processoId);
    expect(l.itens).toHaveLength(2);
    expect((await painel.detalhe(m, processoId)).apoio.rascunhos).toEqual({
      total: 2,
      rascunho: 0,
      aprovado: 1,
      descartado: 1,
    });
  });
});
