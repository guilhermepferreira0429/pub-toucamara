import { Injectable, Optional } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import type { iaConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import {
  decidirPublicacao,
  DecisaoPublicacao,
  ExecucaoGate,
  execucoesDoPainel,
  LIMIAR_PUBLICACAO,
} from './avaliacao.js';
import { resumirNumeros } from './numeros-na-fonte.js';

export interface EstadoPublicacao {
  decisao: DecisaoPublicacao;
  versao_atual: string | null;
  /** Nome do sistema `tou-chat` do município (para o comando do avaliador). */
  sistema: string | null;
}

/** Uma execução com o total (NULL nas contagens se ainda não tem respostas). */
interface ResumoExecucao {
  execucao_id: string;
  sistema: string;
  agente_versao: string | null;
  motivo: string;
  iniciada_em: Date;
  terminada_em: Date | null;
  total: number | null;
  certas: number | null;
  passadas_bem: number | null;
  erradas: number | null;
  sem_resposta: number | null;
  por_responder: number | null;
  por_avaliar: number | null;
  taxa: number | null;
  /** Resultados de demonstração (sistema marcado na preparação da demo). */
  demonstracao: boolean;
}

export interface PedidoAvaliacao {
  id: string;
  motivo: string;
  conjunto: string;
  amostra: boolean;
  estado: 'pendente' | 'a_correr' | 'terminado' | 'falhou';
  execucao_id: string | null;
  erro: string | null;
  criado_em: Date;
  iniciado_em: Date | null;
  terminado_em: Date | null;
}

const COLUNAS_PEDIDO = `id, motivo, conjunto, amostra, estado, execucao_id, erro,
  criado_em, iniciado_em, terminado_em`;

/** Colunas de `avaliacao.resultados` que o painel mostra (taxa em número). */
const COLUNAS_RESULTADO = `r.total, r.certas, r.passadas_bem, r.erradas, r.sem_resposta,
  r.por_responder, r.por_avaliar, r.taxa::float8 AS taxa`;

/**
 * A página pública só mostra o que foi medido: os sistemas da preparação da
 * demo (`config.demonstracao`) têm resultados inventados para o painel.
 */
const SO_MEDIDOS = `NOT coalesce((s.config->>'demonstracao')::boolean, false)`;

/** Como a página pública chama o assistente atual do município (nunca pelo nome). */
export function nomeOutroPublico(municipio: string): string {
  return `A assistente do site da Câmara Municipal de ${municipio}`;
}

/** Totais de uma execução para a página pública (sem ids nem nomes de sistemas). */
export interface ResumoPublico {
  terminada_em: Date | null;
  total: number;
  certas: number;
  passadas_bem: number;
  erradas: number;
  sem_resposta: number;
  por_avaliar: number;
  taxa: number | null;
}

/** Uma pergunta da página pública: a nossa resposta, a certa e, se houver, a do outro assistente. */
export interface PerguntaPublica {
  ordem: number;
  categoria: string;
  pergunta: string;
  comportamento: string;
  resposta: string | null;
  veredicto: string | null;
  justificacao: string | null;
  factos_em_falta: string[];
  factos_errados: string[];
  resposta_certa: string | null;
  fontes: { titulo?: string; url?: string }[];
  outro: {
    resposta: string | null;
    veredicto: string | null;
    justificacao: string | null;
  } | null;
}

/**
 * Resultados do avaliador (`code/avaliador`, esquema `avaliacao`) vistos pela
 * API: só lê, nunca chama o avaliador. No painel só entra o NOSSO agente do
 * município. A página pública (`publica`) junta-lhe o assistente atual do
 * mesmo município, sempre como "a assistente do site" e com o nome tapado
 * nas respostas.
 */
@Injectable()
export class AvaliacaoService {
  /** Nomes a tapar sempre nas respostas do outro assistente (`AVALIACAO_TAPAR`). */
  private readonly taparSempre: string[];

  constructor(
    private readonly db: DatabaseService,
    @Optional() config?: ConfigService,
  ) {
    this.taparSempre =
      config?.get<ConfigType<typeof iaConfig>>('ia')?.avaliacaoTapar ?? [];
  }

  /**
   * A execução que decide a publicação: a mais recente `tou-chat`, terminada,
   * não amostra, sobre a versão atual do agente, de um conjunto genérico ou
   * do município (sem nenhuma da versão atual, a última, para o motivo).
   */
  async estadoPublicacao(
    municipioId: string,
    tx?: Tx,
  ): Promise<EstadoPublicacao> {
    const [l] = await (tx ?? this.db).query<
      Partial<ExecucaoGate> & {
        versao_atual: string | null;
        sistema_chat: string | null;
      }
    >(
      `SELECT a.versao AS versao_atual,
              (SELECT s.nome FROM avaliacao.sistemas s
               WHERE s.nosso AND s.adaptador = 'tou-chat' AND s.municipio_id = $1
               ORDER BY s.criado_em LIMIT 1) AS sistema_chat,
              e.id AS execucao_id, e.sistema, e.agente_versao, e.terminada_em,
              r.taxa::float8 AS taxa, r.total, r.por_avaliar
       FROM (SELECT $1::uuid AS municipio_id) m
       LEFT JOIN agente_config a ON a.municipio_id = m.municipio_id
       LEFT JOIN LATERAL (
         SELECT e.id, s.nome AS sistema, e.agente_versao, e.terminada_em
         FROM avaliacao.execucoes e
         JOIN avaliacao.sistemas s ON s.id = e.sistema_id
         JOIN avaliacao.conjuntos c ON c.id = e.conjunto_id
         WHERE s.nosso AND s.adaptador = 'tou-chat' AND s.municipio_id = m.municipio_id
           AND (c.municipio_id IS NULL OR c.municipio_id = m.municipio_id)
           AND e.estado = 'terminada' AND NOT e.amostra
         -- A da versão atual, se houver; senão a última (para dizer porquê).
         ORDER BY (e.agente_versao = a.versao) IS TRUE DESC, e.terminada_em DESC NULLS LAST
         LIMIT 1
       ) e ON true
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL`,
      [municipioId],
    );
    const execucao: ExecucaoGate | null = l?.execucao_id
      ? {
          execucao_id: l.execucao_id,
          sistema: l.sistema!,
          agente_versao: l.agente_versao ?? null,
          terminada_em: l.terminada_em ?? null,
          taxa: l.taxa ?? null,
          total: l.total ?? 0,
          por_avaliar: l.por_avaliar ?? 0,
        }
      : null;
    const versao = l?.versao_atual ?? null;
    return {
      decisao: decidirPublicacao(execucao, versao),
      versao_atual: versao,
      sistema: execucao?.sistema ?? l?.sistema_chat ?? null,
    };
  }

  /**
   * Página "Qualidade": última execução do chat (total e por categoria),
   * evolução das últimas 20, as erradas da última e a última amostra de voz.
   */
  /**
   * Pede uma avaliação ao avaliador (que corre à parte, com a chave do juiz).
   * Se já houver uma pendente para o mesmo conjunto, devolve essa.
   */
  async pedirAvaliacao(
    municipioId: string,
    motivo: 'manual' | 'ingestao' | 'mudanca_agente',
    opcoes: {
      porId?: string | null;
      amostra?: boolean;
      conjunto?: string;
    } = {},
  ) {
    const conjunto = opcoes.conjunto ?? 'Perguntas base';
    const [novo] = await this.db.query<PedidoAvaliacao>(
      `INSERT INTO avaliacao.pedidos (municipio_id, motivo, conjunto, amostra, pedido_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (municipio_id, conjunto) WHERE estado = 'pendente' DO NOTHING
       RETURNING ${COLUNAS_PEDIDO}`,
      [
        municipioId,
        motivo,
        conjunto,
        opcoes.amostra ?? false,
        opcoes.porId ?? null,
      ],
    );
    if (novo) return { ...novo, ja_havia: false };
    const [pendente] = await this.db.query<PedidoAvaliacao>(
      `SELECT ${COLUNAS_PEDIDO} FROM avaliacao.pedidos
       WHERE municipio_id = $1 AND conjunto = $2 AND estado = 'pendente'`,
      [municipioId, conjunto],
    );
    return { ...pendente, ja_havia: true };
  }

  /** Os últimos pedidos (para a página Qualidade mostrar o que está a correr). */
  pedidos(municipioId: string, limite = 5) {
    return this.db.query<PedidoAvaliacao>(
      `SELECT ${COLUNAS_PEDIDO} FROM avaliacao.pedidos
       WHERE municipio_id = $1 ORDER BY criado_em DESC LIMIT $2`,
      [municipioId, limite],
    );
  }

  async qualidade(municipioId: string) {
    const todas = await this.db.query<ResumoExecucao>(
      `SELECT e.id AS execucao_id, s.nome AS sistema, e.agente_versao, e.motivo,
              e.iniciada_em, e.terminada_em, ${COLUNAS_RESULTADO},
              coalesce((s.config->>'demonstracao')::boolean, false) AS demonstracao
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL
       WHERE s.nosso AND s.adaptador = 'tou-chat' AND s.municipio_id = $1
         AND e.estado = 'terminada' AND NOT e.amostra
       ORDER BY e.terminada_em DESC NULLS LAST, e.id DESC
       LIMIT 40`,
      [municipioId],
    );
    const ultimas = execucoesDoPainel(todas);
    const [estado, voz, pedidos] = await Promise.all([
      this.estadoPublicacao(municipioId),
      this.ultimaVoz(municipioId),
      this.pedidos(municipioId),
    ]);

    // Da mais antiga para a mais recente, para o gráfico.
    const evolucao = ultimas
      .map((e) => ({ ...e, passou: passou(e.taxa) }))
      .reverse();

    let ultima: Record<string, unknown> | null = null;
    let erradas: unknown[] = [];
    let numeros: Awaited<ReturnType<typeof this.numerosSemFonte>> | null = null;
    const u = ultimas[0];
    if (u) {
      const [categorias, linhas, nums] = await Promise.all([
        this.db.query(
          `SELECT r.categoria, ${COLUNAS_RESULTADO}
           FROM avaliacao.resultados r
           WHERE r.execucao_id = $1 AND r.categoria IS NOT NULL
           ORDER BY r.taxa ASC NULLS LAST, r.categoria`,
          [u.execucao_id],
        ),
        this.erradas(municipioId, u.execucao_id),
        this.numerosSemFonte(municipioId, u.execucao_id),
      ]);
      numeros = nums;
      ultima = {
        ...u,
        perguntas:
          (u.total ?? 0) + (u.por_responder ?? 0) + (u.por_avaliar ?? 0),
        passou: passou(u.taxa),
        categorias,
      };
      erradas = linhas;
    }

    const d = estado.decisao;
    return {
      limiar: LIMIAR_PUBLICACAO,
      pedidos,
      versao_atual: estado.versao_atual,
      publicacao: d.permitir
        ? {
            pode_publicar: true,
            motivo: null,
            causa: null,
            execucao_id: d.execucao_id,
          }
        : {
            pode_publicar: false,
            motivo: d.motivo,
            causa: d.causa,
            execucao_id: d.execucao_id,
          },
      ultima,
      evolucao,
      erradas,
      numeros,
      voz,
    };
  }

  /**
   * Página pública da avaliação: a última execução do nosso chat (a mesma da
   * página Qualidade) e a última do assistente atual do município, com as
   * perguntas uma a uma. A comparação conta só as perguntas avaliadas nas
   * duas. Nada de ids, nomes de sistemas, capturas nem respostas em bruto.
   */
  async publica(municipio: { id: string; slug: string; nome: string }) {
    const [nosso] = await this.db.query<
      ResumoPublico & { execucao_id: string; conjunto_id: string }
    >(
      `SELECT e.id AS execucao_id, e.conjunto_id, e.terminada_em, ${COLUNAS_RESULTADO}
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL
       WHERE s.nosso AND s.adaptador = 'tou-chat' AND s.municipio_id = $1
         AND e.estado = 'terminada' AND NOT e.amostra AND ${SO_MEDIDOS}
       ORDER BY e.terminada_em DESC NULLS LAST, e.id DESC
       LIMIT 1`,
      [municipio.id],
    );
    const base = {
      municipio: { slug: municipio.slug, nome: municipio.nome },
      limiar: LIMIAR_PUBLICACAO,
      outro_nome: nomeOutroPublico(municipio.nome),
    };
    if (!nosso) {
      return {
        ...base,
        nosso: null,
        outro: null,
        comparacao: null,
        categorias: [],
        perguntas: [] as PerguntaPublica[],
      };
    }

    // O assistente atual: de preferência sobre as mesmas perguntas.
    const [outro] = await this.db.query<
      ResumoPublico & { execucao_id: string; sistema: string }
    >(
      `SELECT e.id AS execucao_id, s.nome AS sistema, e.terminada_em, ${COLUNAS_RESULTADO}
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL
       WHERE NOT s.nosso AND s.municipio_id = $1
         AND e.estado = 'terminada' AND NOT e.amostra AND ${SO_MEDIDOS}
       ORDER BY (e.conjunto_id = $2) DESC, e.terminada_em DESC NULLS LAST, e.id DESC
       LIMIT 1`,
      [municipio.id, nosso.conjunto_id],
    );

    const [categorias, linhas] = await Promise.all([
      this.db.query<{
        categoria: string;
        total: number;
        taxa: number | null;
      }>(
        `SELECT r.categoria, r.total, r.taxa::float8 AS taxa
         FROM avaliacao.resultados r
         WHERE r.execucao_id = $1 AND r.categoria IS NOT NULL
         ORDER BY r.categoria`,
        [nosso.execucao_id],
      ),
      this.db.query<
        Omit<PerguntaPublica, 'outro'> & {
          outro_resposta: string | null;
          outro_veredicto: string | null;
          outro_justificacao: string | null;
        }
      >(
        `SELECT p.ordem, p.categoria, p.texto AS pergunta, p.comportamento,
                r.texto AS resposta, f.veredicto, f.justificacao,
                coalesce(f.factos_em_falta, '{}') AS factos_em_falta,
                coalesce(f.factos_errados, '{}') AS factos_errados,
                coalesce(g.resposta, ga.resposta) AS resposta_certa,
                coalesce(g.fontes, ga.fontes, '[]'::jsonb) AS fontes,
                ro.texto AS outro_resposta, fo.veredicto AS outro_veredicto,
                fo.justificacao AS outro_justificacao
         FROM avaliacao.respostas r
         JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
         LEFT JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
         LEFT JOIN avaliacao.gabarito g ON g.id = f.gabarito_id
         LEFT JOIN avaliacao.gabarito ga ON f.gabarito_id IS NULL AND ga.pergunta_id = p.id
              AND ga.municipio_id = $3 AND ga.estado = 'aprovado'
         LEFT JOIN avaliacao.respostas ro ON ro.execucao_id = $2
              AND ro.pergunta_id = p.id AND ro.erro IS NULL
         LEFT JOIN avaliacao.avaliacao_final fo ON fo.resposta_id = ro.id
         WHERE r.execucao_id = $1 AND r.erro IS NULL
         ORDER BY p.ordem`,
        [nosso.execucao_id, outro?.execucao_id ?? null, municipio.id],
      ),
    ]);

    const tapar = outro
      ? [...nomesATapar(outro.sistema), ...this.taparSempre]
      : [];
    const perguntas: PerguntaPublica[] = linhas.map(
      ({ outro_resposta, outro_veredicto, outro_justificacao, ...p }) => ({
        ...p,
        outro:
          outro_resposta !== null || outro_veredicto !== null
            ? {
                resposta: anonimizar(outro_resposta, tapar),
                veredicto: outro_veredicto,
                justificacao: anonimizar(outro_justificacao, tapar),
              }
            : null,
      }),
    );

    // Só as perguntas que o juiz avaliou nos dois: a mesma base para ambos.
    const comuns = perguntas.filter((p) => p.veredicto && p.outro?.veredicto);
    const comparacao =
      outro && comuns.length
        ? {
            perguntas: comuns.length,
            nosso: contarAcertos(comuns.map((p) => p.veredicto)),
            outro: contarAcertos(comuns.map((p) => p.outro!.veredicto)),
          }
        : null;

    const resumo = ({
      terminada_em,
      total,
      certas,
      passadas_bem,
      erradas,
      sem_resposta,
      por_avaliar,
      taxa,
    }: ResumoPublico): ResumoPublico => ({
      terminada_em,
      total: total ?? 0,
      certas: certas ?? 0,
      passadas_bem: passadas_bem ?? 0,
      erradas: erradas ?? 0,
      sem_resposta: sem_resposta ?? 0,
      por_avaliar: por_avaliar ?? 0,
      taxa,
    });

    return {
      ...base,
      nosso: { ...resumo(nosso), passou: passou(nosso.taxa) },
      outro: outro ? resumo(outro) : null,
      comparacao,
      categorias,
      perguntas,
    };
  }

  /**
   * "Números inventados" na última execução: valores (€, prazos, horas,
   * telefones, %) que o agente disse e que não estão na pergunta nem no
   * gabarito aprovado (escrito a partir das fontes oficiais). Calcula-se ao
   * ler: são umas dezenas de respostas e a regra pode mudar sem migração.
   */
  private async numerosSemFonte(municipioId: string, execucaoId: string) {
    const linhas = await this.db.query<{
      resposta_id: string;
      pergunta: string;
      resposta: string | null;
      gabarito: string | null;
      factos: string[] | null;
    }>(
      `SELECT r.id AS resposta_id, p.texto AS pergunta, r.texto AS resposta,
              coalesce(g.resposta, ga.resposta) AS gabarito,
              coalesce(g.factos_obrigatorios, ga.factos_obrigatorios) AS factos
       FROM avaliacao.respostas r
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       LEFT JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
       LEFT JOIN avaliacao.gabarito g ON g.id = f.gabarito_id
       LEFT JOIN avaliacao.gabarito ga ON f.gabarito_id IS NULL AND ga.pergunta_id = p.id
            AND ga.municipio_id = $2 AND ga.estado = 'aprovado'
       WHERE r.execucao_id = $1 AND r.erro IS NULL
       ORDER BY p.ordem`,
      [execucaoId, municipioId],
    );
    const { porResposta, ...resumo } = resumirNumeros(
      linhas.map((l) => ({
        texto: l.resposta,
        fontes: [l.pergunta, l.gabarito ?? '', ...(l.factos ?? [])],
      })),
    );
    const exemplos = linhas
      .map((l, i) => ({
        resposta_id: l.resposta_id,
        pergunta: l.pergunta,
        resposta: l.resposta,
        numeros: porResposta[i].semFonte.map((n) => n.texto),
      }))
      .filter((e) => e.numeros.length)
      .slice(0, 10);
    return { ...resumo, exemplos };
  }

  /** Respostas erradas ou sem resposta, com o gabarito que o juiz usou. */
  private erradas(municipioId: string, execucaoId: string) {
    return this.db.query(
      `SELECT r.id AS resposta_id, p.id AS pergunta_id, p.ordem, p.categoria,
              p.texto AS pergunta, p.comportamento, r.texto AS resposta,
              f.veredicto, coalesce(g.resposta, ga.resposta) AS gabarito,
              f.factos_em_falta, f.factos_errados, f.justificacao, f.avaliador,
              r.latencia_ms, r.respondida_em
       FROM avaliacao.respostas r
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
       LEFT JOIN avaliacao.gabarito g ON g.id = f.gabarito_id
       LEFT JOIN avaliacao.gabarito ga ON f.gabarito_id IS NULL AND ga.pergunta_id = p.id
            AND ga.municipio_id = $2 AND ga.estado = 'aprovado'
       WHERE r.execucao_id = $1 AND r.erro IS NULL
         AND f.veredicto IN ('errada', 'sem_resposta')
       ORDER BY p.ordem`,
      [execucaoId, municipioId],
    );
  }

  /** Última amostra de voz (`tou-voz`) terminada, com a latência média. */
  private async ultimaVoz(municipioId: string) {
    const [v] = await this.db.query<{ taxa: number | null }>(
      `SELECT e.id AS execucao_id, s.nome AS sistema, e.agente_versao, e.amostra,
              e.iniciada_em, e.terminada_em, ${COLUNAS_RESULTADO},
              (SELECT round(avg(x.latencia_ms))::int FROM avaliacao.respostas x
               WHERE x.execucao_id = e.id AND x.erro IS NULL AND x.latencia_ms IS NOT NULL) AS latencia_media_ms
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL
       WHERE s.nosso AND s.adaptador = 'tou-voz' AND s.municipio_id = $1
         AND e.estado = 'terminada'
       ORDER BY e.terminada_em DESC NULLS LAST, e.id DESC
       LIMIT 1`,
      [municipioId],
    );
    return v ? { ...v, passou: passou(v.taxa) } : null;
  }
}

function passou(taxa: number | null): boolean {
  return taxa !== null && taxa >= LIMIAR_PUBLICACAO;
}

/** Certas e bem passadas a um funcionário contam como acerto (como na taxa). */
function contarAcertos(veredictos: (string | null)[]) {
  const acertos = veredictos.filter(
    (v) => v === 'certa' || v === 'passada_bem',
  ).length;
  return {
    acertos,
    taxa: veredictos.length
      ? Math.round((10_000 * acertos) / veredictos.length) / 100
      : null,
  };
}

/**
 * Os nomes a tapar nas respostas do outro assistente: a parte do nome do
 * sistema antes de " · " (ex.: o nome da assistente, sem o município).
 */
export function nomesATapar(sistema: string): string[] {
  const nome = sistema.split('·')[0].trim();
  return nome.length >= 3 ? [nome] : [];
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cada letra aceita maiúscula e minúscula ("[lL][aA]…"). */
const semCaixa = (t: string) =>
  [...t]
    .map((c) =>
      c.toLowerCase() !== c.toUpperCase()
        ? `[${c.toLowerCase()}${c.toUpperCase()}]`
        : escapar(c),
    )
    .join('');

/**
 * Troca os nomes por "[nome]", palavra inteira. Um nome próprio ("Joana")
 * só com maiúscula inicial e não depois de Santa/Santo/São: o adjetivo
 * ("indicação clara") e o convento ("Santa Clara") ficam. Uma marca
 * ("Acme") sai em qualquer caixa.
 */
export function anonimizar(
  texto: string | null,
  nomes: string[],
): string | null {
  if (texto === null) return null;
  return nomes.reduce((t, nome) => {
    const proprio = /^\p{Lu}\p{Ll}+$/u.test(nome);
    const corpo = proprio
      ? escapar(nome[0]) + semCaixa(nome.slice(1))
      : semCaixa(nome);
    const santo = proprio ? '(?<!(?:Santa|Santo|São|S\\.)\\s)' : '';
    return t.replace(
      new RegExp(`${santo}(?<![\\p{L}\\p{N}])${corpo}(?![\\p{L}\\p{N}])`, 'gu'),
      '[nome]',
    );
  }, texto);
}
