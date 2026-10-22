import { Injectable } from '@nestjs/common';
import { somarDiasUteis } from '../../common/dias-uteis.js';
import { pagina } from '../../common/paginacao.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { DE_PROCESSOS } from '../perguntas-chefia/consultas-processos.js';
import { Fase, FASE_ROTULO } from '../processos/regras.js';
import {
  agregarCarga,
  AMOSTRA_MINIMA,
  cargaPonderada,
  Decidido,
  DIAS_HISTORICO,
  DIAS_SEM_EVENTOS,
  DIAS_UTEIS_A_TERMINAR,
  diasUteis,
  FASES_EM_CURSO,
  FaseParada,
  FORMULA_CARGA,
  gargalo,
  LinhaCargaBd,
  MotivoParado,
  motivosParado,
  PERCENTIL_NORMAL,
  PESOS,
  referenciaPara,
  referencias,
  resumoDecididos,
  Segmento,
  temposPorFase,
} from './gestao.js';
import { diasNoPeriodo, hojeNoFuso, Periodo, somarDias } from './periodos.js';

/** Em curso = nem notificado nem arquivado (o prazo ainda corre). */
const ABERTO = `p.fase NOT IN ('notificado', 'arquivado')`;

/**
 * A vez é do munícipe: fase documentos ou um pedido de documentos por
 * responder. A mesma definição do filtro "aguarda munícipe" da lista dos
 * processos e das perguntas da chefia (lá o fragmento não é exportado).
 */
const AGUARDA = `(p.fase = 'documentos' OR EXISTS (
    SELECT 1 FROM processo_pedidos_estado pe
    WHERE pe.processo_id = p.id AND pe.respondido_em IS NULL))`;

/** Quantos ficam na lista "os mais parados". */
const MAIS_PARADOS = 20;

interface UltimoEvento {
  tipo: string;
  descricao: string;
  em: string;
}

export interface ProcessoParado {
  id: string;
  numero: string;
  tipo: string;
  fase: Fase;
  fase_rotulo: string;
  na_fase_desde: string;
  /** Dias úteis na fase atual. */
  dias_parado: number;
  dias_sem_eventos: number;
  /** O percentil 75 histórico (do tipo ou da fase); null sem histórico. */
  normal_dias_uteis: number | null;
  normal_base: 'tipo' | 'fase' | null;
  excesso_dias_uteis: number | null;
  motivos: MotivoParado[];
  vez: 'camara' | 'municipe';
  tecnico_id: string | null;
  tecnico: string | null;
  ultimo_evento: UltimoEvento | null;
}

export interface FiltrosAtrasados {
  limite: number;
  cursor: { em: string; id: string } | null;
  tecnico_id?: string;
  servico_id?: string;
  tipo_id?: string;
}

/**
 * Gestão e indicadores (V2, secção 12 das funcionalidades): carga por serviço
 * e técnico, tempos por tipo e fase, onde os processos ficam parados e os
 * atrasados. Tudo do município do pedido. A carga, os parados e os atrasados
 * são do momento (direto às tabelas); a história das fases vem da
 * mv_processos_fases_historia (0033, refrescada a cada 5 min).
 */
