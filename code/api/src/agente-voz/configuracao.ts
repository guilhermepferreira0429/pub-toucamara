/*
 * A configuração do agente de voz no ElevenLabs, gerada a partir do código:
 * as ferramentas registadas (RegistoFerramentas), as variáveis dinâmicas que
 * os webhooks devolvem e o agente_config do município. Escreve-se em
 * `code/api/agente-voz/` (versionado) com `npm run agente-voz -- gerar`.
 *
 * Os ficheiros não levam valores de ambiente nem segredos: ficam marcadores
 * que só se resolvem no `diff`/`sincronizar`:
 * - `${API_URL}`            → API_URL da API (tem de ser HTTPS público)
 * - `${MUNICIPIO}`          → o slug do município (header X-Municipio)
 * - `${SEGREDO:<nome>}`     → o id do segredo com esse nome no ElevenLabs
 */
import type { Ferramenta } from '../ferramentas/ferramenta.js';
import { agentesDe } from '../ferramentas/registo-ferramentas.service.js';
import { VARIAVEIS_SAIDA_VAZIAS } from '../modules/chamadas-saida/regras.js';
import { CAMPO_CONSENTIMENTO } from '../modules/conversas/elevenlabs.js';
import { VARIAVEIS_VAZIAS } from '../modules/conversas/retomar.js';
import {
  VELOCIDADE_RITMO,
  type Ritmo,
} from '../modules/conversas/retomar.service.js';
import { Aviso, converterZod, ObjetoEl } from './esquema-elevenlabs.js';
import type { AgenteVoz } from './prompt-voz.js';

/** Nome do segredo a criar no ElevenLabs (Agents › Secrets) com o AGENTE_SEGREDO. */
export const SEGREDO_AGENTE = 'toucamara_agente_segredo';

export const MARCADOR_API_URL = '${API_URL}';
export const MARCADOR_MUNICIPIO = '${MUNICIPIO}';
export const marcadorSegredo = (nome: string) => `\${SEGREDO:${nome}}`;

/** Caminho das ferramentas na API: é por aqui que se reconhecem as nossas. */
export const CAMINHO_FERRAMENTAS = '/v1/agent/tools/';

/** Tempo de espera por omissão (a API responde em < 400 ms no p95). */
export const ESPERA_S = 20;
/** Ferramentas que chamam a IA ou serviços externos: mais tempo. */
export const ESPERA_LONGA_S: Record<string, number> = { redigir: 45 };

export type CabecalhoEl =
  string | { secret_id: string } | { variable_name: string };

export interface FerramentaEl {
  type: 'webhook';
  name: string;
  description: string;
  response_timeout_secs: number;
  /** Os erros da API (código e mensagem) vão para o modelo tal como estão. */
  tool_error_handling_mode: 'passthrough';
  api_schema: {
    url: string;
    method: 'POST';
    content_type: 'application/json';
    request_headers: Record<string, CabecalhoEl>;
    request_body_schema?: ObjetoEl;
  };
}

export interface FicheiroFerramentas {
  _leia_me: string;
  formato: string;
  marcadores: Record<string, string>;
  ferramentas: FerramentaEl[];
  avisos: Aviso[];
}

/** Headers que o AgentToolsController lê (ver agent-tools.controller.ts). */
export function cabecalhosFerramentas(): Record<string, CabecalhoEl> {
  return {
    'X-Agente-Segredo': { secret_id: marcadorSegredo(SEGREDO_AGENTE) },
    'X-Municipio': MARCADOR_MUNICIPIO,
    'X-Conversa-Id': { variable_name: 'system__conversation_id' },
    'X-Telefone': { variable_name: 'system__caller_id' },
    'X-Telefone-Web': { variable_name: 'telefone' },
  };
}

/** As ferramentas de um agente de voz (as `agentes` de cada ferramenta). */
export function ferramentasDoAgente(
  lista: Ferramenta[],
  agente: AgenteVoz,
): Ferramenta[] {
  return lista.filter((f) => agentesDe(f).includes(agente));
}

