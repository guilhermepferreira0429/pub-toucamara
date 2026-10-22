/**
 * Leva a configuração do agente (painel › Agente) ao ElevenLabs sem ninguém
 * ter de correr `npm run agente-voz -- sincronizar --confirmar`: gravar no
 * painel põe um trabalho na fila e este faz o mesmo que o script (prompt,
 * primeira mensagem, voz, ritmo e ferramentas dos dois agentes).
 *
 * O chat lê o agente_config em cada conversa; a voz só muda por aqui.
 * Desligar com AGENTE_VOZ_SINCRONIZAR=false (fica só o script).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service.js';
import { RegistoFerramentas } from '../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import {
  aplicar,
  ClienteElevenLabs,
  Desejado,
  planear,
  semAlteracoes,
  URL_ELEVENLABS,
} from './cliente-elevenlabs.js';
import {
  DadosMunicipio,
  ferramentasDoAgente,
  gerarAgente,
  gerarFerramentas,
  resolver,
  segredosReferidos,
} from './configuracao.js';
import { AGENTES_VOZ, gerarPrompt } from './prompt-voz.js';

export const FILA_SINCRONIZAR_AGENTE = 'sincronizar_agente_voz';

@Injectable()
export class SincronizacaoAgenteService implements OnModuleInit {
  private readonly logger = new Logger(SincronizacaoAgenteService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    private readonly registo: RegistoFerramentas,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<{ slug: string }>(FILA_SINCRONIZAR_AGENTE, ({ slug }) =>
      this.sincronizar(slug),
    );
  }

  /** Depois de gravar no painel. Nunca falha a gravação por causa disto. */
  async pedir(slug: string): Promise<void> {
    if (process.env.AGENTE_VOZ_SINCRONIZAR === 'false') return;
    try {
      await this.jobs.enviar(FILA_SINCRONIZAR_AGENTE, { slug });
    } catch (e) {
      this.logger.warn(
        `Sincronização do agente de ${slug} não pedida: ${(e as Error).message}`,
      );
    }
  }

  /** O mesmo que `agente-voz sincronizar --confirmar`, para um município. */
  async sincronizar(slug: string): Promise<void> {
    const apiKey = this.config.get<string>('webhooks.elevenlabsApiKey') ?? '';
    const apiUrl = this.config.get<string>('app.apiUrl') ?? '';
    if (!apiKey) {
      this.logger.warn('Sem ELEVENLABS_API_KEY: o agente de voz não muda.');
      return;
    }
    if (!/^https:\/\//.test(apiUrl) || /localhost|127\.0\.0\.1/.test(apiUrl)) {
      this.logger.warn(
        `API_URL (${apiUrl}) não é HTTPS público: o agente de voz não muda.`,
      );
      return;
    }
    const dados = await this.dados(slug);
    if (!dados) {
      this.logger.warn(`Sincronizar o agente: o município "${slug}" não existe.`);
      return;
    }
    const registadas = this.registo.todas();
    const gerados = AGENTES_VOZ.map((a) => {
      const lista = ferramentasDoAgente(registadas, a);
      return {
        agente: a,
        ferramentas: gerarFerramentas(lista, a),
        prompt: gerarPrompt(dados, lista, a),
        config: gerarAgente(dados, a),
      };
    });

    const cliente = new ClienteElevenLabs(apiKey, fetch, URL_ELEVENLABS);
    const segredos = await cliente.segredos();
    const faltam = segredosReferidos(
      gerados.map((g) => [g.ferramentas, g.config]),
    ).filter((n) => !segredos.has(n));
    if (faltam.length) {
      this.logger.warn(
        `Sincronizar o agente: falta(m) no ElevenLabs o(s) segredo(s) ${faltam.join(', ')}.`,
      );
      return;
    }
    const resolucao = { apiUrl, municipio: slug, segredos };

    for (const g of gerados) {
      const agenteId =
        g.agente === 'saida'
          ? dados.elevenlabs_agent_id_saida
          : dados.elevenlabs_agent_id;
      if (!agenteId) continue; // sem agente de saída próprio, a saída usa o de entrada
      const outro = gerados.find((x) => x.agente !== g.agente)!;
      const desejado: Desejado = {
        ferramentas: resolver(g.ferramentas.ferramentas, resolucao),
        prompt: g.prompt,
        agente: resolver(
          {
            conversation_config: g.config.conversation_config,
            platform_settings: g.config.platform_settings,
          },
          resolucao,
        ),
        doOutroAgente: outro.ferramentas.ferramentas.map((f) => f.name),
      };
      // As ferramentas são do workspace: lêem-se de novo para cada agente.
      const remotas = await cliente.ferramentas();
      const remoto = await cliente.agente(agenteId);
      const plano = planear(desejado, remotas, remoto);
      if (semAlteracoes(plano)) continue;
      const r = await aplicar(cliente, plano, desejado, remotas, agenteId, remoto);
      this.logger.log(
        `Agente de ${g.agente} (${slug}) sincronizado: ${r.criadas.length} ferramentas criadas, ` +
          `${r.atualizadas.length} atualizadas${r.agenteAtualizado ? ', agente atualizado' : ''}.`,
      );
    }
  }

  private async dados(slug: string): Promise<DadosMunicipio | null> {
    const [m] = await this.db.query<Omit<DadosMunicipio, 'slug'>>(
      `SELECT m.nome, m.fuso, a.nome AS nome_agente, a.saudacao, a.trata_por, a.idiomas,
              a.voz_id, a.voz_nome, a.ritmo, a.elevenlabs_agent_id,
              to_jsonb(a) ->> 'elevenlabs_agent_id_saida' AS elevenlabs_agent_id_saida,
              to_jsonb(a) ->> 'modelo_voz' AS modelo_voz
       FROM municipios m LEFT JOIN agente_config a ON a.municipio_id = m.id
       WHERE m.slug = $1`,
      [slug],
    );
    return m ? ({ ...m, slug } as DadosMunicipio) : null;
  }
}
