import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SEGREDO_AGENTE, WEB_URL } from './ambiente';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/configurar-app';
import { GeocodificacaoService } from '../../src/modules/ocorrencias/geocodificacao';
import { MensagensService } from '../../src/modules/comunicacao/mensagens.service';

export const MUNICIPIO = 'teste';
export const MUNICIPIO_ID = '00000000-0000-0000-0000-000000000001';
export const CHEFE_ID = '00000000-0000-0000-0000-0000000000a9';
export const TIPO_CP_ID = '00000000-0000-0000-0000-0000000000b1';
export const FONTE_RJUE_ID = '00000000-0000-0000-0000-0000000000f1';

/**
 * Geocodificação sem rede: em vez do Nominatim, as coordenadas vêm deste
 * mapa (morada → lat/lng). Morada desconhecida = sem coordenadas, como
 * quando o Nominatim não responde.
 */
export class GeocodificacaoFalsa {
  readonly moradas = new Map<string, { lat: number; lng: number }>();
  readonly pedidos: string[] = [];

  geocodificar(morada: string): Promise<{ lat: number; lng: number } | null> {
    this.pedidos.push(morada);
    return Promise.resolve(this.moradas.get(morada) ?? null);
  }
}

export interface Contexto {
  app: INestApplication<App>;
  /** Ligação direta à BD de teste, para preparar dados e ver os efeitos. */
  db: Pool;
  http: () => ReturnType<typeof request>;
  geo: GeocodificacaoFalsa;
  fechar: () => Promise<void>;
}

/**
 * Arranca a app inteira (AppModule, como em produção) contra a BD desta
 * execução. Uma vez por ficheiro de teste: `beforeAll` + `afterAll(fechar)`.
 * As migrações correm no arranque (MigrationsService); o seed carrega-se na
 * primeira vez. Nada sai para a rede: a geocodificação é sempre a falsa.
 */
export async function arrancarApp(
  opcoes: {
    substituir?: (b: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<Contexto> {
  const geo = new GeocodificacaoFalsa();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GeocodificacaoService)
    .useValue(geo);
  if (opcoes.substituir) builder = opcoes.substituir(builder);
  const modulo = await builder.compile();
  const app = modulo.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: process.env.E2E_LOGS === '1' ? undefined : ['error'],
  });
  configurarApp(app);
  const db = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 3,
  });
  try {
    await app.init();
    await carregarSeed(db);
  } catch (e) {
    // Se o arranque falhar a meio, os jobs (pg-boss) já estão a correr e o
    // afterAll não tem app para fechar: o jest ficava pendurado para sempre.
    await app.close().catch(() => undefined);
    await db.end().catch(() => undefined);
    throw e;
  }

  const http = () => request(app.getHttpServer());
  return {
    app,
    db,
    http,
    geo,
    fechar: async () => {
      await app.close();
      await db.end();
    },
  };
}

async function carregarSeed(db: Pool): Promise<void> {
  const { rows } = await db.query('SELECT 1 FROM municipios WHERE slug = $1', [
    MUNICIPIO,
  ]);
  if (rows.length) return;
  await db.query(
    readFileSync(join(__dirname, 'fixtures', 'seed.sql'), 'utf-8'),
  );
}

