import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { hojeLisboa } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ConhecimentoService } from '../conhecimento/conhecimento.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  aplicarEscolha,
  artigosCitados,
  CANAL_MODELO,
  conteudoRascunho,
  conteudoRegulamento,
  ContextoProcesso,
  descricaoDoRequerimento,
  dia,
  esquemaRegulamentoIa,
  esquemaResumoProcesso,
  HASH_PROCESSO,
  HASH_REGULAMENTO,
  juntarTrechos,
  MAX_TRECHOS_APOIO,
  limparRascunho,
  limparResumo,
  montarContextoProcesso,
  perguntasRegulamento,
  proximoPrazo,
  ResumoProcesso,
  semDestaques,
  trechosAplicaveis,
  SISTEMA_RASCUNHO,
  SISTEMA_REGULAMENTO,
  SISTEMA_RESUMO_PROCESSO,
  smsComLink,
  TIPO_RASCUNHO_ROTULO,
  TIPOS_RASCUNHO,
  TipoRascunho,
  TrechoDestacado,
  TrechoRegulamento,
} from './apoio.js';
import { PRAZO_PEDIDO_DIAS_UTEIS } from './avisos.js';
import { gerarPdfOficio } from './oficio-pdf.js';
import { ProcessosAvisosService } from './processos-avisos.service.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import { ProcessosVerificacoesService } from './processos-verificacoes.service.js';
import { Fase } from './regras.js';

export const esquemaAtualizarCache = z.object({
  /** Gerar de novo mesmo que o processo não tenha mudado. */
  atualizar: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});

export const esquemaNovoRascunho = z
  .object({
    tipo: z.enum(TIPOS_RASCUNHO),
    instrucoes: z.string().trim().min(1).max(2000).optional(),
    modelo_id: z.uuid().optional(),
    /** Pedido de elementos: o que se pede (um tipo de documento do processo ou texto livre). */
    documentos_pedidos: z
      .array(
        z.union([
          z.object({ tipo_documento_id: z.uuid() }),
          z.object({ texto: z.string().trim().min(2).max(200) }),
        ]),
      )
      .min(1)
      .max(15)
      .optional(),
    /** Prazo do munícipe para entregar (pedido de elementos); 10 dias úteis por omissão. */
    prazo_dias_uteis: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(PRAZO_PEDIDO_DIAS_UTEIS),
  })
  .refine(
    (b) => b.tipo !== 'pedido_elementos' || !!b.documentos_pedidos?.length,
    {
      message: 'Indique os documentos a pedir (documentos_pedidos).',
      path: ['documentos_pedidos'],
    },
  );

export const esquemaEditarRascunho = z.object({
  corpo: z.string().trim().min(1).max(20000),
});

type Detalhe = Awaited<ReturnType<ProcessosPainelService['detalhe']>>;

interface DadosRascunhoGuardados {
  documentos_pedidos?: { tipo_documento_id: string | null; nome: string }[];
  prazo_dias_uteis?: number;
  regulamento?: { referencia: string | null; fonte: string }[];
  artigos_citados?: { referencia: string; fonte: string }[];
  evento_id?: string;
  pedido_ids?: string[];
  aviso?: string | null;
  pdf_aviso?: string | null;
  /** As verificações que entraram no rascunho (auditoria). */
  verificacoes?: {
    gerado_em: Date;
    contagem: Record<string, number>;
    versao: { motor: string; documentos: string; regras: string };
  } | null;
}

interface LinhaRascunho {
  id: string;
  processo_id: string;
  tipo: TipoRascunho;
  modelo_id: string | null;
  versao: number;
  corpo: string;
  estado: string;
  assinatura: string | null;
  assinado_por: string | null;
  assinado_por_nome: string | null;
  assinado_em: Date | null;
  pdf_key: string | null;
  instrucoes: string | null;
  dados: DadosRascunhoGuardados;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: Date;
  atualizado_em: Date;
  descartado_em: Date | null;
}

const SELECT_RASCUNHO = `
  SELECT g.id, g.processo_id, g.tipo, g.modelo_id, g.versao, g.corpo, g.estado, g.assinatura,
         g.assinado_por, ua.nome AS assinado_por_nome, g.assinado_em, g.pdf_key, g.instrucoes,
         g.dados, g.criado_por, uc.nome AS criado_por_nome, g.criado_em, g.atualizado_em,
         g.descartado_em
  FROM documentos_gerados g
  JOIN processos p ON p.id = g.processo_id
  LEFT JOIN utilizadores ua ON ua.id = g.assinado_por
  LEFT JOIN utilizadores uc ON uc.id = g.criado_por`;

