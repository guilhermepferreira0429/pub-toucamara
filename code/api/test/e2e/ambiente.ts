/*
 * Ambiente da app nos testes ponta a ponta (setupFiles: corre antes de cada
 * ficheiro de teste, antes de importar o AppModule).
 *
 * Todas as variáveis do `.env.example` ficam definidas aqui, mesmo as vazias:
 * o ConfigModule só usa o `.env` para as que faltam em process.env, por isso
 * nada do `.env` local (chaves de IA, S3, SMS...) entra nos testes.
 */

export const SEGREDO_AGENTE = 'segredo-e2e';
export const SEGREDO_ELEVENLABS = 'segredo-elevenlabs-e2e';
export const SEGREDO_PAGAMENTOS = 'segredo-pagamentos-e2e';
export const WEB_URL = 'http://web.e2e.local';
export const JURI_EMAIL = 'juri.e2e@toucamara.test';
export const JURI_CHAVE = 'chave-do-juri-e2e-0123456789';

const nomeBd = process.env.E2E_BD;
if (!nomeBd) {
  throw new Error(
    'Sem BD de teste: corre com `bun run test:e2e` (o globalSetup cria-a).',
  );
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '0',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  WEB_URL,
  API_URL: 'http://localhost:3001',
  OPENAPI_PUBLICO: 'false',
  DADOS_CHAVE: 'chave-dados-e2e',
  NIF_PEPPER: 'pepper-e2e',

  DB_ENABLED: 'true',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || '54330',
  DB_USER: process.env.DB_USER || 'toucamara',
  DB_PASSWORD: process.env.DB_PASSWORD || 'toucamara',
  DB_NAME: nomeBd,
  DB_SSL: 'false',
  DB_POOL_MAX: process.env.DB_POOL_MAX || '5',
  DB_RLS_PAINEL: process.env.DB_RLS_PAINEL || 'true',
  MIGRACOES_NO_ARRANQUE: 'true',

  AGENTE_SEGREDO: SEGREDO_AGENTE,
  // Sem IA: o que depende dela responde 503 ou segue sem ela.
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  EMBEDDINGS_PROVIDER: '',
  EMBEDDINGS_API_KEY: '',
  EMBEDDINGS_MODEL: '',
  EMBEDDINGS_URL: '',

  JWT_SECRET: 'jwt-secret-e2e-0123456789abcdef',
  JWT_VALIDADE_HORAS: '12',
  // Acesso do júri (só de leitura): ligado em todos os testes, só o usa o seu.
  JURI_EMAIL: JURI_EMAIL,
  JURI_CHAVE: JURI_CHAVE,
  JURI_ATE: '2099-12-31T23:59:59Z',
  JURI_MUNICIPIO: 'teste',
  JOBS_WORKERS: 'true',
  // Recolha das fontes: sem a pausa de 2 s entre pedidos ao mesmo site.
  RECOLHA_INTERVALO_MS: '0',

  // Sem fornecedor de SMS: fora de produção o SMS fica 'enviada' (provider 'log').
  SMS_PROVIDER: '',
  SMS_REMETENTE: 'TouCamara',
  WHATSAPP_REMETENTE: '+351930000999',
  SMS_TRANSLITERAR: 'false',
  SMTP_HOST: '',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: 'Tou, Câmara? <nao-responder@toucamara.pt>',

  // Sem S3: os uploads respondem 503.
  S3_ENDPOINT: '',
  S3_REGION: 'eu-west-1',
  S3_BUCKET: '',
  S3_ACCESS_KEY: '',
  S3_SECRET_KEY: '',

  ELEVENLABS_WEBHOOK_SECRET: SEGREDO_ELEVENLABS,
  ELEVENLABS_API_KEY: '',
  ELEVENLABS_SOBREPOR_VOZ: 'false',
  PAGAMENTOS_WEBHOOK_SECRET: SEGREDO_PAGAMENTOS,

  // Sem Firebase: o push da app fica em modo consola ('enviado_teste').
  FIREBASE_PROJECT_ID: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
});
