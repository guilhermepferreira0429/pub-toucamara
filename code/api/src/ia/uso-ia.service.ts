import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { iaConfig } from '../config/configuration.js';
import {
  contextoMunicipio,
  DatabaseService,
} from '../database/database.service.js';
import { custoClaude, emEuros, Tokens } from './precos.js';

export interface RegistoUsoIa {
  tarefa: string;
  modelo: string;
  resultado: 'ok' | 'erro' | 'recusa' | 'limite';
  tokens?: Tokens;
  duracaoMs?: number;
  /** Por defeito, o do pedido do painel em curso (contextoMunicipio). */
  municipioId?: string | null;
  alvo?: { tipo: string; id: string } | null;
  dadosMinimizados?: boolean;
  instrucoesDetetadas?: number;
}

/** Tipos de alvo → tabela com municipio_id (nomes fixos: nunca vêm de fora). */
const TABELAS_ALVO: Record<string, string> = {
  conversa: 'conversas',
  processo: 'processos',
  email: 'emails_entrada',
  fonte: 'fontes',
  ocorrencia: 'ocorrencias',
  reclamacao: 'reclamacoes',
};

/** O teto do mês vê-se no máximo uma vez por minuto por município. */
const VALIDADE_TETO_MS = 60_000;

/**
 * Registo do uso da IA (tabela uso_ia): tokens, custo estimado e a que diz
 * respeito. Daqui saem o custo por atendimento do painel, o teto mensal e a
 * lista "onde a IA foi usada" num processo ou conversa. Nunca guarda texto.
 * Um registo que falha não parte a chamada que já foi feita.
 */
@Injectable()
export class UsoIaService {
  private readonly logger = new Logger(UsoIaService.name);
  private readonly teto = new Map<string, { em: number; passou: boolean }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private cfg() {
    return this.config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
  }

  municipioAtual(): string | null {
    return contextoMunicipio.getStore()?.municipioId ?? null;
  }