export function gerarFerramentas(
  lista: Ferramenta[],
  agente?: AgenteVoz,
): FicheiroFerramentas {
  const avisos: Aviso[] = [];
  const ferramentas = [...lista]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((f): FerramentaEl => {
      const { esquema, avisos: a } = converterZod(f.nome, f.entrada);
      avisos.push(...a);
      return {
        type: 'webhook',
        name: f.nome,
        description: f.descricao,
        response_timeout_secs: ESPERA_LONGA_S[f.nome] ?? ESPERA_S,
        tool_error_handling_mode: 'passthrough',
        api_schema: {
          url: `${MARCADOR_API_URL}${CAMINHO_FERRAMENTAS}${f.nome}`,
          method: 'POST',
          content_type: 'application/json',
          request_headers: cabecalhosFerramentas(),
          ...(esquema ? { request_body_schema: esquema } : {}),
        },
      };
    });
  return {
    _leia_me: `Gerado por \`npm run agente-voz -- gerar\` a partir das ferramentas registadas na API${agente ? ` com \`agentes\` a incluir '${agente}'` : ''}. Não editar à mão: muda o zod/descrição da ferramenta e volta a gerar. Ver README.md.`,
    formato:
      'tool_config das webhook tools do ElevenLabs Agents (POST /v1/convai/tools, corpo { tool_config }).',
    marcadores: {
      [MARCADOR_API_URL]: 'API_URL da API (HTTPS público)',
      [MARCADOR_MUNICIPIO]:
        'slug do município (--municipio, por omissão guimaraes)',
      [marcadorSegredo(SEGREDO_AGENTE)]:
        `id do segredo "${SEGREDO_AGENTE}" no ElevenLabs (valor = AGENTE_SEGREDO da API)`,
    },
    ferramentas,
    avisos,
  };
}

// ---------------------------------------------------------------------
// Variáveis dinâmicas
// ---------------------------------------------------------------------

/**
 * Todas as variáveis dinâmicas que o agente recebe, com o valor por omissão
 * (placeholder). O ElevenLabs recusa a conversa se o prompt usar uma
 * variável que não chega; numa chamada pelo browser o webhook de início não
 * corre, por isso todas têm placeholder.
 * - início da chamada (retomar.ts): nome_municipe, ja_ligou, ...
 * - chamadas de saída (chamadas-saida/regras.ts): tipo_chamada, motivo, ...
 * - página /ligar (fluxo-chamada.tsx): municipio, canal, telefone, quer_sms
 */
export function variaveisDinamicas(municipio: string): Record<string, string> {
  return {
    ...VARIAVEIS_VAZIAS,
    ...VARIAVEIS_SAIDA_VAZIAS,
    municipio,
    canal: 'telefone',
    telefone: '',
    quer_sms: 'sim',
  };
}

// ---------------------------------------------------------------------
// agente.json
// ---------------------------------------------------------------------

/** O que se sabe do município (agente_config); null quando a BD não está. */
export interface DadosMunicipio {
  slug: string;
  nome: string | null;
  nome_agente: string | null;
  saudacao: string | null;
  trata_por: string | null;
  idiomas: string[] | null;
  voz_id: string | null;
  voz_nome: string | null;
  ritmo: string | null;
  elevenlabs_agent_id: string | null;
  /** O agente das chamadas da câmara (0082); sem ele usa-se o de entrada. */
  elevenlabs_agent_id_saida: string | null;
  fuso: string | null;
}

export const AVISO_GRAVACAO =
  'Esta chamada é gravada para a câmara poder confirmar o que lhe foi dito; se não quiser, diga-me.';

export function primeiraMensagem(
  m: DadosMunicipio,
  agente: AgenteVoz = 'entrada',
): string | null {
  if (agente === 'saida') {
    // Foi a câmara que ligou: diz quem fala; o motivo vem logo a seguir
    // (prompt, com as variáveis da chamada).
    if (!m.nome) return null;
    const nome = m.nome_agente ?? 'Tou, Câmara?';
    return `Olá, daqui fala o assistente ${nome} da Câmara Municipal de ${m.nome}. ${AVISO_GRAVACAO}`;
  }
  if (!m.saudacao) return null;
  // "Olá, fala com o Tou, Câmara?": o ponto de interrogação é do nome.
  const t = m.saudacao.trim();
  const s = /[.!?]$/.test(t) ? t : `${t}.`;
  return `${s} ${AVISO_GRAVACAO} Em que posso ajudar?`;
}

export interface FicheiroAgente {
  _leia_me: string;
  /** Comentários por caminho: o que é null e porquê, e o que confirmar. */
  _notas: Record<string, string>;
  municipio: string;
  /** entrada (quem liga) ou saida (a câmara liga). */
  agente: AgenteVoz;
  elevenlabs_agent_id: string | null;
  /** Enviado no PATCH /v1/convai/agents/{id} (sem os null). */
  conversation_config: Record<string, unknown>;
  platform_settings: Record<string, unknown>;
}

export function gerarAgente(
  m: DadosMunicipio,
  agente: AgenteVoz = 'entrada',
): FicheiroAgente {
  const saida = agente === 'saida';
  const velocidade =
    m.ritmo && m.ritmo in VELOCIDADE_RITMO
      ? VELOCIDADE_RITMO[m.ritmo as Ritmo]
      : null;
  const segredo = { secret_id: marcadorSegredo(SEGREDO_AGENTE) };
  return {
    _leia_me:
      'Gerado por `npm run agente-voz -- gerar`. O `sincronizar --confirmar` envia conversation_config e platform_settings sem os valores null (o prompt e a lista de ferramentas vêm de prompt.md e ferramentas.json). Ver README.md.',
    _notas: {
      elevenlabs_agent_id: saida
        ? 'agente_config.elevenlabs_agent_id_saida do município (ou --agente-saida no comando). Sem ele, as chamadas da câmara usam o agente de entrada.'
        : 'agente_config.elevenlabs_agent_id do município (ou --agente-entrada / --agente no comando).',
      'conversation_config.agent.first_message': saida
        ? 'Quem fala, da câmara, + aviso de gravação (a câmara é que ligou; o motivo vem do prompt). null se a BD não estava acessível ao gerar.'
        : 'agente_config.saudacao + aviso de gravação (na linha telefónica é este o aviso). null se a BD não estava acessível ao gerar.',
      'conversation_config.agent.language':
        '"pt". A variante de Portugal (PT-PT) vem da voz e do prompt; confirmar no ElevenLabs se há um código pt-PT próprio.',
      'conversation_config.agent.prompt.timezone':
        'municipios.fuso. Campo do SDK 2.74; confirmar que o agente o aceita.',
      'conversation_config.agent.dynamic_variables.dynamic_variable_placeholders':
        'Todas as variáveis que o prompt e os headers das ferramentas usam, com o valor por omissão (numa chamada pelo browser o webhook de início não corre). Confirmar que o ElevenLabs as usa quando a variável não chega.',
      'conversation_config.tts.voice_id':
        'agente_config.voz_id (no painel "Agente"). null: ainda não há voz escolhida; fica a que está no ElevenLabs.',
      'conversation_config.tts.speed':
        'agente_config.ritmo → calmo 0,9, normal 1, rápido 1,1 (retomar.service.ts).',
      'conversation_config.tts.model_id':
        'Não está no código. Para português tem de ser um modelo multilingue (ex.: eleven_flash_v2_5); escolher no ElevenLabs.',
      'conversation_config.conversation.client_events':
        'A página /ligar mostra os cartões a partir de agent_tool_request/agent_tool_response e precisa do agent_tool_response_full_payload (components/chamada/registo.ts).',
      'conversation_config.conversation.max_duration_seconds':
        'Não está no código: limite da chamada por decidir (o ElevenLabs tem o seu por omissão).',
      'platform_settings.overrides.conversation_config_override.tts':
        'Só para ELEVENLABS_SOBREPOR_VOZ=true: o webhook de início manda voice_id e speed do painel.',
      'platform_settings.workspace_overrides.conversation_initiation_client_data_webhook':
        'Webhook de início (retomar a conversa). Só corre nas chamadas por telefone (Twilio/SIP); autentica com o mesmo segredo das ferramentas.',
      'platform_settings.workspace_overrides.webhooks.post_call_webhook_id':
        'O webhook do fim da chamada é do workspace: criar em Settings › Webhooks com o URL ${API_URL}/v1/webhooks/elevenlabs/conversa-terminada, copiar o segredo HMAC para ELEVENLABS_WEBHOOK_SECRET e pôr aqui o id. null: fica o que estiver no ElevenLabs.',
      'platform_settings.data_collection': `Campo ${CAMPO_CONSENTIMENTO} lido no fim da chamada (conversas/elevenlabs.ts).`,
      'platform_settings.call_limits':
        'Não está no código (concorrência e limite diário por decidir).',
    },
    municipio: m.slug,
    agente,
    elevenlabs_agent_id: saida
      ? m.elevenlabs_agent_id_saida
      : m.elevenlabs_agent_id,
    conversation_config: {
      agent: {
        first_message: primeiraMensagem(m, agente),
        language: 'pt',
        prompt: { timezone: m.fuso },
        dynamic_variables: {
          dynamic_variable_placeholders: variaveisDinamicas(m.slug),
        },
      },
      tts: {
        voice_id: m.voz_id,
        speed: velocidade,
        model_id: null,
      },
      conversation: {
        client_events: [
          'conversation_initiation_metadata',
          'audio',
          'interruption',
          'user_transcript',
          'agent_response',
          'agent_response_correction',
          'agent_tool_request',
          'agent_tool_response',
          'agent_tool_response_full_payload',
        ],
        max_duration_seconds: null,
      },
    },
    platform_settings: {
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: {
          tts: { voice_id: true, speed: true },
        },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${MARCADOR_API_URL}/v1/webhooks/elevenlabs/inicio-chamada`,
          request_headers: { 'X-Agente-Segredo': segredo },
        },
        webhooks: {
          post_call_webhook_id: null,
          events: ['transcript', 'audio', 'call_initiation_failure'],
          send_audio: true,
        },
      },
      data_collection: {
        [CAMPO_CONSENTIMENTO]: {
          type: 'boolean',
          description:
            'true só se a pessoa aceitou explicitamente que a chamada fosse gravada (ou continuou depois do aviso sem recusar); false se recusou.',
        },
      },
      call_limits: null,
    },
  };
}

