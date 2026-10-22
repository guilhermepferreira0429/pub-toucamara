import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import type { LinhaResultados } from '../painel/agregados.js';
import { hojeNoFuso, somarDias } from '../painel/periodos.js';
import {
  Abertura,
  aberturaSemIa,
  ConversaJanela,
  DadosDiario,
  DadosDiarioSemAbertura,
  EmailJanela,
  horaDeGerar,
  horaNoFuso,
  instanteLocal,
  Janela,
  janelaDiaria,
  montarDiario,
  numerosConferem,
  OcorrenciaRepetida,
  OperacaoJanela,
  paraIa,
  PassagemPorResponder,
  ProcessoPrazoHoje,
  SISTEMA_ABERTURA,
  TemaJanela,
  TurnoCandidato,
} from './diario.js';
import { emailDiario, gerarPdfDiario } from './diario-saida.js';
import { Destinatario, RelatoriosService } from './relatorios.service.js';

/** `municipios.resumo_diario` (migração 0031). */
export interface ConfigResumoDiario {
  ativo: boolean;
  destinatarios: Destinatario[];
}

type MunicipioComConfig = Municipio & { resumo_diario: ConfigResumoDiario };

const MAX_ABERTURA = 900;

/**
 * A abertura do resumo: o Claude (esforço baixo, instruções fixas) escreve
 * 3 a 4 frases a partir dos números; sem IA, se falhar, se for longa demais
 * ou se escrever um número que não está nos dados, fica o texto fixo.
 */
export async function escreverAbertura(
  claude: Pick<ClaudeService, 'disponivel' | 'escrever'>,
  d: DadosDiarioSemAbertura,
  logger?: Logger,
): Promise<Abertura> {
  const modelo: Abertura = { texto: aberturaSemIa(d), origem: 'modelo' };
  if (!claude.disponivel) return modelo;
  const dados = paraIa(d);
  try {
    const texto = (
      await claude.escrever({
        tarefa: 'resumo_diario',
        minimizar: true,
        sistema: SISTEMA_ABERTURA,
        conteudo: JSON.stringify(dados),
        esforco: 'low',
        maxTokens: 4000,
      })
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!texto || texto.length > MAX_ABERTURA) return modelo;
    if (!numerosConferem(texto, dados)) {
      logger?.warn(
        'Abertura do resumo diário com números fora dos dados: fica o texto fixo.',
      );
      return modelo;
    }
    return { texto, origem: 'ia' };
  } catch (e) {
    logger?.warn(`Abertura do resumo diário sem IA: ${(e as Error).message}`);
    return modelo;
  }
}

/**
 * Resumo diário para o presidente (relatório 'diario'): as últimas 24 horas
 * lidas das tabelas (as vistas do painel são ao dia e a janela começa às
 * 07:30), guardado em `relatorios` como os outros (um por município e dia),
 * PDF de uma página e email aos destinatários de `municipios.resumo_diario`.
 */
@Injectable()
export class ResumoDiarioService {
  private readonly logger = new Logger(ResumoDiarioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly relatorios: RelatoriosService,
    private readonly claude: ClaudeService,
  ) {}

  /**
   * O trabalho `resumo_diario` (de hora a hora, aos :30): cada município
   * ativo cujo relógio já passou das 07:30 (e ainda não é meio-dia) recebe o
   * resumo do dia, uma vez. Repetir não duplica nem reenvia.
   */
  async correrJob(agora = new Date()): Promise<void> {
    const municipios = await this.db.query<MunicipioComConfig>(
      `SELECT id, slug, nome, fuso, resumo_diario FROM municipios
       WHERE (resumo_diario ->> 'ativo')::boolean
         AND jsonb_array_length(resumo_diario -> 'destinatarios') > 0
       ORDER BY slug`,
    );
    const falhas: string[] = [];
    for (const m of municipios) {
      if (!horaDeGerar(horaNoFuso(m.fuso, agora))) continue;
      try {
        const janela = janelaDiaria(hojeNoFuso(m.fuso, agora), m.fuso);
        await this.gerar(m, janela, { enviar: true, refazer: false });
      } catch (e) {
        falhas.push(m.slug);
        this.logger.error(
          `Resumo diário de ${m.slug} falhou: ${(e as Error).message}`,
        );
      }
    }
    if (falhas.length) throw new Error(`Falharam: ${falhas.join(', ')}`);
  }

