import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CONSULTA_OU, EM_VIGOR, INICIO_VIGOR } from '../conhecimento/sql.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { GlossarioService, Termo } from './glossario.service.js';
import {
  AVISO_LEGAL,
  conteudoIa,
  desatualizada,
  detetarTermos,
  esquemaIa,
  esquemaParte,
  estadoDocumento,
  ligarTrechos,
  limparPartes,
  MAX_ORIGINAL_IA,
  Parte,
  ParteEntrada,
  rascunhoExtrativo,
  Seccao,
  seccoesDoOriginal,
  seccoesInvalidas,
  SISTEMA_SIMPLES,
  TIPOS_DOCUMENTO,
  TipoDocumento,
} from './regras.js';

export const esquemaCriar = z.object({
  fonte_id: z.uuid(),
  tipo: z.enum(TIPOS_DOCUMENTO),
});

export const esquemaGerar = z.object({
  /** ia (por defeito) ou extrativo: excertos do original, sem IA. */
  modo: z.enum(['ia', 'extrativo']).default('ia'),
});

export const esquemaRascunho = z.object({
  titulo: z.string().trim().min(3).max(200),
  resumo: z.string().trim().max(1000).default(''),
  partes: z.array(esquemaParte).max(40),
});

export const esquemaPublicar = z.object({
  /** Quem publica confirma que comparou com o texto oficial. */
  confirmo: z.literal(true, {
    error: 'Confirme que comparou a versão simples com o texto oficial.',
  }),
});

const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';

export interface DocLinha {
  id: string;
  municipio_id: string;
  fonte_id: string;
  codigo: string;
  tipo: TipoDocumento;
  fonte_titulo: string;
  fonte_url: string;
  fonte_tipo: string;
  entidade: string;
  versao_atual_id: string | null;
}

export interface VersaoLinha {
  id: string;
  numero: number;
  fonte_versao_id: string;
  hash_original: string;
  estado: string;
  origem: 'ia' | 'extrativo' | 'manual';
  titulo: string;
  resumo: string;
  partes: Parte[];
  criada_em: Date;
  criada_por_nome: string | null;
  editada_em: Date | null;
  revista_por_nome: string | null;
  publicada_em: Date | null;
}

export interface Original {
  versao_id: string;
  hash: string;
  texto: string;
  /** Desde quando vale (data legal ou primeira leitura), AAAA-MM-DD. */
  vigor_desde: string;
  lida_em: Date;
}

export interface OriginalFora {
  versao_id: string;
  vigor_desde: string;
  lida_em: Date;
  seccoes: (Seccao & { trechos: string[] })[];
}

const DOC_COLUNAS = `d.id, d.municipio_id, d.fonte_id, d.codigo, d.tipo,
  fo.titulo AS fonte_titulo, fo.url AS fonte_url, fo.tipo AS fonte_tipo,
  e.nome AS entidade,
  (SELECT v.id FROM fonte_versoes v WHERE v.fonte_id = fo.id AND ${EM_VIGOR('v')}
   ORDER BY v.lida_em DESC LIMIT 1) AS versao_atual_id`;

const VERSAO_COLUNAS = `v.id, v.numero, v.fonte_versao_id, v.hash_original, v.estado,
  v.origem, v.titulo, v.resumo, v.partes, v.criada_em, v.editada_em, v.publicada_em,
  uc.nome AS criada_por_nome, ur.nome AS revista_por_nome`;

const VERSAO_JUNCOES = `LEFT JOIN utilizadores uc ON uc.id = v.criada_por
  LEFT JOIN utilizadores ur ON ur.id = v.revista_por`;

/**
 * Versões em linguagem simples das fontes oficiais (FUN §14). Cada versão
 * fica presa à versão do texto oficial de onde foi escrita; publicar é a
 * revisão humana (recurso 'conhecimento') e só a publicada é pública.
 */
