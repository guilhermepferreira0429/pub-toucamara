import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Feriados } from '../../common/dias-uteis.js';
import { ErroApi } from '../../common/erros.js';
import { Cursor, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  deduzirFreguesia,
  Pergunta,
  resolverFreguesia,
} from '../consultas-publicas/regras.js';
import { DEFS, TipoLicenca } from '../licencas/tipos.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { hojeNoFuso } from '../painel/periodos.js';
import {
  CONJUNTOS,
  DefConjunto,
  eConjunto,
  FactoAtendimento,
  FactoConsulta,
  FactoLicenca,
  FactoOcorrencia,
  FactoProcesso,
  FactoReclamacao,
  IDS_CONJUNTOS,
  IdConjunto,
  OUTRA_FREGUESIA,
  publicar,
  SEM_FREGUESIA_IDENTIFICADA,
  SEM_SERVICO,
  Tabela,
  tabelaAtendimento,
  tabelaConsultas,
  tabelaLicencas,
  tabelaOcorrencias,
  tabelaProcessos,
  tabelaReclamacoes,
  TabelaPublicada,
} from './conjuntos.js';
import { catalogoDcat } from './dcat.js';
import {
  FonteIndicador,
  INDICADORES,
  montarIndicadores,
} from './indicadores.js';
import {
  fimDoMes,
  FREQUENCIAS,
  LICENCA,
  Linha,
  mesValido,
  paraCsv,
  periodoPublicado,
  REGRA_SUPRESSAO,
  somarMeses,
} from './regras.js';

/** Uma publicação guardada (sem as linhas nem o CSV). */
interface Publicacao {
  id: string;
  conjunto: IdConjunto;
  versao: number;
  periodo_de: string;
  periodo_ate: string;
  n_linhas: number;
  hash: string;
  bytes_csv: number;
  bytes_json: number;
  origem: 'automatica' | 'manual';
  gerado_em: Date;
  confirmado_em: Date;
  csv_key: string | null;
  json_key: string | null;
}

const COLUNAS_PUB = `p.id, p.conjunto, p.versao, to_char(p.periodo_de, 'YYYY-MM-DD') AS periodo_de,
  to_char(p.periodo_ate, 'YYYY-MM-DD') AS periodo_ate, p.n_linhas, p.hash, p.bytes_csv, p.bytes_json,
  p.origem, p.gerado_em, p.confirmado_em, p.csv_key, p.json_key`;

export interface Gerado {
  def: DefConjunto;
  periodo: { de: string; ate: string };
  tabela: TabelaPublicada;
}

export interface Ficheiro {
  corpo: string;
  tipo: string;
  nome: string;
  etag: string;
  modificado: Date;
  imutavel: boolean;
}

/**
 * Transparência: gera os conjuntos de dados abertos de cada município (só
 * números agregados), guarda cada publicação com o CSV e o JSON (na BD e,
 * havendo, em S3) e serve o portal público, o catálogo DCAT-AP e os
 * indicadores do mês.
 */
