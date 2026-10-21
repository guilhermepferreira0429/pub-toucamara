import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LimitePedidos } from '../chat/limite.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import {
  mascararTelefone,
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { TITULOS } from './ferramentas-ia.js';

const VALIDADE_CODIGO_MIN = 10;
const MAX_TENTATIVAS = 5;
/** `tc_` + 32 caracteres base64url (24 bytes). */
const FORMATO_CHAVE = /^tc_[A-Za-z0-9_-]{32}$/;

export const esquemaPedirCodigo = z.object({
  municipio: z.string().trim().min(1).max(64),
  telefone: z.string().trim().min(6).max(25),
  assistente: z.string().trim().min(1).max(60).default('Assistente de IA'),
});

export const esquemaConfirmar = z.object({
  pedido: z.uuid('Pedido inválido.'),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código de 6 dígitos.'),
});

export const esquemaChave = z.object({
  chave: z.string().trim().regex(FORMATO_CHAVE, 'Chave inválida.'),
});

/** A ligação de um pedido MCP com chave. */
export interface LigacaoIa {
  id: string;
  municipioId: string;
  municipeId: string;
  telefone: string | null;
  assistente: string;
}

/**
 * Ligações dos assistentes de IA das pessoas à câmara: autorização por SMS,
 * chave pessoal (só o hash fica na BD), registo de cada ferramenta chamada e
 * o lado do painel (quem está ligado, o que pediram, revogar).
 */