/** O que a IA indisponível devolve (sem chave ou fornecedor em baixo). */
function iaIndisponivel(e: unknown): boolean {
  return e instanceof ErroApi && e.codigo === 'ia_indisponivel';
}

/**
 * Apoio ao técnico no painel dos processos ("Para os técnicos"): resumo do
 * processo numa página, regulamento aplicável destacado e rascunhos de
 * ofício, pedido de elementos ou SMS que o técnico revê e aprova.
 *
 * Resumo e regulamento ficam em `processo_apoio` com o hash do estado de que
 * partiram: só se volta a chamar a IA quando o processo (ou as fontes, no
 * regulamento) mudou, ou com `?atualizar=true`. Sem IA o resumo e os
 * rascunhos respondem 503; o regulamento devolve os trechos sem destaques.
 */
@Injectable()
export class ProcessosApoioService {
  private readonly logger = new Logger(ProcessosApoioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly conhecimento: ConhecimentoService,
    private readonly painel: ProcessosPainelService,
    private readonly processos: ProcessosService,
    private readonly avisos: ProcessosAvisosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
    private readonly verificacoes: ProcessosVerificacoesService,
  ) {}

  // -------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------

  private async hash(
    processoId: string,
    tipo: 'resumo' | 'regulamento',
  ): Promise<string> {
    const [r] = await this.db.query<{ hash: string }>(
      `SELECT ${tipo === 'resumo' ? HASH_PROCESSO : HASH_REGULAMENTO} AS hash
       FROM processos p WHERE p.id = $1`,
      [processoId],
    );
    return r.hash;
  }

  private async cache<T>(
    processoId: string,
    tipo: 'resumo' | 'regulamento',
  ): Promise<{ estado_hash: string; conteudo: T; gerado_em: Date } | null> {
    const [r] = await this.db.query<{
      estado_hash: string;
      conteudo: T;
      gerado_em: Date;
    }>(
      `SELECT estado_hash, conteudo, gerado_em FROM processo_apoio
       WHERE processo_id = $1 AND tipo = $2`,
      [processoId, tipo],
    );
    return r ?? null;
  }

  private async guardar(
    processoId: string,
    tipo: 'resumo' | 'regulamento',
    hash: string,
    conteudo: unknown,
    u: UtilizadorPainel,
  ): Promise<Date> {
    const [r] = await this.db.query<{ gerado_em: Date }>(
      `INSERT INTO processo_apoio (processo_id, tipo, estado_hash, conteudo, gerado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (processo_id, tipo) DO UPDATE
         SET estado_hash = EXCLUDED.estado_hash, conteudo = EXCLUDED.conteudo,
             gerado_por = EXCLUDED.gerado_por, gerado_em = now()
       RETURNING gerado_em`,
      [processoId, tipo, hash, JSON.stringify(conteudo), u.id],
    );
    return r.gerado_em;
  }

  // -------------------------------------------------------------------------
  // Contexto
  // -------------------------------------------------------------------------

  private async conversaDeOrigem(
    processoId: string,
  ): Promise<ContextoProcesso['conversa']> {
    const [c] = await this.db.query<{
      canal: string;
      iniciada_em: Date;
      resumo: string | null;
      proximos_passos: unknown;
    }>(
      `SELECT c.canal::text AS canal, c.iniciada_em, c.resumo, c.proximos_passos
       FROM processos p
       JOIN conversas c ON c.id = coalesce(p.conversa_origem_id,
         (SELECT r.conversa_id FROM requerimentos r
          WHERE r.processo_id = p.id AND r.conversa_id IS NOT NULL
          ORDER BY r.criado_em LIMIT 1))
       WHERE p.id = $1`,
      [processoId],
    );
    if (!c) return null;
    return {
      canal: c.canal,
      iniciada_em: c.iniciada_em,
      resumo: c.resumo,
      proximos_passos: Array.isArray(c.proximos_passos)
        ? c.proximos_passos.filter((x): x is string => typeof x === 'string')
        : [],
    };
  }

