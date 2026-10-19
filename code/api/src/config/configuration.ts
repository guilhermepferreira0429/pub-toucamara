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
