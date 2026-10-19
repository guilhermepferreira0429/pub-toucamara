import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { ConversasService } from './conversas.service.js';
import {
  FILA_RESUMIR,
  FILA_SMS_FIM,
  TENTATIVAS_SMS_FIM,
} from './fim-chamada.service.js';
import { descreverObjetos, objetosDaConversa } from './objetos-conversa.js';
import {
  escolherTema,
  esquemaResumo,
  formatarTranscricao,
  montarSmsFimChamada,
  ResumoIa,
  SISTEMA_RESUMO,
  smsSemResumo,
  turnoMaisProximo,
} from './resumo.js';

interface DadosJob {
  conversaId: string;
}

/** Semelhança mínima (pg_trgm) para juntar uma pergunta a um grupo existente. */
const SEMELHANCA_GRUPO = 0.45;

/**
 * Depois da chamada: o resumo pelo Claude (resumo do painel, tema,
 * perguntas sem resposta, próximos passos, texto do SMS) e o SMS com o link
 * para a página "O que tem de fazer".
 */
@Injectable()
export class ResumoService implements OnModuleInit {
  private readonly logger = new Logger(ResumoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
    private readonly jobs: JobsService,
    private readonly links: LinksCurtosService,
    private readonly mensagens: MensagensService,
    private readonly conversas: ConversasService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<DadosJob>(FILA_RESUMIR, ({ conversaId }) =>
      this.resumir(conversaId),
    );
    this.jobs.trabalhar<DadosJob>(FILA_SMS_FIM, ({ conversaId }, job) =>
      this.smsFimChamada(conversaId, job),
    );
  }

  async resumir(conversaId: string): Promise<void> {
    const [c] = await this.db.query<{
      municipio_id: string;
      resultado: string;
      resumida_em: Date | null;
    }>(
      'SELECT municipio_id, resultado, resumida_em FROM conversas WHERE id = $1',
      [conversaId],
    );
    if (!c) throw new Error(`Conversa ${conversaId} não existe.`);
    if (c.resumida_em) return; // o webhook repetiu: já está feito
    if (!this.claude.disponivel) {
      this.logger.warn(`Conversa ${conversaId} sem resumo: IA desligada.`);
      return;
    }

    const turnos = await this.db.query<{
      id: string;
      ordem: number;
      papel: string;
      texto: string;
    }>(
      `SELECT id::text, ordem, papel, texto FROM conversa_turnos
       WHERE conversa_id = $1 ORDER BY ordem`,
      [conversaId],
    );
    if (turnos.length === 0) {
      this.logger.warn(`Conversa ${conversaId} sem turnos: nada a resumir.`);
      return;
    }
    const temas = await this.db.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM temas WHERE municipio_id = $1 ORDER BY nome',
      [c.municipio_id],
    );
    const objetos = await objetosDaConversa(this.db, conversaId);

    const r = await this.claude.extrair(esquemaResumo, {
      sistema: SISTEMA_RESUMO,
      esforco: 'medium',
      maxTokens: 4000,
      conteudo: [
        'Temas da câmara:',
        temas.length
          ? temas.map((t) => `- ${t.nome}`).join('\n')
          : '- (ainda nenhum)',
        '',
        'Registado durante a chamada:',
        descreverObjetos(objetos),
        '',
        'Transcrição:',
        formatarTranscricao(turnos),
      ].join('\n'),
    });