@Injectable()
export class LinguagemSimplesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly auditoria: AuditoriaService,
    private readonly glossario: GlossarioService,
    private readonly municipios: MunicipiosService,
    private readonly config: ConfigService,
  ) {}

  /** Link da página pública. */
  link(codigo: string): string {
    const base = (this.config.get<string>('app.webUrl') ?? '').replace(
      /\/$/,
      '',
    );
    return `${base}/documento/${codigo}`;
  }

  // --- Painel ---------------------------------------------------------------

  /** Todas as fontes do município, com o estado da versão simples. */
  async listar(municipioId: string) {
    const linhas = await this.db.query<{
      fonte_id: string;
      titulo: string;
      fonte_tipo: string;
      url: string;
      entidade: string;
      estado_fonte: string;
      versao_atual_id: string | null;
      documento_id: string | null;
      codigo: string | null;
      tipo: TipoDocumento | null;
      publicada: {
        id: string;
        numero: number;
        fonte_versao_id: string;
        publicada_em: string;
      } | null;
      rascunho: {
        id: string;
        numero: number;
        origem: string;
        criada_em: string;
      } | null;
    }>(
      `SELECT fo.id AS fonte_id, fo.titulo, fo.tipo AS fonte_tipo, fo.url, e.nome AS entidade,
              fo.estado AS estado_fonte, atual.id AS versao_atual_id,
              d.id AS documento_id, d.codigo, d.tipo,
              (SELECT jsonb_build_object('id', v.id, 'numero', v.numero,
                        'fonte_versao_id', v.fonte_versao_id, 'publicada_em', v.publicada_em)
               FROM documento_simples_versoes v
               WHERE v.documento_id = d.id AND v.estado = 'publicada') AS publicada,
              (SELECT jsonb_build_object('id', v.id, 'numero', v.numero,
                        'origem', v.origem, 'criada_em', v.criada_em)
               FROM documento_simples_versoes v
               WHERE v.documento_id = d.id AND v.estado = 'rascunho') AS rascunho
       FROM fontes fo
       JOIN entidades e ON e.id = fo.entidade_id
       LEFT JOIN documentos_simples d ON d.fonte_id = fo.id
       LEFT JOIN LATERAL (
         SELECT v.id FROM fonte_versoes v WHERE v.fonte_id = fo.id AND ${EM_VIGOR('v')}
         ORDER BY v.lida_em DESC LIMIT 1) atual ON true
       WHERE fo.municipio_id = $1
       ORDER BY (d.id IS NULL), lower(fo.titulo)`,
      [municipioId],
    );
    const itens = linhas.map((l) => ({
      ...l,
      tem_texto: l.versao_atual_id !== null,
      estado: estadoDocumento(l),
      link: l.codigo && l.publicada ? this.link(l.codigo) : null,
    }));
    const contar = (e: string) => itens.filter((i) => i.estado === e).length;
    return {
      itens,
      resumo: {
        publicadas: contar('publicada'),
        desatualizadas: contar('desatualizada'),
        rascunhos: contar('rascunho'),
      },
    };
  }

  /** Cria o documento simples de uma fonte (ou devolve o que já existe). */
  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaCriar>,
  ) {
    const [fonte] = await this.db.query<{ id: string }>(
      `SELECT id FROM fontes WHERE id = $1 AND municipio_id = $2`,
      [d.fonte_id, m.id],
    );
    if (!fonte) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'fonte_nao_encontrada',
        'Fonte não encontrada.',
      );
    }
    const id = await this.db.transaction(async (tx) => {
      const [existe] = await tx.query<{ id: string }>(
        `SELECT id FROM documentos_simples WHERE fonte_id = $1`,
        [d.fonte_id],
      );
      if (existe) return existe.id;
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const codigo = Array.from(
          { length: 8 },
          () => ALFABETO[randomInt(ALFABETO.length)],
        ).join('');
        const [novo] = await tx.query<{ id: string }>(
          `INSERT INTO documentos_simples (municipio_id, fonte_id, codigo, tipo, criado_por)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (codigo) DO NOTHING RETURNING id`,
          [m.id, d.fonte_id, codigo, d.tipo, u.id],
        );
        if (!novo) continue;
        await this.auditoria.registar(
          {
            municipioId: m.id,
            atorTipo: 'utilizador',
            atorId: u.id,
            acao: 'criar_documento_simples',
            objetoTipo: 'documento_simples',
            objetoId: novo.id,
            dados: { fonte_id: d.fonte_id, tipo: d.tipo },
          },
          tx,
        );
        return novo.id;
      }
      throw new Error('Não foi possível gerar um código livre.');
    });
    return this.ver(m.id, id);
  }

  /**
   * O documento para o editor: a fonte, o rascunho, a publicada, o histórico
   * e os originais (secções) das versões oficiais a que estão presas.
   */
  async ver(municipioId: string, id: string) {
    const d = await this.documento(municipioId, id);
    const versoes = await this.db.query<VersaoLinha>(
      `SELECT ${VERSAO_COLUNAS} FROM documento_simples_versoes v ${VERSAO_JUNCOES}
       WHERE v.documento_id = $1 ORDER BY v.numero DESC`,
      [id],
    );
    const rascunho = versoes.find((v) => v.estado === 'rascunho') ?? null;
    const publicada = versoes.find((v) => v.estado === 'publicada') ?? null;
    const ids = [
      ...new Set(
        [
          d.versao_atual_id,
          rascunho?.fonte_versao_id,
          publicada?.fonte_versao_id,
        ].filter((x): x is string => !!x),
      ),
    ];
    const originais: Record<string, OriginalFora> = {};
    for (const vid of ids) {
      const o = await this.original(vid);
      if (o) originais[vid] = this.originalParaFora(o, await this.trechos(vid));
    }
    const comEstado = (v: VersaoLinha | null) =>
      v && {
        ...v,
        desatualizada: desatualizada(v.fonte_versao_id, d.versao_atual_id),
      };
    return {
      id: d.id,
      codigo: d.codigo,
      tipo: d.tipo,
      link: publicada ? this.link(d.codigo) : null,
      fonte: {
        id: d.fonte_id,
        titulo: d.fonte_titulo,
        url: d.fonte_url,
        tipo: d.fonte_tipo,
        entidade: d.entidade,
      },
      versao_atual_id: d.versao_atual_id,
      estado: estadoDocumento({
        publicada,
        rascunho,
        versao_atual_id: d.versao_atual_id,
      }),
      ia_disponivel: this.claude.disponivel,
      rascunho: comEstado(rascunho),
      publicada: comEstado(publicada),
      historico: versoes.map((v) => ({
        id: v.id,
        numero: v.numero,
        estado: v.estado,
        origem: v.origem,
        fonte_versao_id: v.fonte_versao_id,
        criada_em: v.criada_em,
        criada_por_nome: v.criada_por_nome,
        revista_por_nome: v.revista_por_nome,
        publicada_em: v.publicada_em,
      })),
      originais,
      aviso_legal: AVISO_LEGAL,
    };
  }

  /**
   * Gera um rascunho novo a partir da versão ATUAL do texto oficial ("gerar
   * de novo" substitui o rascunho que houver). Com IA, linguagem simples;
   * sem IA, só se pedido 'extrativo' (excertos, marcado, por reescrever).
   */
  async gerar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    g: z.output<typeof esquemaGerar>,
  ) {
    const d = await this.documento(m.id, id);
    const o = await this.originalAtual(d);
    const seccoes = seccoesDoOriginal(o.texto);
    const porSeccao = ligarTrechos(seccoes, await this.trechos(o.versao_id));

    let proposta: { titulo: string; resumo: string; partes: ParteEntrada[] };
    if (g.modo === 'ia') {
      if (!this.claude.disponivel) {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ia_indisponivel',
          'Gerar a versão simples precisa da IA, que não está configurada. Pode escrevê-la à mão ou partir de excertos do texto oficial (que terá de reescrever antes de publicar).',
        );
      }
      if (o.texto.length > MAX_ORIGINAL_IA) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'documento_longo',
          'O texto oficial é demasiado longo para gerar de uma vez. Escreva a versão simples à mão, parte a parte.',
        );
      }
      proposta = await this.claude.extrair(esquemaIa, {
        sistema: SISTEMA_SIMPLES,
        conteudo: conteudoIa(d.fonte_titulo, d.tipo, seccoes),
        esforco: 'high',
      });
    } else {
      proposta = rascunhoExtrativo(d.fonte_titulo, seccoes);
    }
    const partes = limparPartes(proposta.partes, seccoes, porSeccao);
    if (!partes.length) {
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'sem_partes',
        'A versão gerada não tinha partes ligadas ao texto oficial. Tente outra vez ou escreva à mão.',
      );
    }
    const t = proposta.titulo.trim();
    const titulo = limitar(t.length >= 3 ? t : d.fonte_titulo, 200);
    const resumo = limitar(proposta.resumo.trim(), 1000);

    await this.db.transaction(async (tx) => {
      await this.bloquear(tx, id);
      await tx.query(
        `UPDATE documento_simples_versoes SET estado = 'descartada'
         WHERE documento_id = $1 AND estado = 'rascunho'`,
        [id],
      );
      const numero = await this.proximoNumero(tx, id);
      const [v] = await tx.query<{ id: string }>(
        `INSERT INTO documento_simples_versoes (municipio_id, documento_id, numero, fonte_versao_id,
                hash_original, origem, titulo, resumo, partes, criada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          m.id,
          id,
          numero,
          o.versao_id,
          o.hash,
          g.modo,
          titulo,
          resumo,
          JSON.stringify(partes),
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'gerar_versao_simples',
          objetoTipo: 'documento_simples',
          objetoId: id,
          dados: {
            versao_id: v.id,
            numero,
            origem: g.modo,
            fonte_versao_id: o.versao_id,
          },
        },
        tx,
      );
    });
    return this.ver(m.id, id);
  }

  /**
   * Grava o rascunho editado no painel. Sem rascunho, cria um (escrito à
   * mão) preso à versão atual do texto oficial. As secções têm de existir no
   * original desse rascunho.
   */
  async guardarRascunho(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    r: z.output<typeof esquemaRascunho>,
  ) {
    const d = await this.documento(m.id, id);
    await this.db.transaction(async (tx) => {
      await this.bloquear(tx, id);
      const [atual] = await tx.query<{ id: string; fonte_versao_id: string }>(
        `SELECT id, fonte_versao_id FROM documento_simples_versoes
         WHERE documento_id = $1 AND estado = 'rascunho'`,
        [id],
      );
      const o = atual
        ? await this.original(atual.fonte_versao_id, tx)
        : await this.originalAtual(d, tx);
      if (!o) throw semTexto();
      const seccoes = seccoesDoOriginal(o.texto);
      const invalidas = seccoesInvalidas(r.partes, seccoes);
      if (invalidas.length) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'seccao_invalida',
          'Há partes ligadas a secções que não existem no texto oficial.',
          { seccoes: invalidas },
        );
      }
      const semOrigem = r.partes.filter((p) => !p.seccoes.length).length;
      if (semOrigem) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'parte_sem_origem',
          'Cada parte tem de dizer de que artigo ou secção do texto oficial vem.',
        );
      }
      const partes = limparPartes(
        r.partes,
        seccoes,
        ligarTrechos(seccoes, await this.trechos(o.versao_id, tx)),
      );
      let versaoId: string;
      if (atual) {
        await tx.query(
          `UPDATE documento_simples_versoes SET titulo = $2, resumo = $3, partes = $4,
                  editada_por = $5, editada_em = now(),
                  -- Excertos reescritos por uma pessoa passam a escrita à mão.
                  origem = CASE WHEN origem = 'extrativo' THEN 'manual' ELSE origem END
           WHERE id = $1`,
          [atual.id, r.titulo, r.resumo, JSON.stringify(partes), u.id],
        );
        versaoId = atual.id;
      } else {
        const numero = await this.proximoNumero(tx, id);
        const [v] = await tx.query<{ id: string }>(
          `INSERT INTO documento_simples_versoes (municipio_id, documento_id, numero, fonte_versao_id,
                  hash_original, origem, titulo, resumo, partes, criada_por, editada_por, editada_em)
           VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9, $9, now()) RETURNING id`,
          [
            m.id,
            id,
            numero,
            o.versao_id,
            o.hash,
            r.titulo,
            r.resumo,
            JSON.stringify(partes),
            u.id,
          ],
        );
        versaoId = v.id;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'editar_versao_simples',
          objetoTipo: 'documento_simples',
          objetoId: id,
          dados: { versao_id: versaoId, partes: partes.length },
        },
        tx,
      );
    });
    return this.ver(m.id, id);
  }

  /**
   * Rever e publicar: só um rascunho preso à versão atual do texto oficial,
   * com partes, e (se veio de excertos) reescrito por alguém. A publicada
   * anterior fica 'substituida'.
   */
  async publicar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    versaoId: string,
  ) {
    const d = await this.documento(m.id, id);
    await this.db.transaction(async (tx) => {
      await this.bloquear(tx, id);
      const [v] = await tx.query<{
        id: string;
        estado: string;
        origem: string;
        fonte_versao_id: string;
        editada_em: Date | null;
        resumo: string;
        partes: Parte[];
        numero: number;
      }>(
        `SELECT id, estado, origem, fonte_versao_id, editada_em, resumo, partes, numero
         FROM documento_simples_versoes WHERE id = $1 AND documento_id = $2`,
        [versaoId, id],
      );
      if (!v) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'versao_nao_encontrada',
          'Versão não encontrada.',
        );
      }
      if (v.estado !== 'rascunho') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'nao_e_rascunho',
          'Só se publica um rascunho.',
        );
      }
      if (desatualizada(v.fonte_versao_id, d.versao_atual_id)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'rascunho_desatualizado',
          'O texto oficial mudou depois deste rascunho. Gere de novo (ou escreva) a partir do texto atual.',
        );
      }
      if (v.origem === 'extrativo' && !v.editada_em) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'extrativo_por_rever',
          'Este rascunho são excertos do texto oficial, ainda sem linguagem simples. Reescreva-o antes de publicar.',
        );
      }
      if (!v.partes.length || !v.resumo.trim()) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'rascunho_incompleto',
          'Falta o resumo ou as partes da versão simples.',
        );
      }
      await tx.query(
        `UPDATE documento_simples_versoes SET estado = 'substituida'
         WHERE documento_id = $1 AND estado = 'publicada'`,
        [id],
      );
      await tx.query(
        `UPDATE documento_simples_versoes SET estado = 'publicada', revista_por = $2, publicada_em = now()
         WHERE id = $1`,
        [v.id, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'publicar_versao_simples',
          objetoTipo: 'documento_simples',
          objetoId: id,
          dados: {
            versao_id: v.id,
            numero: v.numero,
            origem: v.origem,
            fonte_versao_id: v.fonte_versao_id,
          },
        },
        tx,
      );
    });
    return this.ver(m.id, id);
  }

  /** Tira a versão publicada do ar (a página pública deixa de abrir). */
  async retirar(m: Municipio, u: UtilizadorPainel, id: string) {
    await this.documento(m.id, id);
    await this.db.transaction(async (tx) => {
      const [v] = await tx.query<{ id: string }>(
        `UPDATE documento_simples_versoes SET estado = 'retirada', retirada_em = now()
         WHERE documento_id = $1 AND estado = 'publicada' RETURNING id`,
        [id],
      );
      if (!v) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'nada_publicado',
          'Não há versão publicada.',
        );
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'retirar_versao_simples',
          objetoTipo: 'documento_simples',
          objetoId: id,
          dados: { versao_id: v.id },
        },
        tx,
      );
    });
    return this.ver(m.id, id);
  }

  // --- Público ------------------------------------------------------------

  /**
   * A página pública: a versão simples publicada primeiro e o texto oficial
   * completo (com a data da versão e o link da fonte). Se a fonte mudou
   * depois do resumo, avisa e o texto oficial é o atual (o que vale).
   */
  async publico(codigo: string) {
    const [d] = await this.db.query<DocLinha & { municipio_nome: string }>(
      `SELECT ${DOC_COLUNAS}, mu.nome AS municipio_nome
       FROM documentos_simples d
       JOIN fontes fo ON fo.id = d.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       JOIN municipios mu ON mu.id = d.municipio_id
       WHERE d.codigo = $1`,
      [codigo.toLowerCase()],
    );
    const [v] = d
      ? await this.db.query<VersaoLinha>(
          `SELECT ${VERSAO_COLUNAS} FROM documento_simples_versoes v ${VERSAO_JUNCOES}
           WHERE v.documento_id = $1 AND v.estado = 'publicada'`,
          [d.id],
        )
      : [];
    if (!d || !v) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'documento_nao_publicado',
        'Este documento não existe ou ainda não foi publicado.',
      );
    }
    const velha = desatualizada(v.fonte_versao_id, d.versao_atual_id);
    const base = await this.original(
      velha && d.versao_atual_id ? d.versao_atual_id : v.fonte_versao_id,
    );
    if (!base) throw semTexto();
    const doResumo = velha ? await this.original(v.fonte_versao_id) : base;
    const seccoes = seccoesDoOriginal(base.texto);
    const termos = await this.glossario.ativos(d.municipio_id);
    const marcar = (texto: string) => detetarTermos(texto, termos);
    const usados = new Set<string>();
    const comMarcas = <T extends { texto: string }>(x: T) => {
      const termosX = marcar(x.texto);
      termosX.forEach((t) => usados.add(t.termo_id));
      return { ...x, termos: termosX };
    };
    const simples = {
      titulo: v.titulo,
      resumo: comMarcas({ texto: v.resumo }),
      partes: v.partes.map((p) =>
        comMarcas({
          chave: p.chave,
          titulo: p.titulo,
          texto: p.texto,
          // Com o original mudado, os ids das secções já não batem certo.
          seccoes: velha ? [] : p.seccoes,
        }),
      ),
      origem: v.origem,
      publicada_em: v.publicada_em,
      revista: true,
      desatualizada: velha,
      versao_oficial_do_resumo: doResumo?.vigor_desde ?? null,
    };
    const original = {
      versao_id: base.versao_id,
      vigor_desde: base.vigor_desde,
      lida_em: base.lida_em,
      seccoes: seccoes.map((s) =>
        comMarcas({ id: s.id, referencia: s.referencia, texto: s.texto }),
      ),
    };
    return {
      codigo: d.codigo,
      municipio: d.municipio_nome,
      tipo: d.tipo,
      titulo: d.fonte_titulo,
      fonte: { titulo: d.fonte_titulo, url: d.fonte_url, entidade: d.entidade },
      simples,
      original,
      glossario: termos
        .filter((t) => usados.has(t.id))
        .map((t) => termoPublico(t)),
      aviso_legal: AVISO_LEGAL,
    };
  }

  /** Os documentos publicados de um município (página e app). */
  async publicados(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const itens = await this.db.query<{
      codigo: string;
      tipo: string;
      titulo: string;
      resumo: string;
      fonte: string;
      publicada_em: Date;
      fonte_versao_id: string;
      versao_atual_id: string | null;
    }>(
      `SELECT d.codigo, d.tipo, v.titulo, v.resumo, fo.titulo AS fonte, v.publicada_em,
              v.fonte_versao_id,
              (SELECT x.id FROM fonte_versoes x WHERE x.fonte_id = fo.id AND ${EM_VIGOR('x')}
               ORDER BY x.lida_em DESC LIMIT 1) AS versao_atual_id
       FROM documentos_simples d
       JOIN documento_simples_versoes v ON v.documento_id = d.id AND v.estado = 'publicada'
       JOIN fontes fo ON fo.id = d.fonte_id
       WHERE d.municipio_id = $1
       ORDER BY lower(v.titulo)`,
      [m.id],
    );
    return {
      municipio: m.nome,
      itens: itens.map(({ fonte_versao_id, versao_atual_id, ...i }) => ({
        ...i,
        desatualizada: desatualizada(fonte_versao_id, versao_atual_id),
        link: this.link(i.codigo),
      })),
    };
  }

  /** O glossário público de um município. */
  async glossarioPublico(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const termos = await this.glossario.ativos(m.id);
    return {
      municipio: m.nome,
      itens: termos.map((t) => termoPublico(t)),
      demonstracao: termos.some((t) => t.demonstracao),
    };
  }

  // --- Agente -------------------------------------------------------------

  /**
   * Ferramenta `documento_simples`: as versões simples publicadas (e ainda
   * certas) que respondem à pesquisa, com o link da página.
   */
  async paraAgente(municipioId: string, pesquisa: string) {
    const linhas = await this.db.query<{
      codigo: string;
      tipo: string;
      titulo: string;
      resumo: string;
      partes: Parte[];
      fonte: string;
      url: string;
      vigor_desde: string;
    }>(
      `WITH c AS (${CONSULTA_OU(2)})
       SELECT d.codigo, d.tipo, v.titulo, v.resumo, v.partes, fo.titulo AS fonte, fo.url,
              to_char(${INICIO_VIGOR('fv')}, 'YYYY-MM-DD') AS vigor_desde,
              ts_rank_cd(to_tsvector('pt_unaccent', fo.titulo || ' ' || v.titulo || ' ' || v.resumo), c.q, 32) AS pontuacao
       FROM c, documentos_simples d
       JOIN documento_simples_versoes v ON v.documento_id = d.id AND v.estado = 'publicada'
       JOIN fonte_versoes fv ON fv.id = v.fonte_versao_id
       JOIN fontes fo ON fo.id = d.fonte_id
       WHERE d.municipio_id = $1
         AND to_tsvector('pt_unaccent', fo.titulo || ' ' || v.titulo || ' ' || v.resumo) @@ c.q
         AND v.fonte_versao_id = (SELECT x.id FROM fonte_versoes x WHERE x.fonte_id = fo.id
               AND ${EM_VIGOR('x')} ORDER BY x.lida_em DESC LIMIT 1)
       ORDER BY pontuacao DESC
       LIMIT 3`,
      [municipioId, pesquisa],
    );
    if (!linhas.length) {
      return {
        encontrado: false,
        documentos: [],
        dizer:
          'Não há versão simples publicada desse documento. Usa procurar_conhecimento e explica por palavras simples só o que vier na fonte oficial.',
      };
    }
    const documentos = linhas.map((l) => ({
      titulo: l.titulo,
      tipo: l.tipo,
      resumo: l.resumo,
      partes: l.partes.map((p) => ({ titulo: p.titulo, texto: p.texto })),
      fonte: l.fonte,
      url_oficial: l.url,
      texto_oficial_de: l.vigor_desde,
      link: this.link(l.codigo),
    }));
    return {
      encontrado: true,
      documentos,
      dizer: `Há uma versão simples revista pela câmara: ${documentos[0].titulo}. Na página ${documentos[0].link} está o resumo e o texto oficial completo. ${AVISO_LEGAL}`,
    };
  }

  /**
   * Para `procurar_conhecimento`: as versões simples publicadas das fontes
   * destes trechos, só se foram feitas da versão de onde vêm os trechos
   * (não desatualizadas).
   */
  async daPesquisa(municipioId: string, trechoIds: string[]) {
    if (!trechoIds.length) return [];
    const linhas = await this.db.query<{
      codigo: string;
      titulo: string;
      resumo: string;
      fonte: string;
    }>(
      `SELECT DISTINCT d.codigo, v.titulo, v.resumo, fo.titulo AS fonte
       FROM trechos t
       JOIN documento_simples_versoes v
         ON v.fonte_versao_id = t.fonte_versao_id AND v.estado = 'publicada'
       JOIN documentos_simples d ON d.id = v.documento_id
       JOIN fontes fo ON fo.id = d.fonte_id
       WHERE t.id = ANY($2::uuid[]) AND d.municipio_id = $1`,
      [municipioId, trechoIds],
    );
    return linhas.map((l) => ({
      fonte: l.fonte,
      titulo: l.titulo,
      resumo: l.resumo,
      link: this.link(l.codigo),
    }));
  }

  // --- Auxiliares ---------------------------------------------------------

  private async documento(municipioId: string, id: string): Promise<DocLinha> {
    const [d] = await this.db.query<DocLinha>(
      `SELECT ${DOC_COLUNAS}
       FROM documentos_simples d
       JOIN fontes fo ON fo.id = d.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       WHERE d.id = $1 AND d.municipio_id = $2`,
      [id, municipioId],
    );
    if (!d) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'documento_nao_encontrado',
        'Documento não encontrado.',
      );
    }
    return d;
  }

  private async original(versaoId: string, tx?: Tx): Promise<Original | null> {
    const [o] = await (tx ?? this.db).query<Original>(
      `SELECT v.id AS versao_id, v.hash, v.texto, v.lida_em,
              to_char(${INICIO_VIGOR('v')}, 'YYYY-MM-DD') AS vigor_desde
       FROM fonte_versoes v WHERE v.id = $1`,
      [versaoId],
    );
    return o ?? null;
  }

  private async originalAtual(d: DocLinha, tx?: Tx): Promise<Original> {
    const o = d.versao_atual_id
      ? await this.original(d.versao_atual_id, tx)
      : null;
    if (!o) throw semTexto();
    return o;
  }

  private trechos(versaoId: string, tx?: Tx) {
    return (tx ?? this.db).query<{
      id: string;
      referencia: string | null;
      texto: string;
    }>(
      `SELECT id, referencia, texto FROM trechos WHERE fonte_versao_id = $1 ORDER BY ordem`,
      [versaoId],
    );
  }

  private originalParaFora(
    o: Original,
    trechos: { id: string; referencia: string | null; texto: string }[],
  ): OriginalFora {
    const seccoes: Seccao[] = seccoesDoOriginal(o.texto);
    const porSeccao = ligarTrechos(seccoes, trechos);
    return {
      versao_id: o.versao_id,
      vigor_desde: o.vigor_desde,
      lida_em: o.lida_em,
      seccoes: seccoes.map((s) => ({
        ...s,
        trechos: porSeccao.get(s.id) ?? [],
      })),
    };
  }

  /** Um pedido de cada vez por documento (gerar, gravar, publicar). */
  private async bloquear(tx: Tx, id: string) {
    await tx.query(
      `SELECT 1 FROM documentos_simples WHERE id = $1 FOR UPDATE`,
      [id],
    );
  }

  private async proximoNumero(tx: Tx, id: string): Promise<number> {
    const [n] = await tx.query<{ n: number }>(
      `SELECT coalesce(max(numero), 0) + 1 AS n FROM documento_simples_versoes WHERE documento_id = $1`,
      [id],
    );
    return n.n;
  }
}

function termoPublico(t: Termo) {
  return {
    id: t.id,
    termo: t.termo,
    explicacao: t.explicacao,
    exemplo: t.exemplo,
    demonstracao: t.demonstracao,
  };
}

function semTexto() {
  return new ErroApi(
    HttpStatus.CONFLICT,
    'sem_texto',
    'A fonte ainda não tem texto oficial lido. Leia a fonte (ou cole o texto) primeiro.',
  );
}

function limitar(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