  async registar(r: RegistoUsoIa): Promise<void> {
    const t = r.tokens ?? {
      entrada: 0,
      saida: 0,
      cacheLidos: 0,
      cacheEscritos: 0,
    };
    const municipioId =
      (r.municipioId === undefined ? this.municipioAtual() : r.municipioId) ??
      (r.alvo ? await this.municipioDoAlvo(r.alvo) : null);
    try {
      await this.db.query(
        `INSERT INTO uso_ia (municipio_id, tarefa, modelo, resultado, tokens_entrada, tokens_saida,
           tokens_cache_lidos, tokens_cache_escritos, custo_microdolares, duracao_ms,
           alvo_tipo, alvo_id, dados_minimizados, instrucoes_detetadas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          municipioId,
          r.tarefa,
          r.modelo,
          r.resultado,
          t.entrada,
          t.saida,
          t.cacheLidos,
          t.cacheEscritos,
          custoClaude(r.modelo, t),
          r.duracaoMs ?? null,
          r.alvo?.tipo ?? null,
          r.alvo?.id ?? null,
          r.dadosMinimizados ?? false,
          r.instrucoesDetetadas ?? 0,
        ],
      );
      if (municipioId) this.teto.delete(municipioId);
    } catch (e) {
      this.logger.warn(
        `Uso da IA não registado (${r.tarefa}): ${(e as Error).message}`,
      );
    }
  }

  /** Nos jobs não há pedido do painel: o município vem do alvo. */
  private async municipioDoAlvo(alvo: {
    tipo: string;
    id: string;
  }): Promise<string | null> {
    const tabela = TABELAS_ALVO[alvo.tipo];
    if (!tabela) return null;
    const [r] = await this.db
      .query<{
        municipio_id: string;
      }>(`SELECT municipio_id FROM ${tabela} WHERE id = $1`, [alvo.id])
      .catch(() => []);
    return r?.municipio_id ?? null;
  }

  /** O município passou o teto mensal (IA_LIMITE_MENSAL_EUR)? Sem teto, nunca. */
  async tetoPassado(municipioId: string | null): Promise<boolean> {
    const limite = this.cfg().limiteMensalEur;
    if (limite == null || !municipioId) return false;
    const guardado = this.teto.get(municipioId);
    if (guardado && Date.now() - guardado.em < VALIDADE_TETO_MS) {
      return guardado.passou;
    }
    const [r] = await this.db
      .query<{ micro: string }>(
        `SELECT coalesce(sum(custo_microdolares), 0)::text AS micro FROM uso_ia
         WHERE municipio_id = $1 AND em >= date_trunc('month', now() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`,
        [municipioId],
      )
      .catch(() => [{ micro: '0' }]);
    const passou = emEuros(Number(r.micro), this.cfg().usdEur) >= limite;
    this.teto.set(municipioId, { em: Date.now(), passou });
    return passou;
  }

  /**
   * Custos do período para o painel: IA por tarefa, voz (minutos de chamada ×
   * preço por minuto) e o custo médio por atendimento (conversas iniciadas).
   */
  async custos(municipioId: string, desde: string, ate: string) {
    const { usdEur, vozUsdMinuto, limiteMensalEur } = this.cfg();
    const [porTarefa, [conv], [mes]] = await Promise.all([
      this.db.query<{
        tarefa: string;
        pedidos: number;
        micro: string;
        tokens: string;
        instrucoes: number;
        minimizados: number;
      }>(
        `SELECT tarefa, count(*)::int AS pedidos, sum(custo_microdolares)::text AS micro,
                sum(tokens_entrada + tokens_saida + tokens_cache_lidos + tokens_cache_escritos)::text AS tokens,
                sum(instrucoes_detetadas)::int AS instrucoes,
                count(*) FILTER (WHERE dados_minimizados)::int AS minimizados
         FROM uso_ia
         WHERE municipio_id = $1 AND em >= $2::date AND em < $3::date + 1
         GROUP BY tarefa ORDER BY sum(custo_microdolares) DESC`,
        [municipioId, desde, ate],
      ),
      this.db.query<{ atendimentos: number; segundos_voz: string }>(
        `SELECT count(*)::int AS atendimentos,
                coalesce(sum(duracao_s) FILTER (WHERE canal = 'telefone'), 0)::text AS segundos_voz
         FROM conversas
         WHERE municipio_id = $1 AND iniciada_em >= $2::date AND iniciada_em < $3::date + 1`,
        [municipioId, desde, ate],
      ),
      this.db.query<{ micro: string }>(
        `SELECT coalesce(sum(custo_microdolares), 0)::text AS micro FROM uso_ia
         WHERE municipio_id = $1 AND em >= date_trunc('month', now() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`,
        [municipioId],
      ),
    ]);
    const euros = (micro: number) =>
      Math.round(emEuros(micro, usdEur) * 10_000) / 10_000;
    const microIa = porTarefa.reduce((s, t) => s + Number(t.micro), 0);
    const minutosVoz = Number(conv.segundos_voz) / 60;
    const microVoz = Math.round(minutosVoz * vozUsdMinuto * 1_000_000);
    const total = euros(microIa + microVoz);
    return {
      desde,
      ate,
      estimativa: true,
      cambio_usd_eur: usdEur,
      atendimentos: conv.atendimentos,
      ia_eur: euros(microIa),
      voz_eur: euros(microVoz),
      voz_minutos: Math.round(minutosVoz),
      total_eur: total,
      por_atendimento_eur:
        conv.atendimentos > 0
          ? Math.round((total / conv.atendimentos) * 10_000) / 10_000
          : null,
      instrucoes_detetadas: porTarefa.reduce((s, t) => s + t.instrucoes, 0),
      pedidos_minimizados: porTarefa.reduce((s, t) => s + t.minimizados, 0),
      por_tarefa: porTarefa.map((t) => ({
        tarefa: t.tarefa,
        pedidos: t.pedidos,
        tokens: Number(t.tokens),
        eur: euros(Number(t.micro)),
      })),
      mes: {
        eur: euros(Number(mes.micro)),
        limite_eur: limiteMensalEur,
      },
    };
  }

  /** Onde a IA foi usada para uma conversa, processo, email... (transparência). */
  async registoDe(municipioId: string, alvoTipo: string, alvoId: string) {
    const { usdEur } = this.cfg();
    const linhas = await this.db.query<{
      em: Date;
      tarefa: string;
      modelo: string;
      resultado: string;
      micro: string;
      dados_minimizados: boolean;
      instrucoes_detetadas: number;
    }>(
      `SELECT em, tarefa, modelo, resultado, custo_microdolares::text AS micro,
              dados_minimizados, instrucoes_detetadas
       FROM uso_ia
       WHERE municipio_id = $1 AND alvo_tipo = $2 AND alvo_id = $3
       ORDER BY em DESC LIMIT 200`,
      [municipioId, alvoTipo, alvoId],
    );
    return linhas.map((l) => ({
      em: l.em,
      tarefa: l.tarefa,
      modelo: l.modelo,
      resultado: l.resultado,
      eur: Math.round(emEuros(Number(l.micro), usdEur) * 10_000) / 10_000,
      dados_minimizados: l.dados_minimizados,
      instrucoes_detetadas: l.instrucoes_detetadas,
    }));
  }
}
