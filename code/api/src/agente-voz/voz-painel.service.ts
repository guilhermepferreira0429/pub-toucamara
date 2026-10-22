/**
 * Painel › Agente: ouvir como fica a voz antes de gravar, e a lista dos
 * modelos (LLM) que o ElevenLabs aceita para o agente de voz.
 *
 * O exemplo é a primeira mensagem da linha (saudação + aviso de gravação),
 * dita pela voz e ao ritmo escolhidos. Gasta créditos do ElevenLabs (cerca de
 * um por carácter), por isso guarda-se em memória: o mesmo texto, voz e ritmo
 * não se pedem duas vezes.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ErroApi } from '../common/erros.js';
import { VELOCIDADE_RITMO } from '../modules/conversas/retomar.service.js';
import {
  AgenteRemoto,
  ClienteElevenLabs,
  ErroElevenLabs,
  URL_ELEVENLABS,
} from './cliente-elevenlabs.js';
import { AVISO_GRAVACAO, primeiraMensagem } from './configuracao.js';

const MAX_EXEMPLOS = 40;
const MODELO_TTS_POR_OMISSAO = 'eleven_flash_v2_5';
const VALIDADE_MODELOS_MS = 60 * 60 * 1000;

export interface PedidoExemplo {
  saudacao: string;
  voz_id?: string | null;
  ritmo: 'calmo' | 'normal' | 'rapido';
}

@Injectable()
export class VozPainelService {
  private readonly logger = new Logger(VozPainelService.name);
  private readonly exemplos = new Map<string, string>();
  private cacheModelos: { em: number; lista: string[] } | null = null;

  constructor(private readonly config: ConfigService) {}

  private cliente(): ClienteElevenLabs {
    const chave = this.config.get<string>('webhooks.elevenlabsApiKey') ?? '';
    if (!chave)
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'sem_elevenlabs',
        'O ElevenLabs não está configurado neste servidor.',
      );
    return new ClienteElevenLabs(chave, fetch, URL_ELEVENLABS);
  }

  private async remoto(agenteId: string | null): Promise<AgenteRemoto | null> {
    if (!agenteId) return null;
    try {
      return await this.cliente().agente(agenteId);
    } catch (e) {
      this.logger.warn(`Ler o agente ${agenteId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** O exemplo em MP3 (data URL), pronto para um <audio>. */
  async exemplo(
    p: PedidoExemplo,
    agenteId: string | null,
  ): Promise<{ audio: string; texto: string; voz_id: string }> {
    const texto = (
      primeiraMensagem({ saudacao: p.saudacao } as Parameters<
        typeof primeiraMensagem
      >[0]) ?? p.saudacao
    )
      .replace('{{aviso_gravacao}}', AVISO_GRAVACAO)
      .replace(/\s+/g, ' ')
      .trim();
    const tts = (
      (await this.remoto(agenteId))?.conversation_config as
        | { tts?: { voice_id?: string; model_id?: string } }
        | undefined
    )?.tts;
    const voz = p.voz_id?.trim() || tts?.voice_id;
    if (!voz)
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_voz',
        'Escolha uma voz (identificador ElevenLabs) para ouvir o exemplo.',
      );
    const velocidade = VELOCIDADE_RITMO[p.ritmo] ?? 1;
    const modelo = tts?.model_id || MODELO_TTS_POR_OMISSAO;
    const chave = createHash('sha256')
      .update(JSON.stringify([texto, voz, velocidade, modelo]))
      .digest('hex');
    let audio = this.exemplos.get(chave);
    if (!audio) {
      const cliente = this.cliente();
      let mp3: Buffer;
      try {
        mp3 = await cliente.falar(voz, texto, modelo, velocidade);
      } catch (e) {
        // Os modelos só de agentes (ex.: v3 conversacional) podem não servir
        // para texto-para-voz simples: tenta o multilingue rápido.
        if (
          !(e instanceof ErroElevenLabs) ||
          e.status >= 500 ||
          modelo === MODELO_TTS_POR_OMISSAO
        )
          throw this.erro(e);
        try {
          mp3 = await cliente.falar(voz, texto, MODELO_TTS_POR_OMISSAO, velocidade);
        } catch (e2) {
          throw this.erro(e2);
        }
      }
      audio = `data:audio/mpeg;base64,${mp3.toString('base64')}`;
      if (this.exemplos.size >= MAX_EXEMPLOS)
        this.exemplos.delete(this.exemplos.keys().next().value!);
      this.exemplos.set(chave, audio);
    }
    return { audio, texto, voz_id: voz };
  }

  /** Modelos aceites + o que está agora no agente de entrada. */
  async modelos(
    agenteId: string | null,
  ): Promise<{ modelos: string[]; no_elevenlabs: string | null }> {
    const [lista, remoto] = await Promise.all([
      this.listaModelos(),
      this.remoto(agenteId),
    ]);
    const llm = (
      (remoto?.conversation_config?.agent as
        | { prompt?: { llm?: string } }
        | undefined)?.prompt?.llm ?? null
    );
    return { modelos: lista, no_elevenlabs: llm };
  }

  private async listaModelos(): Promise<string[]> {
    if (this.cacheModelos && Date.now() - this.cacheModelos.em < VALIDADE_MODELOS_MS)
      return this.cacheModelos.lista;
    try {
      const lista = (await this.cliente().llms()).sort(
        (a, b) =>
          Number(!a.startsWith('claude')) - Number(!b.startsWith('claude')) ||
          a.localeCompare(b),
      );
      this.cacheModelos = { em: Date.now(), lista };
      return lista;
    } catch (e) {
      this.logger.warn(`Lista de LLM do ElevenLabs: ${(e as Error).message}`);
      return this.cacheModelos?.lista ?? [];
    }
  }

  private erro(e: unknown): ErroApi {
    const m = (e as Error).message ?? String(e);
    this.logger.warn(`Exemplo de voz: ${m}`);
    const status = e instanceof ErroElevenLabs ? e.status : 0;
    return new ErroApi(
      HttpStatus.BAD_GATEWAY,
      status === 401 || /quota|credits/i.test(m) ? 'elevenlabs_sem_creditos' : 'elevenlabs_falhou',
      status === 401 || /quota|credits/i.test(m)
        ? 'O ElevenLabs recusou o pedido (créditos ou chave). O exemplo não foi gerado.'
        : status === 404 || status === 400 || status === 422
          ? 'O ElevenLabs não reconheceu esta voz. Confirme o identificador.'
          : 'O ElevenLabs não respondeu. Tente outra vez daqui a pouco.',
    );
  }
}
