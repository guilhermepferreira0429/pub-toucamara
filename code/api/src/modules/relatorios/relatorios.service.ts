import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { pagina } from '../../common/paginacao.js';
import type { Cursor } from '../../common/paginacao.js';
import { DatabaseService } from '../../database/database.service.js';
import { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { MelhoriasService } from '../conhecimento/melhorias.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PainelDadosService } from '../painel/painel-dados.service.js';
import { hojeNoFuso, Periodo } from '../painel/periodos.js';
import { formatarDia, formatarValor, gerarPdf } from './pdf.js';
import {
  DadosRelatorio,
  montarDados,
  periodoDeComparacao,
  periodoRelatorio,
  TipoRelatorio,
} from './relatorio.js';

/** Quem recebe os relatórios por email. */
const PERFIS_DESTINO = ['chefe_divisao', 'vereador'];

export interface Destinatario {
  email: string;
  nome: string;
}

/** O email de um relatório (o mesmo para todos os destinatários). */
export interface CartaRelatorio {
  assunto: string;
  texto: string;
  html?: string;
  anexo: { nome: string; conteudo: Buffer } | null;
}

export interface OpcoesGerar {
  /** Mandar o email (se ainda não foi). */
  enviar: boolean;
  /** Voltar a calcular mesmo que já tenha sido enviado (pedido manual). */
  refazer: boolean;
}

const COLUNAS = `r.id, r.tipo, lower(r.periodo)::text AS de, (upper(r.periodo) - 1)::text AS ate,
  r.gerado_em, r.enviado_em, r.pdf_key IS NOT NULL AS tem_pdf`;

/**
 * Relatórios semanal (segunda 08:00) e mensal (dia 1, 08:00): dados das
 * vistas → `relatorios.dados` → PDF em S3 → email às chefias e vereação.
 * Um por (município, tipo, período): repetir o job não duplica nem reenvia.
 */
@Injectable()
export class RelatoriosService {
  private readonly logger = new Logger(RelatoriosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dados: PainelDadosService,
    private readonly armazenamento: ArmazenamentoService,
    private readonly mensagens: MensagensService,
    private readonly melhorias: MelhoriasService,
  ) {}

  /** O trabalho `relatorio_semanal` / `relatorio_mensal`: todos os municípios. */
  async correrJob(tipo: 'semanal' | 'mensal'): Promise<void> {
    const municipios = await this.db.query<Municipio>(
      'SELECT id, slug, nome, fuso FROM municipios ORDER BY slug',
    );
    const falhas: string[] = [];
    for (const m of municipios) {
      try {
        const p = periodoRelatorio(tipo, hojeNoFuso(m.fuso));
        await this.gerar(m, tipo, p, { enviar: true, refazer: false });
      } catch (e) {
        falhas.push(m.slug);
        this.logger.error(
          `Relatório ${tipo} de ${m.slug} falhou: ${(e as Error).message}`,
        );
      }
    }
    // O pg-boss volta a tentar; os que já foram enviados são saltados.
    if (falhas.length) throw new Error(`Falharam: ${falhas.join(', ')}`);
  }

  async gerar(
    m: Municipio,
    tipo: TipoRelatorio,
    p: Periodo,
    opcoes: OpcoesGerar,
  ) {
    const [existente] = await this.db.query<{
      id: string;
      enviado_em: Date | null;
    }>(
      `SELECT id, enviado_em FROM relatorios
       WHERE municipio_id = $1 AND tipo = $2 AND periodo = daterange($3::date, $4::date, '[]')`,
      [m.id, tipo, p.de, p.ate],
    );
    if (existente?.enviado_em && !opcoes.refazer) {
      return this.obter(m, existente.id);
    }

    const dados = await this.montar(m, tipo, p);
    const pdf = await gerarPdf(dados).catch((e: Error) => {
      this.logger.error(`PDF do relatório ${tipo} de ${m.slug}: ${e.message}`);
      return null;
    });
    const pdfKey = pdf ? await this.guardarPdf(m, pdf) : null;

    const [r] = await this.db.query<{ id: string; enviado_em: Date | null }>(
      `INSERT INTO relatorios (municipio_id, tipo, periodo, dados, pdf_key)
       VALUES ($1, $2, daterange($3::date, $4::date, '[]'), $5, $6)
       ON CONFLICT (municipio_id, tipo, periodo) DO UPDATE SET
         dados = EXCLUDED.dados,
         pdf_key = coalesce(EXCLUDED.pdf_key, relatorios.pdf_key),
         gerado_em = now()
       RETURNING id, enviado_em`,
      [m.id, tipo, p.de, p.ate, JSON.stringify(dados), pdfKey],
    );

    if (opcoes.enviar && !r.enviado_em) {
      await this.enviar(m, r.id, dados, pdf);
    }
    return this.obter(m, r.id);
  }

  /** Lê as vistas e monta `dados` (função pura em relatorio.ts). */
  async montar(m: Municipio, tipo: TipoRelatorio, p: Periodo) {
    const anterior = periodoDeComparacao(tipo, p);
    const [
      resAtual,
      resAnterior,
      trabAtual,
      trabAnterior,
      temasAtual,
      temasAnterior,
      semResposta,
      abertas,
      processos,
      melhorias,
    ] = await Promise.all([
      this.dados.resultadosPorCanal(m.id, p),
      this.dados.resultadosPorCanal(m.id, anterior),
      this.dados.trabalho(m.id, p),
      this.dados.trabalho(m.id, anterior),
      this.dados.temas(m.id, p),
      this.dados.temas(m.id, anterior),
      this.dados.semResposta(m.id, 10),
      this.dados.ocorrenciasAbertas(m.id),
      this.dados.processosFases(m.id),
      this.melhorias.resumo(m.id, p.de, p.ate),
    ]);
    const dados = montarDados({
      municipio: { nome: m.nome, slug: m.slug },
      tipo,
      periodo: p,
      anterior,
      resultados: { atual: resAtual, anterior: resAnterior },
      trabalho: { atual: trabAtual, anterior: trabAnterior },
      temas: { atual: temasAtual, anterior: temasAnterior },
      semResposta,
      ocorrenciasAbertas: abertas,
      processos,
    });
    // Melhorias ao portal no período (para a reunião com o vereador).
    return { ...dados, melhorias_portal: melhorias };
  }

  /** Sem armazenamento guarda-se só os dados (o PDF segue no email na mesma). */
  async guardarPdf(m: Municipio, pdf: Buffer): Promise<string | null> {
    if (!this.armazenamento.disponivel) {
      this.logger.warn(
        `Sem armazenamento (S3_BUCKET): o relatório de ${m.slug} fica só com os dados.`,
      );
      return null;
    }
    const chave = this.armazenamento.chave(m.slug, 'relatorios', 'pdf');
    try {
      await this.armazenamento.guardar(chave, pdf, 'application/pdf');
      return chave;
    } catch (e) {
      this.logger.error(`PDF não foi guardado: ${(e as Error).message}`);
      return null;
    }
  }

  /** Email às chefias e vereação ativas, com o PDF em anexo. */
  private async enviar(
    m: Municipio,
    relatorioId: string,
    d: DadosRelatorio,
    pdf: Buffer | null,
  ): Promise<void> {
    const destinos = await this.db.query<Destinatario>(
      `SELECT email, nome FROM utilizadores
       WHERE municipio_id = $1 AND ativo AND perfil = ANY($2::perfil[])
       ORDER BY nome`,
      [m.id, PERFIS_DESTINO],
    );
    await this.enviarEmails(m, relatorioId, destinos, {
      assunto: `${d.titulo} · ${m.nome} · ${formatarDia(d.periodo.de)} a ${formatarDia(d.periodo.ate)}`,
      texto: textoEmail(d),
      anexo: pdf
        ? { nome: `relatorio-${d.tipo}-${d.periodo.de}.pdf`, conteudo: pdf }
        : null,
    });
  }

  /**
   * Um email por destinatário, cada um registado em `mensagens_saida`
   * (motivo 'relatorio', chave `relatorio:<id>:<email>`): repetir não reenvia
   * a quem já recebeu. `enviado_em` quando pelo menos um recebeu.
   */
  async enviarEmails(
    m: Municipio,
    relatorioId: string,
    destinos: readonly Destinatario[],
    carta: CartaRelatorio,
  ): Promise<void> {
    if (!destinos.length) {
      this.logger.warn(
        `Relatório ${relatorioId}: ${m.slug} não tem destinatários ativos.`,
      );
      return;
    }
    let enviados = 0;
    for (const u of destinos) {
      const chave = `relatorio:${relatorioId}:${u.email}`;
      const [msg] = await this.db.query<{ id: string; estado: string }>(
        `INSERT INTO mensagens_saida (municipio_id, canal, destino, motivo, corpo, relacionado, chave_idempotencia)
         VALUES ($1, 'email', $2, 'relatorio', $3, $4, $5)
         ON CONFLICT (chave_idempotencia) DO UPDATE SET chave_idempotencia = EXCLUDED.chave_idempotencia
         RETURNING id, estado::text AS estado`,
        [
          m.id,
          u.email,
          carta.texto,
          JSON.stringify({ relatorio_id: relatorioId }),
          chave,
        ],
      );
      if (msg.estado === 'enviada' || msg.estado === 'entregue') {
        enviados++;
        continue;
      }
      try {
        await this.mensagens.email({
          para: u.email,
          assunto: carta.assunto,
          texto: `Olá ${u.nome},\n\n${carta.texto}`,
          html: carta.html,
          anexos: carta.anexo
            ? [{ ...carta.anexo, mime: 'application/pdf' }]
            : undefined,
        });
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'enviada', enviada_em = now(), erro = NULL WHERE id = $1`,
          [msg.id],
        );
        enviados++;
      } catch (e) {
        await this.db.query(
          `UPDATE mensagens_saida SET estado = 'falhou', erro = $2 WHERE id = $1`,
          [msg.id, (e as Error).message],
        );
        this.logger.error(
          `Email do relatório ${relatorioId} falhou: ${(e as Error).message}`,
        );
      }
    }
    if (enviados) {
      await this.db.query(
        'UPDATE relatorios SET enviado_em = now() WHERE id = $1',
        [relatorioId],
      );
    }
  }

  async listar(
    m: Municipio,
    tipo: TipoRelatorio | 'diario' | undefined,
    limite: number,
    cursor: Cursor | null,
  ) {
    const linhas = await this.db.query<{ id: string; gerado_em: Date }>(
      `SELECT ${COLUNAS} FROM relatorios r
       WHERE r.municipio_id = $1 AND ($2::text IS NULL OR r.tipo = $2)
         AND ($3::timestamptz IS NULL OR (r.gerado_em, r.id) < ($3, $4::uuid))
       ORDER BY r.gerado_em DESC, r.id DESC
       LIMIT $5`,
      [m.id, tipo ?? null, cursor?.em ?? null, cursor?.id ?? null, limite + 1],
    );
    return pagina(linhas, limite, (l) => ({ em: l.gerado_em, id: l.id }));
  }

  async obter(m: Municipio, id: string) {
    const [r] = await this.db.query<{ id: string }>(
      `SELECT ${COLUNAS}, r.dados FROM relatorios r WHERE r.id = $1 AND r.municipio_id = $2`,
      [id, m.id],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'relatorio_nao_encontrado',
        'Este relatório não existe.',
      );
    }
    return r;
  }

  /** URL de leitura do PDF (5 minutos). */
  async urlPdf(m: Municipio, id: string) {
    const [r] = await this.db.query<{ pdf_key: string | null }>(
      'SELECT pdf_key FROM relatorios WHERE id = $1 AND municipio_id = $2',
      [id, m.id],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'relatorio_nao_encontrado',
        'Este relatório não existe.',
      );
    }
    if (!r.pdf_key) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_pdf',
        'Este relatório não tem PDF guardado (só os dados).',
      );
    }
    const minutos = 5;
    return {
      url: await this.armazenamento.urlLeitura(r.pdf_key, minutos),
      expira_em: new Date(Date.now() + minutos * 60_000).toISOString(),
    };
  }
}

/** Corpo do email: os números principais em texto (o PDF vai em anexo). */
export function textoEmail(d: DadosRelatorio): string {
  const t = d.totais;
  const linhas = [
    `${d.titulo} de ${d.municipio.nome}, de ${formatarDia(d.periodo.de)} a ${formatarDia(d.periodo.ate)}.`,
    '',
    `Conversas: ${formatarValor(t.conversas)}`,
    `Resolvidas sem humano: ${formatarValor(t.resolvidas_sem_humano_pct)}`,
    `Passadas a um funcionário: ${formatarValor(t.passadas)}`,
    `Fora de horas: ${formatarValor(t.fora_de_horas_pct)}`,
  ];
  if (d.top_temas.length) {
    linhas.push('', 'O que mais perguntaram:');
    for (const tema of d.top_temas.slice(0, 5)) {
      linhas.push(`- ${tema.tema}: ${tema.total}`);
    }
  }
  linhas.push('', 'O relatório completo está em anexo e no painel.');
  return linhas.join('\n');
}