  async destinatarios(m: Municipio): Promise<Destinatario[]> {
    const [r] = await this.db.query<{ resumo_diario: ConfigResumoDiario }>(
      'SELECT resumo_diario FROM municipios WHERE id = $1',
      [m.id],
    );
    const cfg = r?.resumo_diario;
    if (!cfg?.ativo || !Array.isArray(cfg.destinatarios)) return [];
    return cfg.destinatarios
      .filter(
        (d): d is Destinatario =>
          typeof d?.email === 'string' && d.email.includes('@'),
      )
      .map((d) => ({ email: d.email, nome: d.nome || d.email }));
  }

  async gerar(
    m: Municipio,
    janela: Janela,
    opcoes: { enviar: boolean; refazer: boolean },
  ) {
    const [existente] = await this.db.query<{
      id: string;
      enviado_em: Date | null;
    }>(
      `SELECT id, enviado_em FROM relatorios
       WHERE municipio_id = $1 AND tipo = 'diario' AND periodo = daterange($2::date, $2::date, '[]')`,
      [m.id, janela.dia],
    );
    if (existente?.enviado_em && !opcoes.refazer) {
      return this.relatorios.obter(m, existente.id);
    }

    const semAbertura = await this.montar(m, janela);
    const dados: DadosDiario = {
      ...semAbertura,
      abertura: await escreverAbertura(this.claude, semAbertura, this.logger),
    };
    const pdf = await gerarPdfDiario(dados).catch((e: Error) => {
      this.logger.error(`PDF do resumo diário de ${m.slug}: ${e.message}`);
      return null;
    });
    const pdfKey = pdf ? await this.relatorios.guardarPdf(m, pdf) : null;

    const [r] = await this.db.query<{ id: string; enviado_em: Date | null }>(
      `INSERT INTO relatorios (municipio_id, tipo, periodo, dados, pdf_key)
       VALUES ($1, 'diario', daterange($2::date, $2::date, '[]'), $3, $4)
       ON CONFLICT (municipio_id, tipo, periodo) DO UPDATE SET
         dados = EXCLUDED.dados,
         pdf_key = coalesce(EXCLUDED.pdf_key, relatorios.pdf_key),
         gerado_em = now()
       RETURNING id, enviado_em`,
      [m.id, janela.dia, JSON.stringify(dados), pdfKey],
    );

    if (opcoes.enviar && !r.enviado_em) {
      const email = emailDiario(dados);
      await this.relatorios.enviarEmails(m, r.id, await this.destinatarios(m), {
        assunto: email.assunto,
        texto: email.texto,
        html: email.html,
        anexo: pdf
          ? { nome: `resumo-diario-${janela.dia}.pdf`, conteudo: pdf }
          : null,
      });
    }
    return this.relatorios.obter(m, r.id);
  }

