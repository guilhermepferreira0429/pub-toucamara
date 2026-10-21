import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  ambiente: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  // Origens do painel e do chat autorizadas a chamar a API (CORS).
  origensPermitidas: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Endereço público da web (links curtos dos SMS, páginas sem login).
  webUrl: (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Endereço público da API (callbacks do Twilio na junção do familiar).
  apiUrl: (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, ''),
  // GET /v1/docs em produção (fora de produção está sempre ligado).
  openapiPublico: process.env.OPENAPI_PUBLICO === 'true',
  // Chave da cifra do NIF (pgp_sym_encrypt) e pepper do hash para procurar.
  // Obrigatórias em produção. Perder a chave = perder os NIF guardados.
  dadosChave: process.env.DADOS_CHAVE || '',
  nifPepper: process.env.NIF_PEPPER || '',
}));

export const databaseConfig = registerAs('database', () => ({
  enabled: process.env.DB_ENABLED !== 'false',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '54330', 10),
  user: process.env.DB_USER || 'toucamara',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'toucamara',
  ssl: process.env.DB_SSL === 'true',
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
}));

export const agenteConfig = registerAs('agente', () => ({
  // Segredo que o ElevenLabs (e o chat) mandam no header X-Agente-Segredo
  // ao chamar /v1/agent/tools/*. Vazio: em dev deixa passar, em produção recusa.
  segredo: process.env.AGENTE_SEGREDO || '',
}));

export const iaConfig = registerAs('ia', () => ({
  // Sem chave, o que depende de IA fora da chamada (resumos, classificação) desliga-se.
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  modelo: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
}));

export const embeddingsConfig = registerAs('embeddings', () => ({
  // 'voyage' | 'ollama' | '' (vazio = só pesquisa por texto). Dimensão fixa: 1024.
  provider: process.env.EMBEDDINGS_PROVIDER || '',
  apiKey: process.env.EMBEDDINGS_API_KEY || '',
  modelo: process.env.EMBEDDINGS_MODEL || '',
  // Só para o ollama, ex.: http://localhost:11434
  url: (process.env.EMBEDDINGS_URL || '').replace(/\/$/, ''),
}));

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET || '',
  validadeHoras: parseInt(process.env.JWT_VALIDADE_HORAS || '12', 10),
}));

export const jobsConfig = registerAs('jobs', () => ({
  workers: process.env.JOBS_WORKERS !== 'false',
}));

export const comunicacaoConfig = registerAs('comunicacao', () => ({
  smsProvider: process.env.SMS_PROVIDER || '',
  smsRemetente: process.env.SMS_REMETENTE || 'TouCamara',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
  },
  // Por defeito sem acentos: GSM-7 leva 160 caracteres por parte, UCS-2 só 70.
  smsTransliterar: process.env.SMS_TRANSLITERAR !== 'false',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'Tou, Câmara? <nao-responder@toucamara.pt>',
  },
}));

export const armazenamentoConfig = registerAs('armazenamento', () => ({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'eu-west-1',
  bucket: process.env.S3_BUCKET || '',
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
}));

export const webhooksConfig = registerAs('webhooks', () => ({
  elevenlabsSegredo: process.env.ELEVENLABS_WEBHOOK_SECRET || '',
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  // Voz e ritmo do painel na chamada (conversation_config_override). Só com
  // os overrides de TTS autorizados no agente do ElevenLabs.
  elevenlabsSobreporVoz: process.env.ELEVENLABS_SOBREPOR_VOZ === 'true',
  pagamentosSegredo: process.env.PAGAMENTOS_WEBHOOK_SECRET || '',
}));