  /** A ficha do painel no formato que `montarContextoProcesso` lê. */
  private async contexto(d: Detalhe): Promise<ContextoProcesso> {
    return {
      numero: d.numero,
      tipo: d.tipo,
      assunto: d.assunto,
      morada: d.morada,
      freguesia: d.freguesia,
      fase: d.fase,
      fase_rotulo: d.fase_rotulo,
      decisao: d.decisao,
      tecnico: d.tecnico?.nome ?? null,
      prazo: {
        inicio: d.prazo.inicio,
        fim: d.prazo.fim,
        dias_uteis_restantes: d.prazo.dias_uteis_restantes,
      },
      municipe: d.municipe
        ? {
            nome: d.municipe.nome,
            tem_telefone: !!d.municipe.telefone,
            tem_email: d.municipe.tem_email,
          }
        : null,
      requerimento: d.requerimento
        ? {
            estado: d.requerimento.estado,
            assinatura: d.requerimento.assinatura,
            campos: d.requerimento.dados,
          }
        : null,
      documentos: d.documentos.map((x) => ({
        tipo_documento: x.tipo_documento,
        origem: x.origem,
        verificacao_estado: x.verificacao_estado,
        verificacao: x.verificacao,
        emitido_em: x.emitido_em,
        recebido_em: x.recebido_em,
      })),
      em_falta: d.documentos_resumo.em_falta,
      pedidos: d.pedidos.map((x) => ({
        descricao: x.descricao,
        nota: x.nota,
        prazo: x.prazo,
        estado: x.estado,
      })),
      eventos: d.eventos.map((e) => ({
        tipo: String(e.tipo),
        descricao: String(e.descricao),
        interno: e.interno === true,
        ator_nome: typeof e.ator_nome === 'string' ? e.ator_nome : null,
        em: e.em as Date,
      })),
      conversa: await this.conversaDeOrigem(d.id),
    };
  }

  /** O próximo prazo de hoje (não fica em cache: os dias passam). */
  private async prazoDeHoje(
    municipioId: string,
    p: { id: string; fase: Fase; prazo_fim: string | null },
  ) {
    const pedidos = await this.processos.pedidos(municipioId, p.id);
    return proximoPrazo(p, pedidos, hojeLisboa());
  }

  // -------------------------------------------------------------------------
  // 1. Resumo do processo
  // -------------------------------------------------------------------------

  async resumo(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    atualizar: boolean,
  ) {
    const p = await this.painel.carregar(municipio.id, id);
    // O hash antes de ler: se o processo mudar a meio, o próximo pedido regenera.
    const hash = await this.hash(id, 'resumo');
    const guardado = await this.cache<ResumoProcesso>(id, 'resumo');
    let conteudo: ResumoProcesso;
    let geradoEm: Date;
    let emCache = false;
    if (!atualizar && guardado && guardado.estado_hash === hash) {
      conteudo = guardado.conteudo;
      geradoEm = guardado.gerado_em;
      emCache = true;
    } else {
      this.exigirIa();
      const d = await this.painel.detalhe(municipio, id);
      const hoje = hojeLisboa();
      const r = await this.claude.extrair(esquemaResumoProcesso, {
        tarefa: 'resumo_processo',
        minimizar: true,
        sistema: SISTEMA_RESUMO_PROCESSO,
        esforco: 'medium',
        maxTokens: 6000,
        conteudo: montarContextoProcesso(await this.contexto(d), hoje),
      });
      conteudo = limparResumo(
        r,
        proximoPrazo({ fase: d.fase, prazo_fim: d.prazo.fim }, d.pedidos, hoje),
      );
      geradoEm = await this.guardar(id, 'resumo', hash, conteudo, u);
    }

    await this.auditoria.registar({
      municipioId: municipio.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'ver_resumo',
      objetoTipo: 'processo',
      objetoId: id,
      dados: { em_cache: emCache },
    });

    return {
      processo_id: id,
      numero: p.numero,
      ...conteudo,
      prazos: {
        texto: conteudo.prazos.texto,
        proximo: await this.prazoDeHoje(municipio.id, p),
      },
      gerado_em: geradoEm,
      em_cache: emCache,
    };
  }