    await this.db.transaction(async (tx) => {
      const temaId = await this.tema(tx, c.municipio_id, r.tema, temas);
      await tx.query(
        `UPDATE conversas SET
           resumo = $2, tema_id = coalesce($3, tema_id),
           proximos_passos = $4, resumo_sms = $5, resumida_em = now(),
           -- A IA só afina o que foi posto por omissão no fim da chamada.
           resultado = CASE WHEN resultado = 'resolvida' THEN $6::resultado_conv ELSE resultado END
         WHERE id = $1`,
        [
          conversaId,
          r.resumo.trim(),
          temaId,
          JSON.stringify(
            r.proximos_passos
              .map((p) => p.trim())
              .filter(Boolean)
              .slice(0, 4),
          ),
          r.sms.trim() || null,
          r.resultado,
        ],
      );
      await this.perguntasSemResposta(tx, c.municipio_id, r, turnos);
    });
  }

  private async tema(
    tx: Tx,
    municipioId: string,
    proposto: string,
    temas: { id: string; nome: string }[],
  ): Promise<string | null> {
    const escolha = escolherTema(proposto, temas);
    if (!escolha) return null;
    if ('id' in escolha) return escolha.id;
    const [t] = await tx.query<{ id: string }>(
      `INSERT INTO temas (municipio_id, nome) VALUES ($1, $2)
       ON CONFLICT (municipio_id, nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [municipioId, escolha.novo],
    );
    return t.id;
  }

  /**
   * Cada pergunta junta-se ao grupo mais parecido do município (pg_trgm) ou
   * abre um grupo novo; a ocorrência liga o grupo ao turno. Só conta mais uma
   * vez se a ocorrência for nova (o job pode repetir).
   */
  private async perguntasSemResposta(
    tx: Tx,
    municipioId: string,
    r: ResumoIa,
    turnos: { id: string; ordem: number; papel: string }[],
  ): Promise<void> {
    for (const p of r.perguntas_sem_resposta) {
      const texto = p.texto.replace(/\s+/g, ' ').trim().slice(0, 500);
      const turnoId = turnoMaisProximo(p.turno, turnos);
      if (!texto || !turnoId) continue;

      let [grupo] = await tx.query<{ id: string }>(
        `SELECT id FROM perguntas_sem_resposta
         WHERE municipio_id = $1 AND similarity(texto, $2) > $3
         ORDER BY similarity(texto, $2) DESC LIMIT 1
         FOR UPDATE`,
        [municipioId, texto, SEMELHANCA_GRUPO],
      );
      let novo = false;
      if (!grupo) {
        [grupo] = await tx.query<{ id: string }>(
          `INSERT INTO perguntas_sem_resposta (municipio_id, texto) VALUES ($1, $2) RETURNING id`,
          [municipioId, texto],
        );
        novo = true;
      }
      const [ligada] = await tx.query<{ psr_id: string }>(
        `INSERT INTO pergunta_sem_resposta_ocorrencias (psr_id, turno_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING psr_id`,
        [grupo.id, turnoId],
      );
      if (ligada && !novo) {
        await tx.query(
          `UPDATE perguntas_sem_resposta SET vezes = vezes + 1, ultima_em = now() WHERE id = $1`,
          [grupo.id],
        );
      }
    }
  }

  /**
   * SMS do fim da chamada com o texto do resumo e o link "O que tem de
   * fazer". Sem resumo ainda, falha para o pg-boss repetir; na última
   * tentativa (ou sem IA) vai com um texto genérico: o link é o que importa.
   */
  async smsFimChamada(conversaId: string, job?: Job<DadosJob>): Promise<void> {
    const [c] = await this.db.query<{
      municipio_id: string;
      municipio_nome: string;
      municipe_id: string | null;
      telefone: string | null;
      resultado: string;
      resumo_sms: string | null;
      resumida_em: Date | null;
    }>(
      `SELECT c.municipio_id, mu.nome AS municipio_nome, c.municipe_id,
              m.telefone_e164 AS telefone, c.resultado, c.resumo_sms, c.resumida_em
       FROM conversas c
       JOIN municipios mu ON mu.id = c.municipio_id
       LEFT JOIN municipes m ON m.id = c.municipe_id AND m.anonimizado_em IS NULL
       WHERE c.id = $1`,
      [conversaId],
    );
    if (!c) throw new Error(`Conversa ${conversaId} não existe.`);
    if (!c.telefone || ['emergencia', 'caiu'].includes(c.resultado)) return;

    const ultima = !job || job.retryCount >= TENTATIVAS_SMS_FIM;
    if (!c.resumida_em && this.claude.disponivel && !ultima) {
      throw new Error(`Conversa ${conversaId}: resumo ainda por fazer.`);
    }

    const link = await this.linkResumo(c.municipio_id, conversaId);
    const corpo = montarSmsFimChamada(
      c.resumo_sms ?? smsSemResumo(c.municipio_nome),
      link.url,
    );
    await this.db.transaction(async (tx) => {
      const mensagemId = await this.mensagens.sms(
        {
          municipioId: c.municipio_id,
          municipeId: c.municipe_id,
          destino: c.telefone!,
          motivo: 'fim_chamada',
          corpo,
          relacionado: { conversa_id: conversaId },
          chave: `fim_chamada:${conversaId}`,
        },
        tx,
      );
      const [ja] = await tx.query(
        `SELECT 1 FROM conversa_momentos WHERE conversa_id = $1 AND tipo = 'sms' AND dados->>'mensagem_id' = $2`,
        [conversaId, mensagemId],
      );
      if (!ja) {
        await this.conversas.momento(
          conversaId,
          'sms',
          { mensagem_id: mensagemId, motivo: 'fim_chamada', link: link.codigo },
          tx,
        );
      }
    });
  }

  /** Um só link de resumo por conversa (o job pode repetir). */
  private async linkResumo(
    municipioId: string,
    conversaId: string,
  ): Promise<{ codigo: string; url: string }> {
    const [existente] = await this.db.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_id = $1 AND destino_tipo = 'resumo' AND expira_em > now()
       ORDER BY expira_em DESC LIMIT 1`,
      [conversaId],
    );
    if (existente) {
      // O mesmo formato que LinksCurtosService.criar devolve.
      const web = this.config.get<string>('app.webUrl') ?? '';
      return { codigo: existente.codigo, url: `${web}/r/${existente.codigo}` };
    }
    return this.links.criar(municipioId, 'resumo', conversaId);
  }
}