// ---------------------------------------------------------------------
// Marcadores
// ---------------------------------------------------------------------

export interface Resolucao {
  apiUrl: string;
  municipio: string;
  /** nome do segredo → id no ElevenLabs */
  segredos: Map<string, string>;
}

/** Troca os marcadores e tira os null e as chaves `_…`. Lança se faltar um segredo. */
export function resolver<T>(valor: T, r: Resolucao): T {
  const troca = (s: string): string => {
    const seg = s.match(/^\$\{SEGREDO:([^}]+)\}$/);
    if (seg) {
      const id = r.segredos.get(seg[1]);
      if (!id) {
        throw new Error(
          `Falta o segredo "${seg[1]}" no ElevenLabs (Agents › Secrets) com o valor do AGENTE_SEGREDO. Ver code/api/agente-voz/README.md.`,
        );
      }
      return id;
    }
    return s
      .split(MARCADOR_API_URL)
      .join(r.apiUrl.replace(/\/$/, ''))
      .split(MARCADOR_MUNICIPIO)
      .join(r.municipio);
  };
  const andar = (v: unknown): unknown => {
    if (typeof v === 'string') return troca(v);
    if (Array.isArray(v)) return v.map(andar);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith('_') || x === null || x === undefined) continue;
        const y = andar(x);
        // Um objeto que ficou vazio (só tinha null) não vai.
        if (
          y &&
          typeof y === 'object' &&
          !Array.isArray(y) &&
          Object.keys(y).length === 0 &&
          Object.keys(x as object).length > 0
        ) {
          continue;
        }
        out[k] = y;
      }
      return out;
    }
    return v;
  };
  return andar(valor) as T;
}

/** Nomes de segredos referidos (para os ir buscar antes de resolver). */
export function segredosReferidos(valor: unknown): string[] {
  const nomes = new Set<string>();
  const andar = (v: unknown) => {
    if (typeof v === 'string') {
      const m = v.match(/^\$\{SEGREDO:([^}]+)\}$/);
      if (m) nomes.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(andar);
    else if (v && typeof v === 'object') Object.values(v).forEach(andar);
  };
  andar(valor);
  return [...nomes];
}
