import 'dotenv/config';
import path from 'node:path';

/** Toda a configuração do avaliador (ver .env.example). */
export const config = {
  bd: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '54330', 10),
    user: process.env.DB_USER || 'toucamara',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'toucamara',
    ssl: process.env.DB_SSL === 'true',
  },
  ia: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelo: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  },
  apiUrl: (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, ''),
  /** O mesmo AGENTE_SEGREDO da API: o chat não aplica o limite de sessões por IP. */
  agenteSegredo: process.env.AGENTE_SEGREDO || '',
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  pastaSaida: path.resolve(process.env.PASTA_SAIDA || './saida'),
};