@Injectable()
export class TransparenciaService {
  private readonly logger = new Logger(TransparenciaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Gerar
  // ------------------------------------------------------------------

  /** Lê os factos e faz as contas; nada é gravado. */
  async gerar(m: Municipio, id: IdConjunto): Promise<Gerado> {
    const hoje = hojeNoFuso(m.fuso);
    const p = periodoPublicado(hoje);
    const def = CONJUNTOS[id];
    let tabela: Tabela;
    let periodo = { de: p.de, ate: p.ate };
    switch (id) {
      case 'ocorrencias':
        tabela = tabelaOcorrencias(await this.factosOcorrencias(m, p), p.meses);
        break;
      case 'processos': {
        const feriados = await this.municipios.feriados(m.id);
        tabela = tabelaProcessos(
          await this.factosProcessos(m, p),
          p.meses,
          feriados,
        );
        break;
      }
      case 'atendimento':
        tabela = tabelaAtendimento(await this.factosAtendimento(m, p), p.meses);
        break;
      case 'reclamacoes': {
        const feriados: Feriados = await this.municipios.feriados(m.id);
        tabela = tabelaReclamacoes(
          await this.factosReclamacoes(m, p),
          p.meses,
          hoje,
          feriados,
        );
        break;
      }
      case 'consultas-publicas': {
        const cs = await this.factosConsultas(m);
        tabela = tabelaConsultas(cs);
        const inicio = cs.map((c) => c.abre_em).sort()[0];
        if (inicio && inicio < periodo.de) periodo = { de: inicio, ate: p.ate };
        break;
      }
      case 'licencas':
        tabela = tabelaLicencas(await this.factosLicencas(m, p), p.meses);
        break;
    }
    return { def, periodo, tabela: publicar(def, tabela) };
  }

  private intervalo = `>= ($3::date)::timestamp AT TIME ZONE $2::text`;
  private ate = `< ($4::date + 1)::timestamp AT TIME ZONE $2::text`;

  /**
   * As freguesias do município: as que a câmara pôs nas consultas públicas
   * e nas campanhas e as dos processos (a mesma lista que as consultas
   * usam para reconhecer a freguesia dita).
   */
  private async freguesiasConhecidas(municipioId: string): Promise<string[]> {
    const linhas = await this.db.query<{ freguesia: string }>(
      `SELECT DISTINCT freguesia FROM (
         SELECT unnest(freguesias) AS freguesia FROM consultas_publicas WHERE municipio_id = $1
         UNION SELECT freguesia FROM contactos_cuidado WHERE municipio_id = $1
         UNION SELECT freguesia FROM processos WHERE municipio_id = $1
       ) f WHERE freguesia IS NOT NULL AND length(trim(freguesia)) > 1
       ORDER BY freguesia LIMIT 200`,
      [municipioId],
    );
    return linhas.map((l) => l.freguesia);
  }

  private async factosOcorrencias(
    m: Municipio,
    p: { de: string; ate: string },
  ): Promise<FactoOcorrencia[]> {
    const [linhas, candidatas] = await Promise.all([
      this.db.query<{
        mes: string;
        categoria: string;
        morada: string;
        aberta: boolean;
        horas: number | null;
      }>(
        `SELECT to_char(o.criada_em AT TIME ZONE $2::text, 'YYYY-MM') AS mes,
                c.nome AS categoria, o.morada,
                o.estado IN ('nova', 'com_equipa') AS aberta,
                CASE WHEN o.resolvida_em IS NOT NULL
                  THEN extract(epoch FROM o.resolvida_em - o.criada_em)::float8 / 3600 END AS horas
         FROM ocorrencias o
         JOIN categorias_ocorrencia c ON c.id = o.categoria_id
         WHERE o.municipio_id = $1 AND o.duplicada_de IS NULL
           AND o.estado NOT IN ('duplicada', 'rejeitada')
           AND o.criada_em ${this.intervalo} AND o.criada_em ${this.ate}`,
        [m.id, m.fuso, p.de, p.ate],
      ),
      this.freguesiasConhecidas(m.id),
    ]);
    // A morada só serve para achar a freguesia: não sai daqui.
    return linhas.map(({ morada, ...l }) => ({
      ...l,
      horas: l.horas === null ? null : Math.max(0, l.horas),
      freguesia:
        deduzirFreguesia(morada, candidatas) ?? SEM_FREGUESIA_IDENTIFICADA,
    }));
  }

  private async factosProcessos(
    m: Municipio,
    p: { de: string; ate: string },
  ): Promise<FactoProcesso[]> {
    const tipo = `t.codigo AS tipo_codigo, t.nome AS tipo, t.prazo_dias_uteis AS prazo_legal_dias_uteis`;
    const [entradas, decisoes] = await Promise.all([
      this.db.query<FactoProcesso & { kind: 'entrada' }>(
        `SELECT 'entrada' AS kind, to_char(p.criado_em AT TIME ZONE $2::text, 'YYYY-MM') AS mes, ${tipo},
                (p.prazo_inicio IS NOT NULL
                 AND p.prazo_inicio <= (p.criado_em AT TIME ZONE $2::text)::date) AS completo
         FROM processos p JOIN tipos_processo t ON t.id = p.tipo_processo_id
         WHERE p.municipio_id = $1 AND p.criado_em ${this.intervalo} AND p.criado_em ${this.ate}`,
        [m.id, m.fuso, p.de, p.ate],
      ),
      // As mesmas datas que a Gestão (painel/gestao.service.ts, tempos).
      this.db.query<FactoProcesso & { kind: 'decisao' }>(
        `SELECT 'decisao' AS kind, to_char(p.decidido_em AT TIME ZONE $2::text, 'YYYY-MM') AS mes, ${tipo},
                to_char(p.criado_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS entrada,
                to_char(p.decidido_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS decisao,
                to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim
         FROM processos p JOIN tipos_processo t ON t.id = p.tipo_processo_id
         WHERE p.municipio_id = $1 AND p.decidido_em IS NOT NULL
           AND p.decidido_em ${this.intervalo} AND p.decidido_em ${this.ate}`,
        [m.id, m.fuso, p.de, p.ate],
      ),
    ]);
    return [...entradas, ...decisoes];
  }

  /** As mesmas contas da mv_resultados_periodo (0018), direto à tabela. */
  private factosAtendimento(
    m: Municipio,
    p: { de: string; ate: string },
  ): Promise<FactoAtendimento[]> {
    return this.db.query<FactoAtendimento>(
      `SELECT to_char(c.iniciada_em AT TIME ZONE $2::text, 'YYYY-MM') AS mes, c.canal::text AS canal,
              count(*)::int AS conversas,
              count(*) FILTER (WHERE c.resultado IN ('resolvida', 'marcacao'))::int AS resolvidas,
              count(*) FILTER (WHERE c.resultado = 'passada_funcionario')::int AS passadas,
              count(*) FILTER (WHERE c.resultado = 'sem_resposta')::int AS sem_resposta,
              count(*) FILTER (WHERE c.fora_de_horas)::int AS fora_de_horas,
              coalesce(sum(c.duracao_s), 0)::float8 AS duracao_total_s,
              count(c.duracao_s)::int AS com_duracao
       FROM conversas c
       WHERE c.municipio_id = $1 AND c.iniciada_em ${this.intervalo} AND c.iniciada_em ${this.ate}
       GROUP BY 1, 2`,
      [m.id, m.fuso, p.de, p.ate],
    );
  }

  private factosReclamacoes(
    m: Municipio,
    p: { de: string; ate: string },
  ): Promise<FactoReclamacao[]> {
    return this.db.query<FactoReclamacao>(
      `SELECT to_char(r.recebida_em, 'YYYY-MM') AS mes, coalesce(s.nome, $5) AS servico,
              to_char(r.recebida_em, 'YYYY-MM-DD') AS recebida_em,
              to_char(r.responder_ate, 'YYYY-MM-DD') AS responder_ate,
              to_char((r.respondida_em AT TIME ZONE $2::text)::date, 'YYYY-MM-DD') AS respondida_dia
       FROM reclamacoes r LEFT JOIN servicos s ON s.id = r.servico_id
       WHERE r.municipio_id = $1 AND r.recebida_em BETWEEN $3::date AND $4::date`,
      [m.id, m.fuso, p.de, p.ate, SEM_SERVICO],
    );
  }

  private async factosConsultas(
    m: Municipio,
  ): Promise<(FactoConsulta & { abre_em: string })[]> {
    const consultas = await this.db.query<{
      id: string;
      codigo: string;
      titulo: string;
      abre_em: string;
      fecha_em: string;
      perguntas: Pergunta[];
      freguesias: string[] | null;
    }>(
      `SELECT id, codigo, titulo, to_char(abre_em, 'YYYY-MM-DD') AS abre_em,
              to_char(fecha_em, 'YYYY-MM-DD') AS fecha_em, perguntas, freguesias
       FROM consultas_publicas WHERE municipio_id = $1 AND estado = 'fechada'`,
      [m.id],
    );
    if (!consultas.length) return [];
    const [participacoes, conhecidas] = await Promise.all([
      this.db.query<{
        consulta_id: string;
        respostas: Record<string, string>;
        freguesia: string | null;
      }>(
        `SELECT consulta_id, respostas, freguesia FROM consulta_participacoes
         WHERE consulta_id = ANY($1::uuid[])`,
        [consultas.map((c) => c.id)],
      ),
      this.freguesiasConhecidas(m.id),
    ]);
    return consultas.map(({ id, ...c }) => {
      const candidatas = c.freguesias ?? conhecidas;
      return {
        ...c,
        participacoes: participacoes
          .filter((p) => p.consulta_id === id)
          .map((p) => {
            // Fora da lista do município não se publica o que a pessoa disse.
            const f = p.freguesia
              ? resolverFreguesia(p.freguesia, candidatas)
              : null;
            return {
              respostas: p.respostas,
              freguesia:
                f === null || candidatas.includes(f) ? f : OUTRA_FREGUESIA,
            };
          }),
      };
    });
  }

  private async factosLicencas(
    m: Municipio,
    p: { de: string; ate: string },
  ): Promise<FactoLicenca[]> {
    const linhas = await this.db.query<{
      kind: 'pedido' | 'decisao';
      mes: string;
      tipo_codigo: TipoLicenca;
      emitida: boolean;
      sem_tecnico: boolean;
    }>(
      `SELECT 'pedido' AS kind, to_char(l.criada_em AT TIME ZONE $2::text, 'YYYY-MM') AS mes,
              l.tipo AS tipo_codigo, false AS emitida, false AS sem_tecnico
       FROM licencas l
       WHERE l.municipio_id = $1 AND l.criada_em ${this.intervalo} AND l.criada_em ${this.ate}
       UNION ALL
       SELECT 'decisao', to_char(l.decidida_em AT TIME ZONE $2::text, 'YYYY-MM'), l.tipo,
              l.estado = 'emitida', l.proposta = 'aprovar'
       FROM licencas l
       WHERE l.municipio_id = $1 AND l.estado IN ('emitida', 'recusada') AND l.decidida_em IS NOT NULL
         AND l.decidida_em ${this.intervalo} AND l.decidida_em ${this.ate}`,
      [m.id, m.fuso, p.de, p.ate],
    );
    return linhas.map((l) => {
      const base = {
        mes: l.mes,
        tipo_codigo: l.tipo_codigo,
        tipo: DEFS[l.tipo_codigo]?.nome ?? l.tipo_codigo,
      };
      return l.kind === 'pedido'
        ? { ...base, kind: 'pedido' as const }
        : {
            ...base,
            kind: 'decisao' as const,
            emitida: l.emitida,
            sem_tecnico: l.sem_tecnico,
          };
    });
  }

  // ------------------------------------------------------------------
  // Publicar
  // ------------------------------------------------------------------

  /** O endereço público do portal de dados deste município. */
  base(m: { slug: string }): string {
    const api = this.config.get<string>('app.apiUrl') ?? '';
    return `${api}/v1/public/dados/${m.slug}`;
  }

  private documentoJson(
    m: Municipio,
    def: DefConjunto,
    p: {
      periodo_de: string;
      periodo_ate: string;
      gerado_em: string;
      versao: number;
    },
    linhas: Linha[],
  ) {
    return {
      conjunto: def.id,
      titulo: def.titulo,
      descricao: def.descricao,
      municipio: { slug: m.slug, nome: m.nome },
      publicador: `Município de ${m.nome}`,
      licenca: { id: LICENCA.id, nome: LICENCA.nome, url: LICENCA.url },
      gerado_em: p.gerado_em,
      periodo: { de: p.periodo_de, ate: p.periodo_ate },
      versao: p.versao,
      colunas: def.colunas.map(({ nome, tipo, descricao }) => ({
        nome,
        tipo,
        descricao,
      })),
      supressao: REGRA_SUPRESSAO,
      notas: def.notas,
      dados: ordenar(def, linhas),
    };
  }

  private hashDe(csv: string, resumo: unknown): string {
    return createHash('sha256')
      .update(csv)
      .update('\n')
      .update(JSON.stringify(resumo))
      .digest('hex');
  }

  /**
   * Gera e guarda uma publicação. Se o conteúdo é igual ao da última, não
   * grava outra: só marca a última como confirmada (`nova: false`).
   */
  async publicarConjunto(
    m: Municipio,
    id: IdConjunto,
    origem: 'automatica' | 'manual',
    u?: UtilizadorPainel,
  ): Promise<{ nova: boolean; publicacao: Publicacao }> {
    const g = await this.gerar(m, id);
    const csv = paraCsv(g.def.colunas, g.tabela.linhas);
    const hash = this.hashDe(csv, g.tabela.resumo);

    const r = await this.db.transaction<{
      nova: boolean;
      publicacao: Publicacao;
      csv?: string;
      json?: string;
    }>(async (tx) => {
      // Um de cada vez por (município, conjunto): o trabalho e o botão.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `transparencia:${m.id}:${id}`,
      ]);
      const [ultima] = await tx.query<Publicacao>(
        `SELECT ${COLUNAS_PUB} FROM dados_abertos_publicacoes p
         WHERE p.municipio_id = $1 AND p.conjunto = $2
         ORDER BY p.gerado_em DESC, p.id DESC LIMIT 1`,
        [m.id, id],
      );
      if (ultima && ultima.hash === hash && ultima.versao === g.def.versao) {
        const [confirmada] = await tx.query<Publicacao>(
          `UPDATE dados_abertos_publicacoes p SET confirmado_em = now()
           WHERE p.id = $1 RETURNING ${COLUNAS_PUB}`,
          [ultima.id],
        );
        return { nova: false, publicacao: confirmada };
      }
      const geradoEm = new Date().toISOString();
      const json = JSON.stringify(
        this.documentoJson(
          m,
          g.def,
          {
            periodo_de: g.periodo.de,
            periodo_ate: g.periodo.ate,
            gerado_em: geradoEm,
            versao: g.def.versao,
          },
          g.tabela.linhas,
        ),
      );
      const [nova] = await tx.query<Publicacao>(
        `INSERT INTO dados_abertos_publicacoes AS p (municipio_id, conjunto, versao, periodo_de, periodo_ate,
           colunas, linhas, resumo, n_linhas, csv, hash, bytes_csv, bytes_json, origem, gerado_por, gerado_em, confirmado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
         RETURNING ${COLUNAS_PUB}`,
        [
          m.id,
          id,
          g.def.versao,
          g.periodo.de,
          g.periodo.ate,
          JSON.stringify(g.def.colunas),
          JSON.stringify(g.tabela.linhas),
          JSON.stringify(g.tabela.resumo),
          g.tabela.linhas.length,
          csv,
          hash,
          Buffer.byteLength(csv),
          Buffer.byteLength(json),
          origem,
          u?.id ?? null,
          geradoEm,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: u ? 'utilizador' : 'sistema',
          atorId: u?.id ?? null,
          acao: 'publicar_dados_abertos',
          objetoTipo: 'conjunto_dados',
          objetoId: id,
          dados: {
            publicacao_id: nova.id,
            origem,
            linhas: nova.n_linhas,
            hash,
          },
        },
        tx,
      );
      return { nova: true, publicacao: nova, csv, json };
    });