@Injectable()
export class PortaIasService {
  // 3 códigos / 10 min por IP e 5 / hora por número; 120 pedidos MCP / min por chave ou IP.
  private readonly limiteIp = new LimitePedidos(3, 10 * 60_000);
  private readonly limiteNumero = new LimitePedidos(5, 60 * 60_000);
  readonly limiteMcp = new LimitePedidos(120, 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Autorização pelo munícipe (página /ia)
  // ------------------------------------------------------------------

  async pedirCodigo(
    dados: z.output<typeof esquemaPedirCodigo>,
    ip: string | undefined,
  ) {
    const municipio = await this.municipios.porSlug(dados.municipio);
    const telefone = normalizarTelefone(dados.telefone);
    if (!telefone) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Número de telemóvel inválido.',
      );
    }
    if (
      (ip && !this.limiteIp.permitir(ip)) ||
      !this.limiteNumero.permitir(telefone)
    ) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        'Já pediu vários códigos. Tente daqui a pouco.',
      );
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ligacao_ia_codigos
           (id, municipio_id, telefone_e164, assistente, codigo_hash, expira_em)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          municipio.id,
          telefone,
          dados.assistente,
          this.hash(`codigo:${id}:${codigo}`),
          expiraEm,
        ],
      );
      await this.mensagens.sms(
        {
          municipioId: municipio.id,
          destino: telefone,
          motivo: 'identificacao',
          corpo: `${municipio.nome}: o código para ligar o seu assistente (${dados.assistente}) à câmara é ${codigo}. Válido ${VALIDADE_CODIGO_MIN} minutos. Se não foi você, ignore.`,
          chave: `ia_codigo:${id}`,
        },
        tx,
      );
    });
    return {
      pedido: id,
      telefone: mascararTelefone(telefone),
      expira_em: expiraEm.toISOString(),
    };
  }

  /** Confere o código e cria a ligação. A chave só sai aqui, uma vez. */
  async confirmar(dados: z.output<typeof esquemaConfirmar>) {
    const r = await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{
        id: string;
        municipio_id: string;
        telefone_e164: string;
        assistente: string;
        codigo_hash: Buffer;
        tentativas: number;
      }>(
        `SELECT id, municipio_id, telefone_e164, assistente, codigo_hash, tentativas
         FROM ligacao_ia_codigos
         WHERE id = $1 AND usado_em IS NULL AND expira_em > now()
         FOR UPDATE`,
        [dados.pedido],
      );
      if (!c) return { estado: 'sem_codigo' as const };
      if (c.tentativas >= MAX_TENTATIVAS)
        return { estado: 'esgotado' as const };
      const certo = timingSafeEqual(
        c.codigo_hash,
        this.hash(`codigo:${c.id}:${dados.codigo}`),
      );
      if (!certo) {
        await tx.query(
          'UPDATE ligacao_ia_codigos SET tentativas = tentativas + 1 WHERE id = $1',
          [c.id],
        );
        return {
          estado: 'errado' as const,
          restantes: MAX_TENTATIVAS - c.tentativas - 1,
        };
      }
      const municipe = await this.municipes.porTelefone(
        c.municipio_id,
        c.telefone_e164,
        tx,
      );
      if (!municipe) return { estado: 'sem_codigo' as const };
      const chave = `tc_${randomBytes(24).toString('base64url')}`;
      const [l] = await tx.query<{ id: string }>(
        `INSERT INTO ligacoes_ia (municipio_id, municipe_id, assistente, chave_hash, chave_fim)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          c.municipio_id,
          municipe.id,
          c.assistente,
          this.hash(`chave:${chave}`),
          chave.slice(-4),
        ],
      );
      await tx.query(
        'UPDATE ligacao_ia_codigos SET usado_em = now(), ligacao_id = $2 WHERE id = $1',
        [c.id, l.id],
      );
      const municipio = await this.municipios.porId(c.municipio_id);
      await this.mensagens.sms(
        {
          municipioId: c.municipio_id,
          municipeId: municipe.id,
          destino: c.telefone_e164,
          motivo: 'identificacao',
          corpo: `${municipio.nome}: o assistente ${c.assistente} ficou ligado à câmara em seu nome. Pode desligá-lo a qualquer momento no site, em Ligar a minha IA.`,
          chave: `ia_ligada:${l.id}`,
        },
        tx,
      );
      await this.auditoria.registar(
        {
          municipioId: c.municipio_id,
          atorTipo: 'municipe',
          atorId: municipe.id,
          acao: 'ligou_assistente_ia',
          objetoTipo: 'ligacao_ia',
          objetoId: l.id,
          dados: { assistente: c.assistente },
        },
        tx,
      );
      return {
        estado: 'ok' as const,
        ligacao: l.id,
        chave,
        assistente: c.assistente,
        municipio,
      };
    });

    if (r.estado === 'sem_codigo') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_expirado',
        'Não há código válido. Peça um novo.',
      );
    }
    if (r.estado === 'esgotado') {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiadas_tentativas',
        'Código errado demasiadas vezes. Peça um novo.',
      );
    }
    if (r.estado === 'errado') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_errado',
        'Código errado.',
        { tentativas_restantes: r.restantes },
      );
    }
    return {
      ligacao_id: r.ligacao,
      assistente: r.assistente,
      chave: r.chave,
      // Relativo à API: a web junta o endereço público.
      caminho_mcp: `/v1/mcp/${r.municipio.slug}/${r.chave}`,
    };
  }

  /** O munícipe desliga com a própria chave. */
  async desligarPelaChave(chave: string) {
    const l = await this.porChave(chave, false);
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ligacao_desconhecida',
        'Esta chave não está ligada.',
      );
    }
    await this.revogar(l.id, l.municipioId, 'municipe', l.municipeId);
    return { desligada: true };
  }

  // ------------------------------------------------------------------
  // Pedidos MCP
  // ------------------------------------------------------------------

  /** A ligação ativa desta chave, ou null. Não conta como uso. */
  async porChave(chave: string, exigirAtiva = true): Promise<LigacaoIa | null> {
    if (!FORMATO_CHAVE.test(chave)) return null;
    const [l] = await this.db.query<{
      id: string;
      municipio_id: string;
      municipe_id: string;
      telefone_e164: string | null;
      assistente: string;
      revogada_em: Date | null;
    }>(
      `SELECT l.id, l.municipio_id, l.municipe_id, m.telefone_e164, l.assistente, l.revogada_em
       FROM ligacoes_ia l JOIN municipes m ON m.id = l.municipe_id
       WHERE l.chave_hash = $1`,
      [this.hash(`chave:${chave}`)],
    );
    if (!l || (exigirAtiva && l.revogada_em)) return null;
    return {
      id: l.id,
      municipioId: l.municipio_id,
      municipeId: l.municipe_id,
      telefone: l.telefone_e164,
      assistente: l.assistente,
    };
  }

  async registarPedido(p: {
    municipioId: string;
    ligacaoId: string | null;
    conversaId: string | null;
    cliente: string | null;
    ferramenta: string;
    ok: boolean;
    erroCodigo?: string | null;
    resumo: string;
    duracaoMs: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ligacao_ia_pedidos
         (municipio_id, ligacao_id, conversa_id, cliente, ferramenta, ok, erro_codigo, resumo, duracao_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        p.municipioId,
        p.ligacaoId,
        p.conversaId,
        p.cliente?.slice(0, 80) ?? null,
        p.ferramenta,
        p.ok,
        p.erroCodigo ?? null,
        p.resumo.slice(0, 300),
        Math.max(0, Math.round(p.duracaoMs)),
      ],
    );
    if (p.ligacaoId) {
      await this.db.query(
        `UPDATE ligacoes_ia SET pedidos = pedidos + 1, ultimo_uso_em = now() WHERE id = $1`,
        [p.ligacaoId],
      );
    }
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async resumo(m: Municipio) {
    const [t] = await this.db.query<{
      ativas: number;
      pedidos_hoje: number;
      pedidos_7d: number;
      acoes_7d: number;
      publicos_7d: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM ligacoes_ia WHERE municipio_id = $1 AND revogada_em IS NULL) AS ativas,
         count(*) FILTER (WHERE criado_em >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)::int AS pedidos_hoje,
         count(*)::int AS pedidos_7d,
         count(*) FILTER (WHERE ferramenta = ANY($3::text[]) AND ok)::int AS acoes_7d,
         count(*) FILTER (WHERE ligacao_id IS NULL)::int AS publicos_7d
       FROM ligacao_ia_pedidos
       WHERE municipio_id = $1 AND criado_em > now() - interval '7 days'`,
      [m.id, m.fuso, ACOES],
    );
    const porFerramenta = await this.db.query<{
      ferramenta: string;
      pedidos: number;
    }>(
      `SELECT ferramenta, count(*)::int AS pedidos FROM ligacao_ia_pedidos
       WHERE municipio_id = $1 AND criado_em > now() - interval '7 days'
       GROUP BY ferramenta ORDER BY pedidos DESC, ferramenta LIMIT 8`,
      [m.id],
    );
    const porCliente = await this.db.query<{
      cliente: string;
      pedidos: number;
    }>(
      `SELECT coalesce(cliente, 'desconhecido') AS cliente, count(*)::int AS pedidos
       FROM ligacao_ia_pedidos
       WHERE municipio_id = $1 AND criado_em > now() - interval '7 days'
       GROUP BY 1 ORDER BY pedidos DESC LIMIT 6`,
      [m.id],
    );
    return {
      ligacoes_ativas: t.ativas,
      pedidos_hoje: t.pedidos_hoje,
      pedidos_7d: t.pedidos_7d,
      acoes_7d: t.acoes_7d,
      publicos_7d: t.publicos_7d,
      por_ferramenta: porFerramenta.map((f) => ({
        ...f,
        titulo: TITULOS[f.ferramenta] ?? f.ferramenta,
      })),
      por_cliente: porCliente,
      caminho_publico: `/v1/mcp/${m.slug}`,
    };
  }

  /** O feed: os pedidos mais recentes (o painel volta a pedir a cada poucos segundos). */
  async atividade(m: Municipio, desde?: string) {
    const linhas = await this.db.query<{
      id: string;
      criado_em: Date;
      ferramenta: string;
      ok: boolean;
      erro_codigo: string | null;
      resumo: string | null;
      cliente: string | null;
      conversa_id: string | null;
      duracao_ms: number;
      ligacao_id: string | null;
      assistente: string | null;
      telefone_e164: string | null;
    }>(
      `SELECT p.id, p.criado_em, p.ferramenta, p.ok, p.erro_codigo, p.resumo, p.cliente,
              p.conversa_id, p.duracao_ms, p.ligacao_id, l.assistente, mu.telefone_e164
       FROM ligacao_ia_pedidos p
       LEFT JOIN ligacoes_ia l ON l.id = p.ligacao_id
       LEFT JOIN municipes mu ON mu.id = l.municipe_id
       WHERE p.municipio_id = $1 AND ($2::timestamptz IS NULL OR p.criado_em > $2)
       ORDER BY p.criado_em DESC, p.id DESC LIMIT 50`,
      [m.id, desde ?? null],
    );
    return {
      pedidos: linhas.map((l) => ({
        id: l.id,
        criado_em: l.criado_em.toISOString(),
        ferramenta: l.ferramenta,
        titulo: TITULOS[l.ferramenta] ?? l.ferramenta,
        acao: ACOES.includes(l.ferramenta),
        ok: l.ok,
        erro_codigo: l.erro_codigo,
        resumo: l.resumo,
        cliente: l.cliente,
        conversa_id: l.conversa_id,
        duracao_ms: l.duracao_ms,
        ligacao: l.ligacao_id
          ? {
              id: l.ligacao_id,
              assistente: l.assistente,
              telefone: mascararTelefone(l.telefone_e164),
            }
          : null,
      })),
    };
  }

  async ligacoes(m: Municipio) {
    const linhas = await this.db.query<{
      id: string;
      assistente: string;
      chave_fim: string;
      pedidos: number;
      ultimo_uso_em: Date | null;
      criada_em: Date;
      revogada_em: Date | null;
      revogada_por: string | null;
      telefone_e164: string | null;
      nome: string | null;
    }>(
      `SELECT l.id, l.assistente, l.chave_fim, l.pedidos, l.ultimo_uso_em, l.criada_em,
              l.revogada_em, l.revogada_por, mu.telefone_e164, mu.nome
       FROM ligacoes_ia l JOIN municipes mu ON mu.id = l.municipe_id
       WHERE l.municipio_id = $1
       ORDER BY (l.revogada_em IS NULL) DESC, coalesce(l.ultimo_uso_em, l.criada_em) DESC
       LIMIT 100`,
      [m.id],
    );
    return {
      ligacoes: linhas.map((l) => ({
        id: l.id,
        assistente: l.assistente,
        chave_fim: l.chave_fim,
        pedidos: l.pedidos,
        ultimo_uso_em: l.ultimo_uso_em?.toISOString() ?? null,
        criada_em: l.criada_em.toISOString(),
        ativa: !l.revogada_em,
        revogada_em: l.revogada_em?.toISOString() ?? null,
        revogada_por: l.revogada_por,
        municipe: { nome: l.nome, telefone: mascararTelefone(l.telefone_e164) },
      })),
    };
  }

  async revogarPelaCamara(m: Municipio, utilizadorId: string, id: string) {
    const [l] = await this.db.query<{ id: string }>(
      'SELECT id FROM ligacoes_ia WHERE id = $1 AND municipio_id = $2',
      [id, m.id],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ligacao_desconhecida',
        'Esta ligação não existe.',
      );
    }
    await this.revogar(id, m.id, 'camara', utilizadorId);
    return { revogada: true };
  }

  // ------------------------------------------------------------------

  private async revogar(
    id: string,
    municipioId: string,
    por: 'municipe' | 'camara',
    atorId: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE ligacoes_ia SET revogada_em = coalesce(revogada_em, now()),
                revogada_por = coalesce(revogada_por, $2)
         WHERE id = $1`,
        [id, por],
      );
      await this.auditoria.registar(
        {
          municipioId,
          atorTipo: por === 'camara' ? 'utilizador' : 'municipe',
          atorId,
          acao: 'desligou_assistente_ia',
          objetoTipo: 'ligacao_ia',
          objetoId: id,
        },
        tx,
      );
    });
  }

  private hash(texto: string): Buffer {
    const segredo =
      this.config.get<string>('app.dadosChave') || 'dev-porta-ias';
    return createHmac('sha256', segredo).update(texto).digest();
  }
}

/** As ferramentas que mudam alguma coisa (contam como "ações" no painel). */
const ACOES = [
  'registar_ocorrencia',
  'marcar',
  'cancelar_marcacao',
  'agendar_recolha',
  'criar_pagamento',
  'iniciar_requerimento',
  'preencher_campo',
  'concluir_requerimento',
  'passar_a_humano',
  'nao_quero_avisos',
];
