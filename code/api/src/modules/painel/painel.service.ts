import { Injectable } from '@nestjs/common';
import { diasUteisEntre, somarDiasUteis } from '../../common/dias-uteis.js';
import { MelhoriasService } from '../conhecimento/melhorias.service.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import {
  indicadoresDoPeriodo,
  mapaCalor,
  montarSeries,
  resumir,
  resumirProcessos,
  topTemas,
  trabalhoFeito,
} from './agregados.js';
import { PainelDadosService } from './painel-dados.service.js';
import {
  Agrupar,
  agruparPorOmissao,
  baldes,
  hojeNoFuso,
  Periodo,
  periodoAnterior,
  semanaAteHoje,
} from './periodos.js';

/** Cópia do objeto sem as chaves (os totais que vêm em cada linha). */
function sem<T extends object, K extends keyof T>(
  o: T,
  ...chaves: K[]
): Omit<T, K> {
  const r = { ...o };
  for (const k of chaves) delete r[k];
  return r;
}

/** "Processos com prazo a acabar": até 3 dias úteis (e os já atrasados). */
const DIAS_UTEIS_ALERTA = 3;

@Injectable()
export class PainelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly dados: PainelDadosService,
    private readonly municipios: MunicipiosService,
    private readonly melhorias: MelhoriasService,
  ) {}

  hoje(m: Municipio): string {
    return hojeNoFuso(m.fuso);
  }

  async visaoGeral(m: Municipio, p: Periodo) {
    const anterior = periodoAnterior(p);
    const semana = semanaAteHoje(this.hoje(m));
    const [
      resAtual,
      resAnterior,
      trabalho,
      porHora,
      temasAtual,
      temasAnterior,
      atencao,
      melhorias,
    ] = await Promise.all([
      this.dados.resultadosPorCanal(m.id, p),
      this.dados.resultadosPorCanal(m.id, anterior),
      this.dados.trabalho(m.id, semana),
      this.dados.conversasPorHora(m.id, p),
      this.dados.temas(m.id, p),
      this.dados.temas(m.id, anterior),
      this.atencao(m),
      this.melhorias.resumo(m.id, p.de, p.ate),
    ]);
    return {
      periodo: p,
      periodo_anterior: anterior,
      indicadores: indicadoresDoPeriodo(
        resumir(resAtual),
        resumir(resAnterior),
      ),
      trabalho_semana: { ...semana, ...trabalhoFeito(trabalho) },
      quando_ligam: mapaCalor(porHora),
      o_que_perguntam: topTemas(temasAtual, temasAnterior),
      atencao,
      // "Perguntas sem resposta que levaram a melhorar o portal" (métrica do PRD).
      melhorias_portal: melhorias,
    };
  }

  async indicadores(m: Municipio, p: Periodo, agrupar?: Agrupar) {
    const ag = agrupar ?? agruparPorOmissao(p);
    const [resultados, trabalho, porCanal, totalTrabalho, fases, abertas] =
      await Promise.all([
        this.dados.resultadosPorBalde(m.id, p, ag),
        this.dados.trabalhoPorBalde(m.id, p, ag),
        this.dados.resultadosPorCanal(m.id, p),
        this.dados.trabalho(m.id, p),
        this.dados.processosFases(m.id),
        this.dados.ocorrenciasAbertas(m.id),
      ]);
    const r = resumir(porCanal);
    return {
      periodo: p,
      agrupar: ag,
      series: montarSeries(baldes(p, ag), resultados, trabalho, ag),
      totais: {
        ...r,
        por_canal: Object.fromEntries(
          porCanal.map((l): [string, number] => [l.canal ?? '', l.total]),
        ),
        sms: {
          enviados: totalTrabalho.sms_enviados,
          segmentos: totalTrabalho.sms_segmentos,
          custo_cent: totalTrabalho.sms_custo_cent,
        },
        ocorrencias: {
          registadas: totalTrabalho.ocorrencias,
          resolvidas: totalTrabalho.ocorrencias_resolvidas,
          tempo_medio_resolucao_h: totalTrabalho.ocorrencias_resolvidas
            ? Math.round(
                (totalTrabalho.horas_resolucao /
                  totalTrabalho.ocorrencias_resolvidas) *
                  10,
              ) / 10
            : null,
          abertas_agora: abertas,
        },
      },
      processos: resumirProcessos(fases),
    };
  }

  /** O que precisa de atenção agora: listas curtas, direto às tabelas. */
  async atencao(m: Municipio) {
    const hoje = this.hoje(m);
    const feriados = await this.municipios.feriados(m.id);
    const limitePrazo = somarDiasUteis(hoje, DIAS_UTEIS_ALERTA, feriados);

    const [passagens, ocorrencias, processos, semResposta, [porResponder]] =
      await Promise.all([
        this.db.query<{
          id: string;
          conversa_id: string;
          motivo: string;
          resumo: string;
          estado: string;
          responder_ate: Date | null;
          criada_em: Date;
          atribuida_a: string | null;
          atribuida_a_nome: string | null;
          atrasada: boolean;
          total: number;
          total_atrasadas: number;
        }>(
          `SELECT p.id, p.conversa_id, p.motivo, p.resumo, p.estado, p.responder_ate,
                p.criada_em, p.atribuida_a, u.nome AS atribuida_a_nome,
                coalesce(p.responder_ate < now(), false) AS atrasada,
                count(*) OVER ()::int AS total,
                (count(*) FILTER (WHERE p.responder_ate < now()) OVER ())::int AS total_atrasadas
         FROM passagens_humano p
         JOIN conversas c ON c.id = p.conversa_id
         LEFT JOIN utilizadores u ON u.id = p.atribuida_a
         WHERE c.municipio_id = $1 AND c.oculto_em IS NULL AND p.estado IN ('aberta','em_curso')
         ORDER BY p.responder_ate ASC NULLS LAST, p.criada_em ASC
         LIMIT 5`,
          [m.id],
        ),
        this.db.query<{
          id: string;
          numero: string;
          categoria: string;
          icone: string | null;
          descricao: string;
          morada: string;
          criada_em: Date;
          total: number;
        }>(
          `SELECT o.id, o.numero, cat.nome AS categoria, cat.icone, o.descricao, o.morada,
                o.criada_em, count(*) OVER ()::int AS total
         FROM ocorrencias o
         JOIN categorias_ocorrencia cat ON cat.id = o.categoria_id
         WHERE o.municipio_id = $1 AND o.oculto_em IS NULL AND o.estado = 'nova' AND o.duplicada_de IS NULL
         ORDER BY o.criada_em DESC
         LIMIT 5`,
          [m.id],
        ),
        this.db.query<{
          id: string;
          numero: string;
          assunto: string;
          fase: string;
          prazo_fim: string;
          tecnico_id: string | null;
          tecnico: string | null;
        }>(
          `SELECT p.id, p.numero, p.assunto, p.fase::text AS fase,
                to_char(p.prazo_fim, 'YYYY-MM-DD') AS prazo_fim,
                p.tecnico_id, u.nome AS tecnico
         FROM processos p
         LEFT JOIN utilizadores u ON u.id = p.tecnico_id
         WHERE p.municipio_id = $1 AND p.fase NOT IN ('notificado','arquivado')
           AND p.prazo_fim IS NOT NULL AND p.prazo_fim <= $2::date
         ORDER BY p.prazo_fim ASC, p.numero
         LIMIT 10`,
          [m.id, limitePrazo],
        ),
        this.dados.semResposta(m.id, 5),
        // O total da mesma lista (não as conversas sem resposta do período).
        this.db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM perguntas_sem_resposta
         WHERE municipio_id = $1 AND estado IN ('nova','com_equipa','espera_camara')`,
          [m.id],
        ),
      ]);

    return {
      passagens: {
        total: passagens[0]?.total ?? 0,
        atrasadas: passagens[0]?.total_atrasadas ?? 0,
        itens: passagens.map((p) => sem(p, 'total', 'total_atrasadas')),
      },
      ocorrencias_novas: {
        total: ocorrencias[0]?.total ?? 0,
        itens: ocorrencias.map((o) => sem(o, 'total')),
      },
      prazos_a_acabar: {
        ate: limitePrazo,
        itens: processos.map((p) => {
          const restantes = diasUteisEntre(hoje, p.prazo_fim, feriados);
          return {
            ...p,
            dias_uteis_restantes: restantes,
            atrasado: restantes < 0,
          };
        }),
      },
      sem_resposta: { total: porResponder?.n ?? 0, itens: semResposta },
    };
  }
}