  private exigirIa() {
    if (!this.claude.disponivel) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'O assistente de IA não está ligado nesta instalação.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. Regulamento aplicável destacado
  // -------------------------------------------------------------------------

  /** O trecho da base legal do tipo de processo (se a câmara o definiu). */
  private async baseLegal(
    municipioId: string,
    tipoProcessoId: string,
  ): Promise<TrechoRegulamento[]> {
    const linhas = await this.db.query<{
      trecho_id: string;
      referencia: string | null;
      texto: string;
      fonte: string;
      entidade: string | null;
      url: string;
      lida_em: Date;
    }>(
      `SELECT tr.id AS trecho_id, tr.referencia, tr.texto, fo.titulo AS fonte,
              e.nome AS entidade, fo.url, fv.lida_em
       FROM tipos_processo tp
       JOIN trechos tr ON tr.id = tp.base_legal_trecho
       JOIN fonte_versoes fv ON fv.id = tr.fonte_versao_id
       JOIN fontes fo ON fo.id = fv.fonte_id
       LEFT JOIN entidades e ON e.id = fo.entidade_id
       WHERE tp.id = $1 AND tp.municipio_id = $2`,
      [tipoProcessoId, municipioId],
    );
    return linhas.map((l) => ({
      trecho_id: l.trecho_id,
      referencia: l.referencia,
      texto: l.texto,
      fonte: l.fonte,
      entidade: l.entidade,
      url: l.url,
      data: dia(l.lida_em),
      origem: 'base_legal' as const,
    }));
  }

  private async pesquisa(
    municipioId: string,
    pergunta: string,
  ): Promise<TrechoRegulamento[]> {
    try {
      const r = await this.conhecimento.procurar(municipioId, pergunta, 6);
      return r.trechos.map((t) => ({
        trecho_id: t.trecho_id,
        referencia: t.referencia,
        texto: t.texto,
        fonte: t.titulo,
        entidade: t.entidade,
        url: t.url,
        data: t.lida_em ? dia(t.lida_em) : null,
        origem: 'pesquisa' as const,
        tipo_fonte: t.tipo_fonte,
      }));
    } catch (e) {
      this.logger.warn(
        `Pesquisa do regulamento falhou: ${(e as Error).message}`,
      );
      return [];
    }
  }

  async regulamento(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    atualizar: boolean,
  ) {
    const linha = await this.painel.carregar(municipio.id, id);
    const hash = await this.hash(id, 'regulamento');
    const guardado = await this.cache<{
      perguntas: string[];
      trechos: TrechoDestacado[];
      /** O texto do processo com que se filtraram os trechos. */
      processo?: string;
    }>(id, 'regulamento');
    if (!atualizar && guardado && guardado.estado_hash === hash) {
      // Guardados antes do filtro podem trazer trechos de outros assuntos.
      const processo =
        guardado.conteudo.processo ??
        `${linha.tipo_codigo} ${linha.tipo_nome}. ${linha.assunto}`;
      return {
        processo_id: id,
        perguntas: guardado.conteudo.perguntas,
        trechos: trechosAplicaveis(guardado.conteudo.trechos, processo),
        destacado: true,
        ia_disponivel: this.claude.disponivel,
        gerado_em: guardado.gerado_em,
        em_cache: true,
      };
    }

    const d = await this.painel.detalhe(municipio, id);
    const resumo = await this.cache<ResumoProcesso>(id, 'resumo');
    const descricao = descricaoDoRequerimento(d.requerimento?.dados ?? []);
    // Os pontos do caso: do resumo (mesmo antigo), senão o que falta e as notas.
    const pontos = resumo
      ? [resumo.conteudo.o_caso, ...resumo.conteudo.pontos_de_atencao]
      : [
          ...d.documentos_resumo.faltam,
          ...d.eventos
            .filter((e) => e.tipo === 'nota_interna')
            .slice(-3)
            .map((e) => String(e.descricao)),
        ];
    const perguntas = perguntasRegulamento({
      tipo: d.tipo.nome,
      assunto: d.assunto,
      descricao,
      pontos,
    });
    const [base, ...pesquisas] = await Promise.all([
      this.baseLegal(municipio.id, d.tipo.id),
      ...perguntas.map((q) => this.pesquisa(municipio.id, q)),
    ]);
    // Só os que se aplicam a este tipo de processo (sem as esplanadas numa
    // ampliação de moradia); a IA escolhe entre estes e mostram-se até 3.
    const processo = [`${d.tipo.codigo} ${d.tipo.nome}`, d.assunto, descricao]
      .filter(Boolean)
      .join('. ');
    const trechos = trechosAplicaveis(
      juntarTrechos([base, ...pesquisas]),
      processo,
      12,
    );

    const semIa = () => ({
      processo_id: id,
      perguntas,
      trechos: semDestaques(trechos).slice(0, MAX_TRECHOS_APOIO),
      destacado: false,
      ia_disponivel: false,
      gerado_em: null,
      em_cache: false,
    });
    if (!this.claude.disponivel) return semIa();

    let destacados: TrechoDestacado[] = [];
    if (trechos.length) {
      const caso = resumo
        ? `${resumo.conteudo.o_caso}\nPontos de atenção: ${resumo.conteudo.pontos_de_atencao.join('; ') || 'nenhum'}`
        : [
            `${d.tipo.codigo} ${d.tipo.nome}`,
            `Assunto: ${d.assunto}`,
            d.morada ? `Local: ${d.morada}` : '',
            descricao ? `Descrição: ${descricao}` : '',
            `Fase: ${d.fase_rotulo}`,
          ]
            .filter(Boolean)
            .join('\n');
      try {
        const escolha = await this.claude.extrair(esquemaRegulamentoIa, {
          tarefa: 'escolher_regulamento',
          sistema: SISTEMA_REGULAMENTO,
          esforco: 'medium',
          maxTokens: 8000,
          conteudo: conteudoRegulamento(caso, trechos),
        });
        destacados = aplicarEscolha(trechos, escolha).slice(
          0,
          MAX_TRECHOS_APOIO,
        );
      } catch (e) {
        if (iaIndisponivel(e)) return semIa();
        throw e;
      }
    }
    const conteudo = { perguntas, trechos: destacados, processo };
    const geradoEm = await this.guardar(id, 'regulamento', hash, conteudo, u);
    return {
      processo_id: id,
      perguntas,
      trechos: destacados,
      destacado: true,
      ia_disponivel: true,
      gerado_em: geradoEm,
      em_cache: false,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Rascunhos (ofício, pedido de elementos, SMS)
  // -------------------------------------------------------------------------

  /**
   * O modelo aprovado da câmara para o canal: o pedido, se vier (tem de estar
   * aprovado e ser do canal), senão o aprovado mais recente do canal (num
   * pedido de elementos, de preferência um com "elementos" no nome).
   */
  private async modelo(
    municipioId: string,
    tipo: TipoRascunho,
    modeloId: string | undefined,
  ) {
    const canal = CANAL_MODELO[tipo];
    // O parecer é interno: os modelos de ofício são para o requerente.
    if (tipo === 'parecer' && !modeloId) return null;
    if (modeloId) {
      const [m] = await this.db.query<{
        id: string;
        nome: string;
        corpo: string;
      }>(
        `SELECT id, nome, corpo FROM modelos_resposta
         WHERE id = $1 AND municipio_id = $2 AND canal = $3 AND estado = 'aprovado'`,
        [modeloId, municipioId, canal],
      );
      if (!m) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'modelo_invalido',
          'Esse modelo não existe, não está aprovado ou não é deste canal.',
        );
      }
      return m;
    }
    const [m] = await this.db.query<{
      id: string;
      nome: string;
      corpo: string;
    }>(
      `SELECT id, nome, corpo FROM modelos_resposta
       WHERE municipio_id = $1 AND canal = $2 AND estado = 'aprovado'
       ORDER BY ($3::boolean AND nome ILIKE '%elementos%') DESC, aprovado_em DESC NULLS LAST, versao DESC
       LIMIT 1`,
      [municipioId, canal, tipo === 'pedido_elementos'],
    );
    return m ?? null;
  }

  private async documentosPedidos(
    tipoProcessoId: string,
    itens: z.output<typeof esquemaNovoRascunho>['documentos_pedidos'],
  ) {
    const r: { tipo_documento_id: string | null; nome: string }[] = [];
    for (const x of itens ?? []) {
      if ('texto' in x) {
        r.push({ tipo_documento_id: null, nome: x.texto });
        continue;
      }
      const [d] = await this.db.query<{ nome: string }>(
        'SELECT nome FROM tipo_processo_documentos WHERE id = $1 AND tipo_processo_id = $2',
        [x.tipo_documento_id, tipoProcessoId],
      );
      if (!d) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'documento_desconhecido',
          'Esse documento não é deste tipo de processo.',
          { tipo_documento_id: x.tipo_documento_id },
        );
      }
      r.push({ tipo_documento_id: x.tipo_documento_id, nome: d.nome });
    }
    return r;
  }

  async criarRascunho(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaNovoRascunho>,
  ) {
    this.exigirIa();
    const p = await this.painel.carregar(municipio.id, id);
    const [documentos, modelo, d] = await Promise.all([
      this.documentosPedidos(p.tipo_processo_id, b.documentos_pedidos),
      this.modelo(municipio.id, b.tipo, b.modelo_id),
      this.painel.detalhe(municipio, id),
    ]);
    // O regulamento destacado e as verificações (da cache, se nada mudou).
    const [reg, verificacoes] = await Promise.all([
      this.regulamento(municipio, u, id, false),
      this.verificacoes.obter(municipio, u, id, false),
    ]);
    const [destinatario] = p.municipe_id
      ? await this.db.query<{ nome: string | null }>(
          'SELECT nome FROM municipes WHERE id = $1 AND anonimizado_em IS NULL',
          [p.municipe_id],
        )
      : [];

    const texto = await this.claude.escrever({
      tarefa: 'rascunho_parecer',
      sistema: SISTEMA_RASCUNHO[b.tipo],
      esforco: 'high',
      maxTokens: 8000,
      conteudo: conteudoRascunho({
        tipo: b.tipo,
        municipio: municipio.nome,
        processo: montarContextoProcesso(await this.contexto(d), hojeLisboa()),
        destinatario: destinatario?.nome ?? null,
        regulamento: reg.trechos,
        modelo,
        documentos_pedidos: documentos,
        prazo_dias_uteis:
          b.tipo === 'pedido_elementos' ? b.prazo_dias_uteis : null,
        instrucoes: b.instrucoes ?? null,
        verificacoes: verificacoes.itens,
      }),
    });
    const corpo = limparRascunho(texto, b.tipo);
    if (!corpo) {
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'ia_resposta_invalida',
        'A IA não devolveu texto para o rascunho.',
      );
    }
    const regulamento = reg.trechos.map((t) => ({
      referencia: t.referencia,
      fonte: t.fonte,
    }));
    const dados: DadosRascunhoGuardados = {
      ...(b.tipo === 'pedido_elementos'
        ? {
            documentos_pedidos: documentos,
            prazo_dias_uteis: b.prazo_dias_uteis,
          }
        : {}),
      regulamento,
      artigos_citados: artigosCitados(corpo, regulamento),
      verificacoes: {
        gerado_em: verificacoes.gerado_em,
        contagem: verificacoes.contagem,
        versao: verificacoes.versao,
      },
    };

    const rascunhoId = await this.db.transaction(async (tx) => {
      const [g] = await tx.query<{ id: string }>(
        `INSERT INTO documentos_gerados (processo_id, tipo, modelo_id, versao, corpo, estado,
           instrucoes, dados, criado_por)
         VALUES ($1, $2, $3, 1, $4, 'rascunho', $5, $6, $7) RETURNING id`,
        [
          id,
          b.tipo,
          modelo?.id ?? null,
          corpo,
          b.instrucoes ?? null,
          JSON.stringify(dados),
          u.id,
        ],
      );
      await tx.query(
        `INSERT INTO documento_gerado_versoes (documento_id, versao, corpo, origem, autor_id)
         VALUES ($1, 1, $2, 'ia', $3)`,
        [g.id, corpo, u.id],
      );
      return g.id;
    });
    return this.verRascunho(municipio, rascunhoId);
  }

  async listarRascunhos(municipio: Municipio, processoId: string) {
    await this.painel.carregar(municipio.id, processoId);
    const linhas = await this.db.query<LinhaRascunho>(
      `${SELECT_RASCUNHO} WHERE g.processo_id = $1 AND p.municipio_id = $2
       ORDER BY g.criado_em DESC, g.id`,
      [processoId, municipio.id],
    );
    const versoes = await this.versoes(linhas.map((l) => l.id));
    return {
      itens: await Promise.all(
        linhas.map((l) => this.mostrar(l, versoes.get(l.id) ?? [])),
      ),
      armazenamento_disponivel: this.armazenamento.disponivel,
    };
  }

  private async versoes(ids: string[]) {
    const m = new Map<
      string,
      {
        versao: number;
        origem: string;
        autor: string | null;
        em: Date;
        corpo: string;
      }[]
    >();
    if (!ids.length) return m;
    const linhas = await this.db.query<{
      documento_id: string;
      versao: number;
      origem: string;
      autor: string | null;
      em: Date;
      corpo: string;
    }>(
      `SELECT v.documento_id, v.versao, v.origem, u.nome AS autor, v.em, v.corpo
       FROM documento_gerado_versoes v
       LEFT JOIN utilizadores u ON u.id = v.autor_id
       WHERE v.documento_id = ANY($1::uuid[])
       ORDER BY v.documento_id, v.versao`,
      [ids],
    );
    for (const { documento_id, ...v } of linhas) {
      const l = m.get(documento_id) ?? [];
      l.push(v);
      m.set(documento_id, l);
    }
    return m;
  }

  private async mostrar(
    l: LinhaRascunho,
    versoes: {
      versao: number;
      origem: string;
      autor: string | null;
      em: Date;
      corpo: string;
    }[],
  ) {
    return {
      id: l.id,
      processo_id: l.processo_id,
      tipo: l.tipo,
      tipo_rotulo: TIPO_RASCUNHO_ROTULO[l.tipo],
      estado: l.estado,
      versao: l.versao,
      corpo: l.corpo,
      modelo_id: l.modelo_id,
      instrucoes: l.instrucoes,
      documentos_pedidos: l.dados.documentos_pedidos ?? null,
      prazo_dias_uteis: l.dados.prazo_dias_uteis ?? null,
      artigos_citados: l.dados.artigos_citados ?? [],
      assinatura: l.assinatura,
      assinatura_simulada: l.assinatura === 'simulada',
      assinado_por: l.assinado_por
        ? { id: l.assinado_por, nome: l.assinado_por_nome }
        : null,
      assinado_em: l.assinado_em,
      pdf_url:
        l.pdf_key && this.armazenamento.disponivel
          ? await this.armazenamento.urlLeitura(l.pdf_key, 10)
          : null,
      pdf_aviso: l.dados.pdf_aviso ?? null,
      aviso: l.dados.aviso ?? null,
      pedido_ids: l.dados.pedido_ids ?? [],
      criado_por: l.criado_por
        ? { id: l.criado_por, nome: l.criado_por_nome }
        : null,
      criado_em: l.criado_em,
      atualizado_em: l.atualizado_em,
      descartado_em: l.descartado_em,
      // Todas as versões, da 1 (IA) à atual; as anteriores não se perdem.
      versoes,
    };
  }

  private async verRascunho(municipio: Municipio, id: string) {
    const [l] = await this.db.query<LinhaRascunho>(
      `${SELECT_RASCUNHO} WHERE g.id = $1 AND p.municipio_id = $2`,
      [id, municipio.id],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Rascunho não existe.',
      );
    }
    const v = await this.versoes([id]);
    return this.mostrar(l, v.get(id) ?? []);
  }

  /** O rascunho bloqueado, ainda por aprovar (senão 409). */
  private async rascunhoAberto(tx: Tx, municipioId: string, id: string) {
    const [l] = await tx.query<LinhaRascunho>(
      `${SELECT_RASCUNHO} WHERE g.id = $1 AND p.municipio_id = $2 FOR UPDATE OF g`,
      [id, municipioId],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Rascunho não existe.',
      );
    }
    if (l.estado !== 'rascunho') {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'rascunho_fechado',
        `Este rascunho já está ${l.estado}.`,
        { estado: l.estado },
      );
    }
    return l;
  }

  /** Nova versão do corpo; a anterior fica em `documento_gerado_versoes`. */
  async editarRascunho(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaEditarRascunho>,
  ) {
    await this.db.transaction(async (tx) => {
      const l = await this.rascunhoAberto(tx, municipio.id, id);
      const corpo = limparRascunho(b.corpo, l.tipo);
      if (corpo === l.corpo) return;
      const versao = l.versao + 1;
      await tx.query(
        `INSERT INTO documento_gerado_versoes (documento_id, versao, corpo, origem, autor_id)
         VALUES ($1, $2, $3, 'tecnico', $4)`,
        [id, versao, corpo, u.id],
      );
      const dados: DadosRascunhoGuardados = {
        ...l.dados,
        artigos_citados: artigosCitados(corpo, l.dados.regulamento ?? []),
      };
      await tx.query(
        `UPDATE documentos_gerados SET corpo = $2, versao = $3, dados = $4, atualizado_em = now()
         WHERE id = $1`,
        [id, corpo, versao, JSON.stringify(dados)],
      );
    });
    return this.verRascunho(municipio, id);
  }

  /**
   * Aprovado pelo técnico, com assinatura simulada (à vista no PDF e na
   * resposta). Fica na linha do tempo, visível ao munícipe. Pedido de
   * elementos: um pedido com prazo por documento e um só aviso (SMS ou
   * email) com a lista. SMS: vai ao munícipe com o link do processo. Ofício
   * e pedido de elementos: PDF depois do COMMIT (sem armazenamento fica só o
   * texto, com aviso).
   */
  async aprovarRascunho(municipio: Municipio, u: UtilizadorPainel, id: string) {
    const r = await this.db.transaction(async (tx) => {
      const l = await this.rascunhoAberto(tx, municipio.id, id);
      const p = await this.painel.carregar(
        municipio.id,
        l.processo_id,
        tx,
        true,
      );
      const tipo = l.tipo;
      await tx.query(
        `UPDATE documentos_gerados
         SET estado = 'aprovado', assinatura = 'simulada', assinado_por = $2,
             assinado_em = now(), atualizado_em = now()
         WHERE id = $1`,
        [id, u.id],
      );

      const descricao: Record<TipoRascunho, string> = {
        parecer: 'O técnico assinou o parecer técnico.',
        oficio: 'A câmara emitiu um ofício sobre o processo.',
        pedido_elementos: 'A câmara pediu elementos em falta (ofício).',
        notificacao_sms: 'A câmara enviou uma notificação sobre o processo.',
      };
      const e = await this.painel.evento(
        tx,
        p.id,
        u,
        tipo,
        descricao[tipo],
        // O parecer é interno (vai à chefia); o resto o munícipe vê.
        tipo === 'parecer',
        { documento_id: id, assinatura: 'simulada' },
      );

      const pedidoIds: string[] = [];
      let aviso: string | null = null;
      if (tipo === 'pedido_elementos') {
        const docs = l.dados.documentos_pedidos ?? [];
        const prazoDias = l.dados.prazo_dias_uteis ?? PRAZO_PEDIDO_DIAS_UTEIS;
        let prazo = '';
        for (const doc of docs) {
          const x = await this.painel.registarPedido(tx, municipio, u, p, {
            ...(doc.tipo_documento_id
              ? { tipo_documento_id: doc.tipo_documento_id }
              : {}),
            nome: doc.nome,
            prazo_dias_uteis: prazoDias,
          });
          pedidoIds.push(x.pedido_id);
          prazo = x.prazo;
        }
        if (pedidoIds.length) {
          aviso = await this.painel.avisarPedido(tx, municipio, p, {
            nome: docs.map((x) => x.nome).join(', '),
            nota: null,
            prazo,
            chave: `processo_rascunho:${id}`,
            pedidoId: pedidoIds[0],
          });
        }
      } else if (tipo === 'notificacao_sms') {
        const link = await this.processos.linkProcesso(municipio.id, p.id, tx);
        aviso = await this.avisos.enviar(tx, {
          municipioId: municipio.id,
          municipeId: p.municipe_id,
          aviso: {
            assunto: `Processo ${p.numero}`,
            texto: smsComLink(l.corpo, link),
          },
          motivo: 'processo',
          chave: `processo_rascunho:${id}`,
          relacionado: { processo_id: p.id, documento_id: id },
        });
      }
      await tx.query(
        'UPDATE processos SET atualizado_em = now() WHERE id = $1',
        [p.id],
      );
      const dados: DadosRascunhoGuardados = {
        ...l.dados,
        evento_id: e.id,
        pedido_ids: pedidoIds,
        aviso:
          tipo === 'oficio' || tipo === 'parecer'
            ? null
            : (aviso ?? 'sem_contacto'),
      };
      await tx.query('UPDATE documentos_gerados SET dados = $2 WHERE id = $1', [
        id,
        JSON.stringify(dados),
      ]);
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'aprovar',
          objetoTipo: 'documento_gerado',
          objetoId: id,
          dados: {
            processo_id: p.id,
            tipo,
            versao: l.versao,
            pedido_ids: pedidoIds,
          },
        },
        tx,
      );
      return { l, p, tipo, dados };
    });

    if (r.tipo !== 'notificacao_sms') {
      await this.pdf(municipio, u, id, r);
    }
    return this.verRascunho(municipio, id);
  }

  /** Depois do COMMIT: uma falha no PDF não desfaz a aprovação. */
  private async pdf(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    r: {
      l: LinhaRascunho;
      p: { numero: string; assunto: string };
      tipo: TipoRascunho;
      dados: DadosRascunhoGuardados;
    },
  ) {
    let pdfAviso: string | null = null;
    let chave: string | null = null;
    if (!this.armazenamento.disponivel) {
      pdfAviso =
        'Sem armazenamento configurado: o PDF não foi guardado, fica só o texto aprovado.';
    } else {
      try {
        const pdf = await gerarPdfOficio({
          municipio: municipio.nome,
          titulo: TIPO_RASCUNHO_ROTULO[r.tipo],
          numeroProcesso: r.p.numero,
          assuntoProcesso: r.p.assunto,
          data: hojeLisboa(),
          corpo: r.l.corpo,
          aprovacao: { por: u.nome, em: new Date(), simulada: true },
        });
        chave = this.armazenamento.chave(municipio.slug, 'documentos', 'pdf');
        await this.armazenamento.guardar(chave, pdf, 'application/pdf');
      } catch (e) {
        chave = null;
        pdfAviso = 'O PDF falhou: fica só o texto aprovado.';
        this.logger.warn(
          `PDF do rascunho ${id} falhou: ${(e as Error).message}`,
        );
      }
    }
    await this.db.query(
      `UPDATE documentos_gerados SET pdf_key = $2, dados = dados || $3::jsonb WHERE id = $1`,
      [id, chave, JSON.stringify({ pdf_aviso: pdfAviso })],
    );
  }

  async descartarRascunho(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
  ) {
    await this.db.transaction(async (tx) => {
      const l = await this.rascunhoAberto(tx, municipio.id, id);
      await tx.query(
        `UPDATE documentos_gerados
         SET estado = 'descartado', descartado_por = $2, descartado_em = now(), atualizado_em = now()
         WHERE id = $1`,
        [id, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'descartar',
          objetoTipo: 'documento_gerado',
          objetoId: id,
          dados: { processo_id: l.processo_id, tipo: l.tipo, versao: l.versao },
        },
        tx,
      );
    });
    return this.verRascunho(municipio, id);
  }
}