@Injectable()
export class GestaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipios: MunicipiosService,
  ) {}

  // --------------------------------------------------------------------
  // Carga
  // --------------------------------------------------------------------

  async carga(m: Municipio) {
    const hoje = hojeNoFuso(m.fuso);
    const feriados = await this.municipios.feriados(m.id);
    const ate = somarDiasUteis(hoje, DIAS_UTEIS_A_TERMINAR, feriados);

    const [linhas, servicos, pessoas, passagens, ocorrencias] =
      await Promise.all([
        this.db.query<LinhaCargaBd>(
          `SELECT t.servico_id, p.tecnico_id, p.fase::text AS fase,
                  count(*)::int AS abertos,
                  count(*) FILTER (WHERE p.prazo_fim < $2::date)::int AS atrasados,
                  count(*) FILTER (WHERE p.prazo_fim BETWEEN $2::date AND $3::date)::int AS a_terminar,
                  count(*) FILTER (WHERE ${AGUARDA})::int AS aguarda_municipe
           FROM processos p
           JOIN tipos_processo t ON t.id = p.tipo_processo_id
           WHERE p.municipio_id = $1 AND ${ABERTO}
           GROUP BY 1, 2, 3`,
          [m.id, hoje, ate],
        ),
        this.db.query<{ id: string; nome: string }>(
          `SELECT id, nome FROM servicos WHERE municipio_id = $1`,
          [m.id],
        ),
        this.db.query<{
          id: string;
          nome: string;
          servico_id: string | null;
          tecnico_ativo: boolean;
        }>(
          `SELECT id, nome, servico_id, (ativo AND perfil = 'tecnico') AS tecnico_ativo
           FROM utilizadores WHERE municipio_id = $1`,
          [m.id],
        ),
        this.db.query<{ utilizador_id: string | null; n: number }>(
          `SELECT ph.atribuida_a AS utilizador_id, count(*)::int AS n
           FROM passagens_humano ph
           JOIN conversas c ON c.id = ph.conversa_id
           WHERE c.municipio_id = $1 AND ph.estado IN ('aberta', 'em_curso')
           GROUP BY 1`,
          [m.id],
        ),
        this.db.query<{ servico_id: string | null; n: number }>(
          `SELECT servico_id, count(*)::int AS n FROM ocorrencias
           WHERE municipio_id = $1 AND estado IN ('nova', 'com_equipa')
           GROUP BY 1`,
          [m.id],
        ),
      ]);

    const servicoDe = new Map(pessoas.map((u) => [u.id, u.servico_id]));
    const passagensTecnico = new Map<string | null, number>();
    const passagensServico = new Map<string | null, number>();
    for (const p of passagens) {
      passagensTecnico.set(p.utilizador_id, p.n);
      // A passagem é do serviço de quem a tem; sem ninguém, "Sem serviço".
      const s = p.utilizador_id
        ? (servicoDe.get(p.utilizador_id) ?? null)
        : null;
      passagensServico.set(s, (passagensServico.get(s) ?? 0) + p.n);
    }
    const nomesServicos = new Map(servicos.map((s) => [s.id, s.nome]));

    const porServico = agregarCarga(
      linhas,
      'servico_id',
      nomesServicos,
      nomesServicos.keys(),
      'Sem serviço',
      {
        passagens: passagensServico,
        ocorrencias: new Map(ocorrencias.map((o) => [o.servico_id, o.n])),
      },
    );
    const porTecnico = agregarCarga(
      linhas,
      'tecnico_id',
      new Map(pessoas.map((u) => [u.id, u.nome])),
      pessoas.filter((u) => u.tecnico_ativo).map((u) => u.id),
      'Sem técnico',
      { passagens: passagensTecnico },
    );

    const totais = {
      abertos: 0,
      atrasados: 0,
      a_terminar: 0,
      aguarda_municipe: 0,
      passagens_em_curso: passagens.reduce((s, p) => s + p.n, 0),
      ocorrencias_abertas: ocorrencias.reduce((s, o) => s + o.n, 0),
    };
    for (const l of linhas) {
      totais.abertos += l.abertos;
      totais.atrasados += l.atrasados;
      totais.a_terminar += l.a_terminar;
      totais.aguarda_municipe += l.aguarda_municipe;
    }

    return {
      hoje,
      a_terminar_ate: ate,
      a_terminar_dias_uteis: DIAS_UTEIS_A_TERMINAR,
      formula: FORMULA_CARGA,
      pesos: PESOS,
      totais: { ...totais, carga: cargaPonderada(totais) },
      servicos: porServico.map(({ id, nome, ...l }) => ({
        servico_id: id,
        servico: nome,
        ...l,
      })),
      // As ocorrências são do serviço, não de um técnico: ficam de fora.
      tecnicos: porTecnico.map((l) => {
        const s = l.id ? (servicoDe.get(l.id) ?? null) : null;
        return {
          tecnico_id: l.id,
          tecnico: l.nome,
          servico_id: s,
          servico: s ? (nomesServicos.get(s) ?? null) : null,
          abertos: l.abertos,
          por_fase: l.por_fase,
          atrasados: l.atrasados,
          a_terminar: l.a_terminar,
          aguarda_municipe: l.aguarda_municipe,
          passagens_em_curso: l.passagens_em_curso,
          carga: l.carga,
        };
      }),
    };
  }

  // --------------------------------------------------------------------
  // Tempos
  // --------------------------------------------------------------------

  async tempos(m: Municipio, p: Periodo) {
    const feriados = await this.municipios.feriados(m.id);
    const [tipos, decididos] = await Promise.all([
      this.db.query<{
        id: string;
        codigo: string;
        nome: string;
        prazo_dias_uteis: number;
        ativo: boolean;
      }>(
        `SELECT id, codigo, nome, prazo_dias_uteis, ativo FROM tipos_processo
         WHERE municipio_id = $1 ORDER BY codigo`,
        [m.id],
      ),
      this.db.query<Decidido & { id: string; tipo_processo_id: string }>(
        `SELECT p.id, p.tipo_processo_id,
                to_char(p.criado_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS entrada,
                to_char(p.decidido_em AT TIME ZONE $2::text, 'YYYY-MM-DD') AS decisao,
                to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim
         FROM processos p
         WHERE p.municipio_id = $1 AND p.decidido_em IS NOT NULL
           AND p.decidido_em >= ($3::date)::timestamp AT TIME ZONE $2::text
           AND p.decidido_em < ($4::date + 1)::timestamp AT TIME ZONE $2::text`,
        [m.id, m.fuso, p.de, p.ate],
      ),
    ]);

    // A história das fases dos decididos: só os segmentos acabados.
    const segmentos = decididos.length
      ? await this.db.query<Segmento & { ordem: number }>(
          `SELECT processo_id, tipo_processo_id, fase::text AS fase, ordem,
                  to_char(inicio_dia, 'YYYY-MM-DD') AS inicio_dia,
                  to_char(fim_dia, 'YYYY-MM-DD') AS fim_dia
           FROM mv_processos_fases_historia
           WHERE processo_id = ANY($1::uuid[]) AND fim IS NOT NULL`,
          [decididos.map((d) => d.id)],
        )
      : [];
    // Com algum evento de fase = tem segmentos depois do 0.
    const comHistoria = new Set(
      segmentos.filter((s) => s.ordem > 0).map((s) => s.processo_id),
    );

    const contas = (ds: typeof decididos) => {
      const ids = new Set(ds.map((d) => d.id));
      const com = ds.filter((d) => comHistoria.has(d.id)).length;
      return {
        ...resumoDecididos(ds, feriados),
        com_historia_de_fases: com,
        sem_historia_de_fases: ds.length - com,
        fases: temposPorFase(
          segmentos.filter(
            (s) => ids.has(s.processo_id) && comHistoria.has(s.processo_id),
          ),
          feriados,
        ),
      };
    };

    const porTipo = new Map<string, typeof decididos>();
    for (const d of decididos) {
      porTipo.set(d.tipo_processo_id, [
        ...(porTipo.get(d.tipo_processo_id) ?? []),
        d,
      ]);
    }

    // Pedidos completos à primeira: entraram com todos os documentos (o
    // prazo começou no próprio dia). Por canal: pelo agente vs os outros.
    const [primeira] = await this.db.query<{
      total: number;
      completos: number;
      agente_total: number;
      agente_completos: number;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE c)::int AS completos,
              count(*) FILTER (WHERE agente)::int AS agente_total,
              count(*) FILTER (WHERE agente AND c)::int AS agente_completos
       FROM (
         SELECT p.conversa_origem_id IS NOT NULL AS agente,
                (p.prazo_inicio IS NOT NULL
                 AND p.prazo_inicio <= (p.criado_em AT TIME ZONE $2::text)::date) AS c
         FROM processos p
         WHERE p.municipio_id = $1
           AND p.criado_em >= ($3::date)::timestamp AT TIME ZONE $2::text
           AND p.criado_em < ($4::date + 1)::timestamp AT TIME ZONE $2::text) x`,
      [m.id, m.fuso, p.de, p.ate],
    );
    const pctDe = (a: number, b: number) =>
      b ? Math.round((a / b) * 1000) / 10 : null;

    return {
      periodo: p,
      completos_a_primeira: {
        total: primeira.total,
        completos: primeira.completos,
        pct: pctDe(primeira.completos, primeira.total),
        pelo_agente: {
          total: primeira.agente_total,
          pct: pctDe(primeira.agente_completos, primeira.agente_total),
        },
        outros_canais: {
          total: primeira.total - primeira.agente_total,
          pct: pctDe(
            primeira.completos - primeira.agente_completos,
            primeira.total - primeira.agente_total,
          ),
        },
      },
      notas: [
        'Completos à primeira: processos que entraram no período já com todos os documentos (o prazo começou no dia da entrada), pelo agente e pelos outros canais.',
        'Período aplicado à data da decisão. Tempo da entrada à decisão em dias úteis (sem fins de semana nem feriados).',
        'Dentro do prazo: decisão até ao fim do prazo legal do processo, que só começa a contar com o processo completo; os que nunca ficaram completos não entram na percentagem.',
        'Tempo em cada fase: a partir dos eventos de mudança de fase, somando as várias passagens pela mesma fase; média e mediana entre os processos que passaram por ela. Os processos sem nenhum evento de fase (ex.: importados) contam no tempo total mas não no tempo por fase. Se falta um evento pelo meio, o tempo fica na última fase conhecida.',
      ],
      total: { ...contas(decididos) },
      tipos: tipos
        .filter((t) => t.ativo || porTipo.has(t.id))
        .map((t) => ({
          tipo_id: t.id,
          codigo: t.codigo,
          nome: t.nome,
          prazo_legal_dias_uteis: t.prazo_dias_uteis,
          ...contas(porTipo.get(t.id) ?? []),
        })),
    };
  }

  // --------------------------------------------------------------------
  // Onde os processos ficam parados
  // --------------------------------------------------------------------

  async ondeParam(m: Municipio) {
    const hoje = hojeNoFuso(m.fuso);
    const desde = somarDias(hoje, -DIAS_HISTORICO);
    const feriados = await this.municipios.feriados(m.id);

    const [historico, emCurso] = await Promise.all([
      this.db.query<Segmento>(
        `SELECT processo_id, tipo_processo_id, fase::text AS fase,
                to_char(inicio_dia, 'YYYY-MM-DD') AS inicio_dia,
                to_char(fim_dia, 'YYYY-MM-DD') AS fim_dia
         FROM mv_processos_fases_historia
         WHERE municipio_id = $1 AND fim IS NOT NULL AND fim_dia >= $2::date
           AND fase NOT IN ('notificado', 'arquivado')`,
        [m.id, desde],
      ),
      this.db.query<{
        id: string;
        numero: string;
        tipo_processo_id: string;
        tipo: string;
        fase: Fase;
        tecnico_id: string | null;
        tecnico: string | null;
        na_fase_desde: string;
        movimento_dia: string;
        ultimo_evento: UltimoEvento | null;
        aguarda_municipe: boolean;
      }>(
        `SELECT p.id, p.numero, p.tipo_processo_id, t.codigo AS tipo, p.fase::text AS fase,
                p.tecnico_id, u.nome AS tecnico,
                to_char(coalesce(f.em, p.criado_em) AT TIME ZONE $2::text, 'YYYY-MM-DD') AS na_fase_desde,
                to_char(coalesce(ue.em, p.criado_em) AT TIME ZONE $2::text, 'YYYY-MM-DD') AS movimento_dia,
                CASE WHEN ue.em IS NOT NULL THEN
                  json_build_object('tipo', ue.tipo, 'descricao', ue.descricao, 'em', ue.em) END
                  AS ultimo_evento,
                ${AGUARDA} AS aguarda_municipe
         FROM processos p
         JOIN tipos_processo t ON t.id = p.tipo_processo_id
         LEFT JOIN utilizadores u ON u.id = p.tecnico_id
         LEFT JOIN LATERAL (
           SELECT e.em FROM processo_eventos e
           WHERE e.processo_id = p.id AND e.tipo = 'fase'
           ORDER BY e.em DESC LIMIT 1
         ) f ON true
         LEFT JOIN LATERAL (
           SELECT e.tipo, e.descricao, e.em FROM processo_eventos e
           WHERE e.processo_id = p.id AND e.ator_tipo <> 'sistema'
           ORDER BY e.em DESC, e.id DESC LIMIT 1
         ) ue ON true
         WHERE p.municipio_id = $1 AND ${ABERTO}`,
        [m.id, m.fuso],
      ),
    ]);

    const refs = referencias(historico, feriados);
    const fases = new Map<Fase, FaseParada & { em_curso: number }>(
      FASES_EM_CURSO.map((f) => [
        f,
        { fase: f, em_curso: 0, parados: 0, dias_parados: 0 },
      ]),
    );
    const parados: ProcessoParado[] = [];
    for (const p of emCurso) {
      const f = fases.get(p.fase);
      if (!f) continue;
      f.em_curso++;
      const dias = Math.max(0, diasUteis(p.na_fase_desde, hoje, feriados));
      const semEventos = Math.max(
        0,
        diasUteis(p.movimento_dia, hoje, feriados),
      );
      const ref = referenciaPara(refs, p.tipo_processo_id, p.fase);
      const motivos = motivosParado(dias, semEventos, ref);
      if (motivos.length === 0) continue;
      f.parados++;
      f.dias_parados += dias;
      parados.push({
        id: p.id,
        numero: p.numero,
        tipo: p.tipo,
        fase: p.fase,
        fase_rotulo: FASE_ROTULO[p.fase],
        na_fase_desde: p.na_fase_desde,
        dias_parado: dias,
        dias_sem_eventos: semEventos,
        normal_dias_uteis: ref?.dias_uteis ?? null,
        normal_base: ref?.base ?? null,
        excesso_dias_uteis: ref ? Math.max(0, dias - ref.dias_uteis) : null,
        motivos,
        vez: p.aguarda_municipe ? 'municipe' : 'camara',
        tecnico_id: p.tecnico_id,
        tecnico: p.tecnico,
        ultimo_evento: p.ultimo_evento,
      });
    }
    parados.sort(
      (a, b) =>
        b.dias_parado - a.dias_parado ||
        b.dias_sem_eventos - a.dias_sem_eventos ||
        a.numero.localeCompare(b.numero),
    );
    const g = gargalo([...fases.values()]);

    return {
      hoje,
      regra: {
        descricao: `Parado: na fase atual há mais dias úteis do que o percentil ${PERCENTIL_NORMAL} histórico desse tipo nessa fase (segmentos acabados nos últimos ${DIAS_HISTORICO} dias; com menos de ${AMOSTRA_MINIMA}, o da fase em todos os tipos; sem histórico, esta regra não se aplica), ou sem nenhum evento de pessoas (técnico, munícipe ou agente; os avisos automáticos não contam) há mais de ${DIAS_SEM_EVENTOS} dias úteis. Gargalo: a fase com mais dias úteis acumulados pelos processos parados.`,
        percentil: PERCENTIL_NORMAL,
        amostra_minima: AMOSTRA_MINIMA,
        dias_sem_eventos: DIAS_SEM_EVENTOS,
        historico_desde: desde,
      },
      total_em_curso: emCurso.length,
      total_parados: parados.length,
      fases: [...fases.values()].map((f) => ({
        fase: f.fase,
        rotulo: FASE_ROTULO[f.fase],
        em_curso: f.em_curso,
        parados: f.parados,
        dias_parados: f.dias_parados,
        normal_dias_uteis: refs.porFase.get(f.fase)?.dias_uteis ?? null,
      })),
      gargalo: g ? { ...g, rotulo: FASE_ROTULO[g.fase] } : null,
      mais_parados: parados.slice(0, MAIS_PARADOS),
    };
  }

  // --------------------------------------------------------------------
  // Atrasados
  // --------------------------------------------------------------------

  async atrasados(m: Municipio, f: FiltrosAtrasados) {
    const hoje = hojeNoFuso(m.fuso);
    const feriados = await this.municipios.feriados(m.id);
    // Os parâmetros $1..$16 do DE_PROCESSOS (perguntas da chefia): só em
    // curso ($4) e atrasados ($8), com tipo e técnico opcionais.
    const params: unknown[] = [
      m.id, // $1
      f.tipo_id ? [f.tipo_id] : null, // $2
      null, // $3 fase
      true, // $4 só em curso
      f.tecnico_id ? [f.tecnico_id] : null, // $5
      false, // $6 sem técnico
      null, // $7 zona
      true, // $8 atrasados
      null, // $9 a terminar
      false, // $10 aguarda munícipe
      null, // $11 decisão
      false, // $12 período pela decisão
      null, // $13
      null, // $14
      hoje, // $15
      m.fuso, // $16
      f.servico_id ?? null, // $17
      f.cursor?.em ?? null, // $18
      f.cursor?.id ?? null, // $19
      f.limite + 1, // $20
    ];
    const linhas = await this.db.query<{
      id: string;
      numero: string;
      tipo: string;
      tipo_nome: string;
      assunto: string;
      fase: Fase;
      tecnico_id: string | null;
      tecnico: string | null;
      prazo_fim: string;
      aguarda_municipe: boolean;
      pedido_por_responder: {
        descricao: string;
        pedido_em: string;
        prazo: string;
      } | null;
    }>(
      `SELECT p.id, p.numero, t.codigo AS tipo, t.nome AS tipo_nome, p.assunto,
              p.fase::text AS fase, p.tecnico_id, u.nome AS tecnico,
              to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
              ${AGUARDA} AS aguarda_municipe,
              (SELECT json_build_object('descricao', pe.descricao, 'pedido_em', pe.pedido_em,
                                        'prazo', to_char(pe.prazo, 'YYYY-MM-DD'))
               FROM processo_pedidos_estado pe
               WHERE pe.processo_id = p.id AND pe.respondido_em IS NULL
               ORDER BY pe.pedido_em LIMIT 1) AS pedido_por_responder
       ${DE_PROCESSOS}
         AND ($17::uuid IS NULL OR t.servico_id = $17::uuid)
         AND ($18::date IS NULL OR (p.prazo_fim, p.id) > ($18::date, $19::uuid))
       ORDER BY p.prazo_fim, p.id
       LIMIT $20`,
      params,
    );
    const r = pagina(linhas, f.limite, (l) => ({ em: l.prazo_fim, id: l.id }));
    return {
      ...r,
      itens: r.itens.map(({ aguarda_municipe, ...l }) => ({
        ...l,
        fase_rotulo: FASE_ROTULO[l.fase],
        dias_atraso: diasUteis(l.prazo_fim, hoje, feriados),
        dias_atraso_corridos: diasNoPeriodo({ de: l.prazo_fim, ate: hoje }) - 1,
        vez: aguarda_municipe ? 'municipe' : 'camara',
      })),
    };
  }
}