    if (r.nova && r.csv && r.json) {
      await this.guardarS3(m, r.publicacao, r.csv, r.json);
    }
    return { nova: r.nova, publicacao: r.publicacao };
  }

  /** Cópia em S3 (se houver). Sem S3 os ficheiros saem da BD na mesma. */
  private async guardarS3(
    m: Municipio,
    p: Publicacao,
    csv: string,
    json: string,
  ): Promise<void> {
    if (!this.armazenamento.disponivel) return;
    const dia = p.gerado_em.toISOString().slice(0, 10);
    const pasta = `${m.slug}/dados-abertos/${p.conjunto}/${dia}-${p.id}`;
    try {
      await this.armazenamento.guardar(
        `${pasta}.csv`,
        Buffer.from(csv),
        'text/csv; charset=utf-8',
      );
      await this.armazenamento.guardar(
        `${pasta}.json`,
        Buffer.from(json),
        'application/json',
      );
      await this.db.query(
        `UPDATE dados_abertos_publicacoes SET csv_key = $2, json_key = $3 WHERE id = $1`,
        [p.id, `${pasta}.csv`, `${pasta}.json`],
      );
    } catch (e) {
      this.logger.error(
        `Dados abertos ${m.slug}/${p.conjunto}: S3 falhou (${(e as Error).message}); fica só na BD.`,
      );
    }
  }

  async ativos(municipioId: string, tx?: Tx): Promise<IdConjunto[]> {
    const linhas = await (tx ?? this.db).query<{ conjunto: string }>(
      `SELECT conjunto FROM dados_abertos_conjuntos WHERE municipio_id = $1 AND ativo`,
      [municipioId],
    );
    return IDS_CONJUNTOS.filter((id) => linhas.some((l) => l.conjunto === id));
  }

  /** O trabalho `transparencia_publicar`: todos os municípios, os conjuntos ligados. */
  async correrJob(): Promise<void> {
    const municipios = await this.db.query<Municipio>(
      `SELECT DISTINCT m.id, m.slug, m.nome, m.fuso FROM municipios m
       JOIN dados_abertos_conjuntos c ON c.municipio_id = m.id AND c.ativo
       ORDER BY m.slug`,
    );
    const falhas: string[] = [];
    for (const m of municipios) {
      for (const id of await this.ativos(m.id)) {
        try {
          await this.publicarConjunto(m, id, 'automatica');
        } catch (e) {
          falhas.push(`${m.slug}/${id}`);
          this.logger.error(
            `Dados abertos ${m.slug}/${id} falhou: ${(e as Error).message}`,
          );
        }
      }
    }
    if (falhas.length) throw new Error(`Falharam: ${falhas.join(', ')}`);
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  private conjuntoDe(id: string): IdConjunto {
    if (!eConjunto(id)) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'conjunto_desconhecido',
        `Não há nenhum conjunto de dados "${id}".`,
      );
    }
    return id;
  }

  private urls(m: { slug: string }, id: IdConjunto) {
    const b = this.base(m);
    return {
      pagina: `${b}/${id}`,
      csv: `${b}/${id}.csv`,
      json: `${b}/${id}.json`,
      historico: `${b}/${id}/historico`,
    };
  }

  private portal(m: { slug: string }) {
    const b = this.base(m);
    const api = this.config.get<string>('app.apiUrl') ?? '';
    return {
      catalogo: b,
      dcat: `${b}/catalogo.jsonld`,
      indicadores: `${api}/v1/public/indicadores/${m.slug}`,
    };
  }

  async estado(m: Municipio) {
    const [cfg, ultimas] = await Promise.all([
      this.db.query<{
        conjunto: string;
        ativo: boolean;
        alterado_em: Date;
        alterado_por: string | null;
      }>(
        `SELECT c.conjunto, c.ativo, c.alterado_em, u.nome AS alterado_por
         FROM dados_abertos_conjuntos c LEFT JOIN utilizadores u ON u.id = c.alterado_por
         WHERE c.municipio_id = $1`,
        [m.id],
      ),
      this.db.query<Publicacao & { total: number }>(
        `SELECT DISTINCT ON (p.conjunto) ${COLUNAS_PUB},
                count(*) OVER (PARTITION BY p.conjunto)::int AS total
         FROM dados_abertos_publicacoes p WHERE p.municipio_id = $1
         ORDER BY p.conjunto, p.gerado_em DESC, p.id DESC`,
        [m.id],
      ),
    ]);
    return {
      portal: this.portal(m),
      licenca: LICENCA,
      supressao: REGRA_SUPRESSAO,
      conjuntos: IDS_CONJUNTOS.map((id) => {
        const def = CONJUNTOS[id];
        const c = cfg.find((x) => x.conjunto === id);
        const u = ultimas.find((x) => x.conjunto === id);
        return {
          id,
          titulo: def.titulo,
          descricao: def.descricao,
          frequencia: {
            codigo: def.frequencia,
            ...FREQUENCIAS[def.frequencia],
          },
          colunas: def.colunas.map(({ nome, tipo, descricao }) => ({
            nome,
            tipo,
            descricao,
          })),
          notas: def.notas,
          ativo: c?.ativo ?? false,
          alterado_em: c?.alterado_em ?? null,
          alterado_por: c?.alterado_por ?? null,
          publicacoes: u?.total ?? 0,
          ultima_publicacao: u ? this.resumoPublicacao(u) : null,
          urls: this.urls(m, id),
        };
      }),
    };
  }

  private resumoPublicacao(p: Publicacao) {
    return {
      id: p.id,
      gerado_em: p.gerado_em,
      confirmado_em: p.confirmado_em,
      periodo: { de: p.periodo_de, ate: p.periodo_ate },
      linhas: p.n_linhas,
      origem: p.origem,
      versao: p.versao,
      bytes_csv: p.bytes_csv,
      bytes_json: p.bytes_json,
      em_s3: !!p.csv_key,
    };
  }

  /** Ver o que sairia, sem publicar (antes de ligar). */
  async preVisualizar(m: Municipio, idTexto: string) {
    const g = await this.gerar(m, this.conjuntoDe(idTexto));
    return {
      conjunto: g.def.id,
      periodo: g.periodo,
      colunas: g.def.colunas.map(({ nome, tipo, descricao }) => ({
        nome,
        tipo,
        descricao,
      })),
      supressao: REGRA_SUPRESSAO,
      linhas: g.tabela.linhas,
      resumo: g.tabela.resumo,
    };
  }

  /** Ligar publica logo (se ainda não houver nada publicado com este conteúdo). */
  async alterar(
    m: Municipio,
    u: UtilizadorPainel,
    idTexto: string,
    ativo: boolean,
  ) {
    const id = this.conjuntoDe(idTexto);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO dados_abertos_conjuntos (municipio_id, conjunto, ativo, alterado_por, alterado_em)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (municipio_id, conjunto) DO UPDATE SET
           ativo = EXCLUDED.ativo, alterado_por = EXCLUDED.alterado_por, alterado_em = now()`,
        [m.id, id, ativo, u.id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: ativo ? 'ligar_dados_abertos' : 'desligar_dados_abertos',
          objetoTipo: 'conjunto_dados',
          objetoId: id,
          dados: {},
        },
        tx,
      );
    });
    const publicado = ativo
      ? await this.publicarConjunto(m, id, 'manual', u)
      : null;
    return {
      id,
      ativo,
      publicacao: publicado
        ? this.resumoPublicacao(publicado.publicacao)
        : null,
      nova: publicado?.nova ?? false,
      urls: this.urls(m, id),
    };
  }

  /** "Publicar já": um conjunto (ligado) ou todos os ligados. */
  async publicarAgora(m: Municipio, u: UtilizadorPainel, idTexto?: string) {
    const ativos = await this.ativos(m.id);
    let ids: IdConjunto[];
    if (idTexto) {
      const id = this.conjuntoDe(idTexto);
      if (!ativos.includes(id)) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'conjunto_desligado',
          'Este conjunto está desligado: ligue-o primeiro para o publicar.',
        );
      }
      ids = [id];
    } else {
      ids = ativos;
    }
    const resultados: {
      id: IdConjunto;
      nova: boolean;
      publicacao: ReturnType<TransparenciaService['resumoPublicacao']>;
      urls: ReturnType<TransparenciaService['urls']>;
    }[] = [];
    for (const id of ids) {
      const r = await this.publicarConjunto(m, id, 'manual', u);
      resultados.push({
        id,
        nova: r.nova,
        publicacao: this.resumoPublicacao(r.publicacao),
        urls: this.urls(m, id),
      });
    }
    return { conjuntos: resultados };
  }

  async detalhe(m: Municipio, idTexto: string) {
    const id = this.conjuntoDe(idTexto);
    const estado = await this.estado(m);
    const publicacoes = await this.db.query<Publicacao>(
      `SELECT ${COLUNAS_PUB} FROM dados_abertos_publicacoes p
       WHERE p.municipio_id = $1 AND p.conjunto = $2
       ORDER BY p.gerado_em DESC, p.id DESC LIMIT 20`,
      [m.id, id],
    );
    return {
      ...estado.conjuntos.find((c) => c.id === id),
      historico: publicacoes.map((p) => this.resumoPublicacao(p)),
    };
  }

  // ------------------------------------------------------------------
  // Público
  // ------------------------------------------------------------------

  private async publicacoesAtivas(m: Municipio) {
    return this.db.query<Publicacao & { primeira_em: Date }>(
      `SELECT DISTINCT ON (p.conjunto) ${COLUNAS_PUB},
              min(p.gerado_em) OVER (PARTITION BY p.conjunto) AS primeira_em
       FROM dados_abertos_publicacoes p
       JOIN dados_abertos_conjuntos c
         ON c.municipio_id = p.municipio_id AND c.conjunto = p.conjunto AND c.ativo
       WHERE p.municipio_id = $1
       ORDER BY p.conjunto, p.gerado_em DESC, p.id DESC`,
      [m.id],
    );
  }

  private naoPublicado(): ErroApi {
    return new ErroApi(
      HttpStatus.NOT_FOUND,
      'conjunto_nao_publicado',
      'Este conjunto de dados não está publicado.',
    );
  }

  private metadados(m: Municipio, def: DefConjunto) {
    return {
      id: def.id,
      titulo: def.titulo,
      descricao: def.descricao,
      palavras_chave: def.palavras_chave,
      publicador: `Município de ${m.nome}`,
      licenca: { id: LICENCA.id, nome: LICENCA.nome, url: LICENCA.url },
      frequencia: { codigo: def.frequencia, ...FREQUENCIAS[def.frequencia] },
      colunas: def.colunas.map(({ nome, tipo, descricao }) => ({
        nome,
        tipo,
        descricao,
      })),
      supressao: REGRA_SUPRESSAO,
      notas: def.notas,
      urls: this.urls(m, def.id),
    };
  }

  async catalogo(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const pubs = await this.publicacoesAtivas(m);
    return {
      municipio: { slug: m.slug, nome: m.nome },
      publicador: `Município de ${m.nome}`,
      licenca: { id: LICENCA.id, nome: LICENCA.nome, url: LICENCA.url },
      supressao: REGRA_SUPRESSAO,
      ...this.portal(m),
      conjuntos: IDS_CONJUNTOS.flatMap((id) => {
        const p = pubs.find((x) => x.conjunto === id);
        if (!p) return [];
        const def = CONJUNTOS[id];
        return [
          {
            id,
            titulo: def.titulo,
            descricao: def.descricao,
            frequencia: def.frequencia,
            atualizado_em: p.gerado_em,
            confirmado_em: p.confirmado_em,
            periodo: { de: p.periodo_de, ate: p.periodo_ate },
            linhas: p.n_linhas,
            urls: this.urls(m, id),
          },
        ];
      }),
      atualizado_em:
        pubs
          .map((p) => new Date(p.gerado_em).toISOString())
          .sort()
          .at(-1) ?? null,
    };
  }

  async dcat(slug: string) {
    const m = await this.municipios.porSlug(slug);
    const [pubs, [info]] = await Promise.all([
      this.publicacoesAtivas(m),
      this.db.query<{ email: string | null }>(
        'SELECT email_geral AS email FROM municipios WHERE id = $1',
        [m.id],
      ),
    ]);
    const iso = (d: string | Date) => new Date(d).toISOString();
    const doc = catalogoDcat({
      municipio: { slug: m.slug, nome: m.nome, email: info?.email ?? null },
      base: this.base(m),
      pagina: null,
      conjuntos: IDS_CONJUNTOS.flatMap((id) => {
        const p = pubs.find((x) => x.conjunto === id);
        return p
          ? [
              {
                def: CONJUNTOS[id],
                publicacao: {
                  id: p.id,
                  gerado_em: iso(p.gerado_em),
                  primeira_em: iso(p.primeira_em),
                  periodo_de: p.periodo_de,
                  periodo_ate: p.periodo_ate,
                  bytes_csv: p.bytes_csv,
                  bytes_json: p.bytes_json,
                },
              },
            ]
          : [];
      }),
    });
    const corpo = JSON.stringify(doc);
    return {
      corpo,
      etag: createHash('sha256').update(corpo).digest('hex').slice(0, 32),
    };
  }

  /** A publicação (a última, ou uma do histórico) de um conjunto ligado. */
  private async publicacao(m: Municipio, id: IdConjunto, pubId?: string) {
    const [p] = await this.db.query<
      Publicacao & { linhas: Linha[]; csv: string }
    >(
      `SELECT ${COLUNAS_PUB}, p.linhas, p.csv
       FROM dados_abertos_publicacoes p
       JOIN dados_abertos_conjuntos c
         ON c.municipio_id = p.municipio_id AND c.conjunto = p.conjunto AND c.ativo
       WHERE p.municipio_id = $1 AND p.conjunto = $2 AND ($3::uuid IS NULL OR p.id = $3::uuid)
       ORDER BY p.gerado_em DESC, p.id DESC LIMIT 1`,
      [m.id, id, pubId ?? null],
    );
    if (!p) throw this.naoPublicado();
    return p;
  }

  private idPublico(id: string): IdConjunto {
    if (!eConjunto(id)) throw this.naoPublicado();
    return id;
  }

  async conjuntoPublico(slug: string, idTexto: string) {
    const m = await this.municipios.porSlug(slug);
    const id = this.idPublico(idTexto);
    const p = await this.publicacao(m, id);
    return {
      ...this.metadados(m, CONJUNTOS[id]),
      publicacao: {
        ...this.resumoPublicacao(p),
        urls: this.urlsPublicacao(m, id, p.id),
      },
      dados: ordenar(CONJUNTOS[id], p.linhas),
    };
  }

  private urlsPublicacao(m: { slug: string }, id: IdConjunto, pubId: string) {
    const b = `${this.base(m)}/${id}/historico/${pubId}`;
    return { csv: `${b}.csv`, json: `${b}.json` };
  }

  /** O CSV ou o JSON (a última publicação, ou uma do histórico, que não muda). */
  async ficheiro(
    slug: string,
    idTexto: string,
    formato: 'csv' | 'json',
    pubId?: string,
  ): Promise<Ficheiro> {
    const m = await this.municipios.porSlug(slug);
    const id = this.idPublico(idTexto);
    const p = await this.publicacao(m, id, pubId);
    const dia = new Date(p.gerado_em).toISOString().slice(0, 10);
    const nome = `${m.slug}-${id}-${dia}.${formato}`;
    const modificado = new Date(p.gerado_em);
    if (formato === 'csv') {
      return {
        corpo: p.csv,
        tipo: 'text/csv; charset=utf-8',
        nome,
        etag: `${p.hash.slice(0, 32)}-csv`,
        modificado,
        imutavel: !!pubId,
      };
    }
    const doc = this.documentoJson(
      m,
      CONJUNTOS[id],
      {
        periodo_de: p.periodo_de,
        periodo_ate: p.periodo_ate,
        gerado_em: modificado.toISOString(),
        versao: p.versao,
      },
      p.linhas,
    );
    return {
      corpo: JSON.stringify(doc),
      tipo: 'application/json; charset=utf-8',
      nome,
      etag: `${p.hash.slice(0, 32)}-json`,
      modificado,
      imutavel: !!pubId,
    };
  }

  async historico(
    slug: string,
    idTexto: string,
    limite: number,
    cursor: Cursor | null,
  ) {
    const m = await this.municipios.porSlug(slug);
    const id = this.idPublico(idTexto);
    await this.publicacao(m, id); // 404 se desligado ou sem nada
    const linhas = await this.db.query<Publicacao>(
      `SELECT ${COLUNAS_PUB} FROM dados_abertos_publicacoes p
       WHERE p.municipio_id = $1 AND p.conjunto = $2
         AND ($3::timestamptz IS NULL OR (p.gerado_em, p.id) < ($3, $4::uuid))
       ORDER BY p.gerado_em DESC, p.id DESC LIMIT $5`,
      [m.id, id, cursor?.em ?? null, cursor?.id ?? null, limite + 1],
    );
    const r = pagina(linhas, limite, (l) => ({ em: l.gerado_em, id: l.id }));
    return {
      conjunto: id,
      titulo: CONJUNTOS[id].titulo,
      proximo_cursor: r.proximo_cursor,
      itens: r.itens.map((p) => ({
        id: p.id,
        gerado_em: p.gerado_em,
        confirmado_em: p.confirmado_em,
        periodo: { de: p.periodo_de, ate: p.periodo_ate },
        linhas: p.n_linhas,
        versao: p.versao,
        urls: this.urlsPublicacao(m, id, p.id),
      })),
    };
  }

  /** Os números do mês (por omissão o último mês completo). */
  async indicadores(slug: string, mesPedido?: string) {
    const m = await this.municipios.porSlug(slug);
    const hoje = hojeNoFuso(m.fuso);
    const mes = mesPedido ?? somarMeses(hoje.slice(0, 7), -1);
    if (!mesValido(mes)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'mes_invalido',
        'O mês tem de ser AAAA-MM.',
      );
    }
    const precisos = [...new Set(INDICADORES.map((i) => i.conjunto))];
    const pubs = await this.db.query<{
      conjunto: IdConjunto;
      resumo: Record<string, Linha>;
      gerado_em: Date;
    }>(
      `SELECT DISTINCT ON (p.conjunto) p.conjunto, p.resumo, p.gerado_em
       FROM dados_abertos_publicacoes p
       JOIN dados_abertos_conjuntos c
         ON c.municipio_id = p.municipio_id AND c.conjunto = p.conjunto AND c.ativo
       WHERE p.municipio_id = $1 AND p.conjunto = ANY($2::text[])
       ORDER BY p.conjunto, p.gerado_em DESC, p.id DESC`,
      [m.id, precisos],
    );
    const fontes: Partial<Record<IdConjunto, FonteIndicador>> = {};
    for (const p of pubs) {
      const u = this.urls(m, p.conjunto);
      fontes[p.conjunto] = {
        resumo: p.resumo,
        gerado_em: new Date(p.gerado_em).toISOString(),
        url: u.pagina,
        csv: u.csv,
      };
    }
    const itens = montarIndicadores(mes, fontes);
    return {
      municipio: { slug: m.slug, nome: m.nome },
      mes,
      periodo: {
        de: `${mes}-01`,
        ate: mes === hoje.slice(0, 7) ? hoje : fimDoMes(mes),
      },
      mes_completo: mes < hoje.slice(0, 7),
      licenca: { id: LICENCA.id, nome: LICENCA.nome, url: LICENCA.url },
      supressao: REGRA_SUPRESSAO,
      catalogo: this.base(m),
      atualizado_em:
        itens
          .map((i) => i.atualizado_em)
          .sort()
          .at(-1) ?? null,
      indicadores: itens,
    };
  }
}

/** O jsonb não guarda a ordem das chaves: as linhas saem pela ordem das colunas. */
function ordenar(def: DefConjunto, linhas: readonly Linha[]): Linha[] {
  return linhas.map((l) =>
    Object.fromEntries(def.colunas.map((c) => [c.nome, l[c.nome] ?? null])),
  );
}