/** Espera até `fn` devolver algo verdadeiro (poll à BD), sem sleeps fixos. */
export async function esperarAte<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  intervaloMs = 100,
): Promise<T> {
  const limite = Date.now() + timeoutMs;
  let ultimoErro: unknown;
  for (;;) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) {
      ultimoErro = e;
    }
    if (Date.now() > limite) {
      throw new Error(
        `esperarAte: ${timeoutMs} ms sem resultado${ultimoErro ? ` (${ultimoErro instanceof Error ? ultimoErro.message : JSON.stringify(ultimoErro)})` : ''}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

/** Uma linha (ou nenhuma) de uma query. */
export async function linha<T = any>(
  db: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

export async function linhas<T = any>(
  db: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

/* ------------------------------------------------------------------ */
/* Agente (ferramentas)                                                */
/* ------------------------------------------------------------------ */

/** Telemóvel português aleatório (E.164): um por teste, para não colidir. */
export function novoTelefone(): string {
  return `+35191${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

export function novaConversa(prefixo = 'conv'): string {
  return `${prefixo}-${randomUUID()}`;
}

/** Uma chamada simulada: a conversa e o telefone do ElevenLabs. */
export interface Chamada {
  conversa: string;
  telefone: string;
}

export function novaChamada(prefixo = 'conv'): Chamada {
  return { conversa: novaConversa(prefixo), telefone: novoTelefone() };
}

export function headersAgente(chamada?: Partial<Chamada>) {
  const h: Record<string, string> = {
    'X-Agente-Segredo': SEGREDO_AGENTE,
    'X-Municipio': MUNICIPIO,
  };
  if (chamada?.conversa) h['X-Conversa-Id'] = chamada.conversa;
  if (chamada?.telefone) h['X-Telefone'] = chamada.telefone;
  return h;
}

/** POST /v1/agent/tools/{nome} com os headers do ElevenLabs. */
export function ferramenta(
  ctx: Contexto,
  chamada: Chamada | undefined,
  nome: string,
  corpo: object = {},
) {
  return ctx
    .http()
    .post(`/v1/agent/tools/${nome}`)
    .set(headersAgente(chamada))
    .send(corpo);
}

/** `pedir_licenca` (a ferramenta que substituiu as pedir_licenca_<tipo>). */
export function pedirLicenca(
  ctx: Contexto,
  chamada: Chamada | undefined,
  tipo: string,
  dados: object,
) {
  return ferramenta(ctx, chamada, 'pedir_licenca', { tipo, dados });
}

/** Id interno da conversa a partir do id do ElevenLabs. */
export async function conversaId(
  ctx: Contexto,
  providerId: string,
): Promise<string> {
  const c = await linha<{ id: string }>(
    ctx.db,
    'SELECT id FROM conversas WHERE provider_id = $1',
    [providerId],
  );
  if (!c) throw new Error(`Conversa ${providerId} não existe.`);
  return c.id;
}

/* ------------------------------------------------------------------ */
/* Links curtos e SMS                                                  */
/* ------------------------------------------------------------------ */

/** O código de um link curto (`.../r/ABC234`). */
export function codigoDoLink(url: string): string {
  const m = /\/r\/([A-Z0-9]+)$/.exec(url);
  if (!m) throw new Error(`Não é um link curto: ${url}`);
  return m[1];
}

/** Segue `GET /r/:codigo` e devolve o destino e o token do fim da URL. */
export async function seguirLink(
  ctx: Contexto,
  url: string,
): Promise<{ destino: string; token: string; location: string }> {
  const r = await ctx
    .http()
    .get(`/r/${codigoDoLink(url)}`)
    .expect(302);
  const location = String(r.headers.location);
  const m = new RegExp(`^${WEB_URL}/([a-z_]+)/([^/]+)$`).exec(location);
  if (!m) throw new Error(`Redirecionamento inesperado: ${location}`);
  return { destino: m[1], token: m[2], location };
}

export interface Sms {
  id: string;
  destino: string;
  motivo: string;
  corpo: string;
  estado: string;
  relacionado: Record<string, string>;
}

/** SMS para um telefone (por ordem de criação), opcionalmente por motivo. */
export async function smsPara(
  ctx: Contexto,
  telefone: string,
  motivo?: string,
): Promise<Sms[]> {
  return linhas<Sms>(
    ctx.db,
    `SELECT id, destino, motivo::text, corpo, estado::text, relacionado
     FROM mensagens_saida
     WHERE destino = $1 AND ($2::text IS NULL OR motivo::text = $2)
     ORDER BY enviar_em, id`,
    [telefone, motivo ?? null],
  );
}

/** Espera que o worker do pg-boss envie o SMS (estado 'enviada'). */
export async function esperarSmsEnviado(
  ctx: Contexto,
  telefone: string,
  motivo: string,
): Promise<Sms> {
  return esperarAte(async () => {
    const lista = await smsPara(ctx, telefone, motivo);
    return lista.find((s) => s.estado === 'enviada');
  });
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

/** Cria um link mágico com um token conhecido (o hash é o que fica na BD). */
export async function criarLinkMagico(
  ctx: Contexto,
  utilizadorId: string,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await ctx.db.query(
    `INSERT INTO links_magicos (utilizador_id, token_hash, expira_em)
     VALUES ($1, $2, now() + interval '15 minutes')`,
    [utilizadorId, createHash('sha256').update(token).digest()],
  );
  return token;
}

/** Entra no painel com um link mágico; devolve os headers da sessão. */
export async function entrarPainel(
  ctx: Contexto,
  utilizadorId = CHEFE_ID,
): Promise<Record<string, string>> {
  const token = await criarLinkMagico(ctx, utilizadorId);
  const r = await ctx
    .http()
    .post('/v1/painel/auth/entrar')
    .send({ token })
    .expect(200);
  const sessao = r.body as { token: string };
  return { Authorization: `Bearer ${sessao.token}` };
}

/** Utilizador novo do município de teste, com o perfil pedido. */
export async function criarUtilizador(
  ctx: Contexto,
  perfil: string,
): Promise<string> {
  const id = randomUUID();
  await ctx.db.query(
    `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      MUNICIPIO_ID,
      `${perfil}-${id.slice(0, 8)}@teste.pt`,
      `Teste ${perfil}`,
      perfil,
    ],
  );
  return id;
}

export const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * As confirmações retidas numa chamada em curso (recolha, marcação) esperam
 * pelo SMS do fim. Aqui saem já, como quando a chamada acaba sem esse SMS.
 */
export async function soltarRetidas(
  ctx: Contexto,
  telefone: string,
): Promise<void> {
  const conversas = await linhas<{ id: string }>(
    ctx.db,
    `SELECT DISTINCT relacionado->>'conversa_id' AS id FROM mensagens_saida
     WHERE destino = $1 AND retida_fim_chamada AND estado = 'agendada'`,
    [telefone],
  );
  const mensagens = ctx.app.get(MensagensService);
  for (const c of conversas) await mensagens.fecharRetidas(c.id, false);
}