  /** Lê as tabelas da janela e monta os dados (função pura em diario.ts). */
  async montar(m: Municipio, janela: Janela): Promise<DadosDiarioSemAbertura> {
    const p = [m.id, janela.de, janela.ate];
    const fimDoDia = instanteLocal(somarDias(janela.dia, 1), '00:00', m.fuso);
    const [
      porCanal,
      [operacao],
      temas,
      conversas,
      emails,
      repetidas,
      emergencias,
      passagens,
      processos,
      turnos,
    ] = await Promise.all([
      this.db.query<LinhaResultados>(
        `SELECT canal::text AS canal, count(*)::int AS total,
                count(*) FILTER (WHERE resultado <> 'em_curso')::int AS terminadas,
                count(*) FILTER (WHERE resultado IN ('resolvida','marcacao'))::int AS resolvidas_sem_humano,
                count(*) FILTER (WHERE resultado = 'passada_funcionario')::int AS passadas,
                count(*) FILTER (WHERE resultado = 'sem_resposta')::int AS sem_resposta,
                count(*) FILTER (WHERE resultado = 'marcacao')::int AS marcacoes,
                count(*) FILTER (WHERE resultado = 'emergencia')::int AS emergencias,
                count(*) FILTER (WHERE fora_de_horas)::int AS fora_de_horas,
                coalesce(sum(duracao_s), 0)::float8 AS duracao_total_s,
                count(duracao_s)::int AS com_duracao
         FROM conversas
         WHERE municipio_id = $1 AND iniciada_em >= $2 AND iniciada_em < $3
         GROUP BY canal ORDER BY canal`,
        p,
      ),
      this.db.query<OperacaoJanela>(
        `SELECT
           (SELECT count(*) FROM ocorrencias
             WHERE municipio_id = $1 AND criada_em >= $2 AND criada_em < $3)::int AS ocorrencias_novas,
           (SELECT count(*) FROM ocorrencias
             WHERE municipio_id = $1 AND resolvida_em >= $2 AND resolvida_em < $3)::int AS ocorrencias_resolvidas,
           (SELECT count(*) FROM requerimentos
             WHERE municipio_id = $1 AND criado_em >= $2 AND criado_em < $3)::int AS requerimentos_novos,
           (SELECT count(*) FROM processos
             WHERE municipio_id = $1 AND criado_em >= $2 AND criado_em < $3)::int AS processos_novos,
           pg.pagos AS pagamentos_pagos, pg.cent AS pagos_cent, pg.teste AS pagamentos_modo_teste,
           cs.total AS chamadas_saida, cs.atendidas AS chamadas_saida_atendidas
         FROM (SELECT count(*)::int AS pagos, coalesce(sum(valor_cent), 0)::int AS cent,
                      count(*) FILTER (WHERE modo_teste)::int AS teste
               FROM pagamentos
               WHERE municipio_id = $1 AND estado = 'pago' AND pago_em >= $2 AND pago_em < $3) pg,
              (SELECT count(*)::int AS total,
                      count(*) FILTER (WHERE estado = 'atendida')::int AS atendidas
               FROM chamadas_saida
               WHERE municipio_id = $1 AND iniciada_em >= $2 AND iniciada_em < $3) cs`,
        p,
      ),
      // Os temas da janela e dos 7 dias antes dela (para a média).
      this.db.query<TemaJanela>(
        `SELECT t.id AS tema_id, t.nome AS tema,
                count(*) FILTER (WHERE c.iniciada_em >= $2)::int AS total,
                count(*) FILTER (WHERE c.iniciada_em < $2)::int AS anteriores_7d
         FROM conversas c
         JOIN temas t ON t.id = c.tema_id
         WHERE c.municipio_id = $1
           AND c.iniciada_em >= $2::timestamptz - interval '7 days' AND c.iniciada_em < $3
         GROUP BY t.id, t.nome`,
        p,
      ),
      this.db.query<ConversaJanela>(
        `SELECT c.id, c.canal::text AS canal, t.nome AS tema, c.resumo, c.resultado::text AS resultado,
                coalesce(jsonb_agg(jsonb_build_object('motivo', ph.motivo, 'resumo', ph.resumo))
                  FILTER (WHERE ph.id IS NOT NULL), '[]') AS passagens
         FROM conversas c
         LEFT JOIN temas t ON t.id = c.tema_id
         LEFT JOIN passagens_humano ph ON ph.conversa_id = c.id
         WHERE c.municipio_id = $1 AND c.iniciada_em >= $2 AND c.iniciada_em < $3
         GROUP BY c.id, t.nome
         LIMIT 5000`,
        p,
      ),
      this.db.query<EmailJanela>(
        `SELECT ee.id, coalesce(t.nome, ee.tema) AS tema, ee.assunto
         FROM emails_entrada ee
         LEFT JOIN temas t ON t.id = ee.tema_id
         WHERE ee.municipio_id = $1 AND ee.recebido_em >= $2 AND ee.recebido_em < $3
         LIMIT 5000`,
        p,
      ),
      // Avisos repetidos chegados na janela, contados no original.
      this.db.query<OcorrenciaRepetida>(
        `SELECT o.numero, cat.nome AS categoria, o.morada, count(*)::int AS repetidas
         FROM ocorrencias d
         JOIN ocorrencias o ON o.id = d.duplicada_de
         JOIN categorias_ocorrencia cat ON cat.id = o.categoria_id
         WHERE d.municipio_id = $1 AND d.criada_em >= $2 AND d.criada_em < $3
         GROUP BY o.id, cat.nome
         ORDER BY repetidas DESC, o.numero
         LIMIT 50`,
        p,
      ),
      this.db.query<{
        iniciada_em: string;
        canal: string;
        tema: string | null;
      }>(
        `SELECT to_json(c.iniciada_em) #>> '{}' AS iniciada_em, c.canal::text AS canal, t.nome AS tema
         FROM conversas c
         LEFT JOIN temas t ON t.id = c.tema_id
         WHERE c.municipio_id = $1 AND c.iniciada_em >= $2 AND c.iniciada_em < $3
           AND c.resultado = 'emergencia'
         ORDER BY c.iniciada_em
         LIMIT 10`,
        p,
      ),
      // Passagens por responder com prazo até ao fim de hoje (inclui as atrasadas).
      this.db.query<PassagemPorResponder & { total: number }>(
        `SELECT ph.motivo, t.nome AS tema, to_json(ph.responder_ate) #>> '{}' AS responder_ate,
                u.nome AS atribuida_a, ph.responder_ate < $2 AS atrasada,
                count(*) OVER ()::int AS total
         FROM passagens_humano ph
         JOIN conversas c ON c.id = ph.conversa_id
         LEFT JOIN temas t ON t.id = c.tema_id
         LEFT JOIN utilizadores u ON u.id = ph.atribuida_a
         WHERE c.municipio_id = $1 AND ph.estado IN ('aberta','em_curso')
           AND ph.responder_ate < $3
         ORDER BY ph.responder_ate
         LIMIT 10`,
        [m.id, janela.ate, fimDoDia],
      ),
      this.db.query<ProcessoPrazoHoje & { total: number }>(
        `SELECT p.numero, tp.nome AS tipo, u.nome AS tecnico, count(*) OVER ()::int AS total
         FROM processos p
         JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
         LEFT JOIN utilizadores u ON u.id = p.tecnico_id
         WHERE p.municipio_id = $1 AND p.prazo_fim = $2::date
           AND p.fase NOT IN ('notificado','arquivado')
         ORDER BY p.numero
         LIMIT 10`,
        [m.id, janela.dia],
      ),
      // Frases de munícipes (português, munícipes não anonimizados) para as citações.
      this.db.query<TurnoCandidato>(
        `SELECT tu.conversa_id, t.nome AS tema, tu.texto
         FROM conversa_turnos tu
         JOIN conversas c ON c.id = tu.conversa_id
         LEFT JOIN temas t ON t.id = c.tema_id
         LEFT JOIN municipes mu ON mu.id = c.municipe_id
         WHERE c.municipio_id = $1 AND c.iniciada_em >= $2 AND c.iniciada_em < $3
           AND tu.papel = 'municipe' AND c.idioma LIKE 'pt%'
           AND mu.anonimizado_em IS NULL
           AND length(tu.texto) BETWEEN 20 AND 600
         ORDER BY c.iniciada_em, tu.ordem
         LIMIT 2000`,
        p,
      ),
    ]);

    // `total` vem em cada linha (count(*) OVER ()): passa para fora da lista.
    const semTotal = <T extends { total: number }>(ls: T[]) => ({
      total: ls[0]?.total ?? 0,
      itens: ls.map((l) => {
        const resto: Partial<T> = { ...l };
        delete resto.total;
        return resto as Omit<T, 'total'>;
      }),
    });
    return montarDiario({
      municipio: { nome: m.nome, slug: m.slug },
      fuso: m.fuso,
      janela,
      porCanal,
      operacao,
      temas,
      conversas,
      emails,
      repetidas,
      emergencias,
      passagens: semTotal(passagens),
      processosHoje: semTotal(processos),
      turnos,
    });
  }
}
