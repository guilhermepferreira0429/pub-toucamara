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

const VALIDADE_CODIGO_MIN = 10;
const MAX_TENTATIVAS = 5;
/** `tca_` + 32 caracteres base64url (24 bytes). */
export const FORMATO_TOKEN_APP = /^tca_[A-Za-z0-9_-]{32}$/;
/** O último uso só se grava de 5 em 5 minutos (não escreve a cada pedido). */
const INTERVALO_ULTIMO_USO = '5 minutes';

const esquemaTelefone = z.string().trim().min(6).max(25);
const esquemaMunicipio = z.string().trim().min(1).max(64);

export const esquemaPedirCodigoApp = z.object({
  municipio: esquemaMunicipio,
  telefone: esquemaTelefone,
});

export const esquemaEntrarApp = z.object({
  municipio: esquemaMunicipio,
  telefone: esquemaTelefone,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código de 6 dígitos.'),
  /** O que a app disser do telemóvel ("Samsung Galaxy A52"), para a pessoa reconhecer a sessão. */
  dispositivo: z.string().trim().max(120).optional(),
});

/** A sessão da app de um pedido (posta pelo AppGuard). */
export interface SessaoApp {
  id: string;
  municipio: Municipio;
  municipeId: string;
  telefone: string | null;
}

/**
 * Entrar na app com o telemóvel: código por SMS (só o hash na BD, 10
 * minutos, 5 tentativas; 5 códigos por hora por número e 5 por 10 minutos
 * por IP) e uma sessão longa e revogável, ligada ao munícipe do número.
 * O token da sessão sai uma vez; na BD fica só o hash (como as chaves da
 * porta para as IAs).
 */
@Injectable()
export class AppSessaoService {
  private readonly limiteIp = new LimitePedidos(5, 10 * 60_000);
  private readonly limiteNumero = new LimitePedidos(5, 60 * 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async pedirCodigo(
    dados: z.output<typeof esquemaPedirCodigoApp>,
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
      !this.limiteNumero.permitir(`${municipio.id}:${telefone}`)
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
      // Só o último código vale.
      await tx.query(
        `UPDATE app_codigos SET expira_em = least(expira_em, now())
         WHERE municipio_id = $1 AND telefone_e164 = $2 AND usado_em IS NULL`,
        [municipio.id, telefone],
      );
      await tx.query(
        `INSERT INTO app_codigos (id, municipio_id, telefone_e164, codigo_hash, expira_em)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          municipio.id,
          telefone,
          this.hash(`codigo:${id}:${codigo}`),
          expiraEm,
        ],
      );
      await this.mensagens.sms(
        {
          municipioId: municipio.id,
          destino: telefone,
          motivo: 'identificacao',
          corpo: `${municipio.nome}: o seu código para entrar na app é ${codigo}. Válido ${VALIDADE_CODIGO_MIN} minutos. Não o partilhe com ninguém.`,
          chave: `app_codigo:${id}`,
        },
        tx,
      );
    });
    return {
      enviado: true,
      telefone: mascararTelefone(telefone),
      expira_em: expiraEm.toISOString(),
    };
  }

  /** Confere o código e cria a sessão. O token só sai aqui, uma vez. */
  async entrar(
    dados: z.output<typeof esquemaEntrarApp>,
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
    const r = await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{
        id: string;
        codigo_hash: Buffer;
        tentativas: number;
      }>(
        `SELECT id, codigo_hash, tentativas FROM app_codigos
         WHERE municipio_id = $1 AND telefone_e164 = $2
           AND usado_em IS NULL AND expira_em > now()
         ORDER BY criado_em DESC LIMIT 1
         FOR UPDATE`,
        [municipio.id, telefone],
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
          'UPDATE app_codigos SET tentativas = tentativas + 1 WHERE id = $1',
          [c.id],
        );
        return {
          estado: 'errado' as const,
          restantes: MAX_TENTATIVAS - c.tentativas - 1,
        };
      }
      await tx.query('UPDATE app_codigos SET usado_em = now() WHERE id = $1', [
        c.id,
      ]);
      const municipe = await this.municipes.porTelefone(
        municipio.id,
        telefone,
        tx,
      );
      if (!municipe) return { estado: 'sem_codigo' as const };
      const token = `tca_${randomBytes(24).toString('base64url')}`;
      const [s] = await tx.query<{ id: string }>(
        `INSERT INTO app_sessoes (municipio_id, municipe_id, token_hash, token_fim, dispositivo, ultimo_uso_em)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
        [
          municipio.id,
          municipe.id,
          this.hash(`sessao:${token}`),
          token.slice(-4),
          dados.dispositivo || null,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'municipe',
          atorId: municipe.id,
          acao: 'entrar_app',
          objetoTipo: 'sessao_app',
          objetoId: s.id,
          dados: { dispositivo: dados.dispositivo ?? null },
          ip,
        },
        tx,
      );
      return { estado: 'ok' as const, sessao: s.id, token, municipe };
    });

    // Os erros saem depois do COMMIT, para a tentativa falhada contar.
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
      token: r.token,
      sessao_id: r.sessao,
      municipe: {
        nome: r.municipe.nome,
        telefone: mascararTelefone(r.municipe.telefone_e164),
      },
      municipio: { slug: municipio.slug, nome: municipio.nome },
    };
  }

  /** A sessão ativa deste token, ou null. */
  async porToken(token: string): Promise<SessaoApp | null> {
    if (!FORMATO_TOKEN_APP.test(token)) return null;
    const [s] = await this.db.query<{
      id: string;
      municipio_id: string;
      municipe_id: string;
      telefone_e164: string | null;
    }>(
      `SELECT s.id, s.municipio_id, s.municipe_id, m.telefone_e164
       FROM app_sessoes s JOIN municipes m ON m.id = s.municipe_id
       WHERE s.token_hash = $1 AND s.revogada_em IS NULL
         AND m.anonimizado_em IS NULL`,
      [this.hash(`sessao:${token}`)],
    );
    if (!s) return null;
    await this.db.query(
      `UPDATE app_sessoes SET ultimo_uso_em = now()
       WHERE id = $1 AND (ultimo_uso_em IS NULL OR ultimo_uso_em < now() - interval '${INTERVALO_ULTIMO_USO}')`,
      [s.id],
    );
    return {
      id: s.id,
      municipio: await this.municipios.porId(s.municipio_id),
      municipeId: s.municipe_id,
      telefone: s.telefone_e164,
    };
  }

  /** Sair: revoga a sessão e desliga o push dos telemóveis dela. */
  async sair(s: SessaoApp, ip: string | undefined) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE app_sessoes SET revogada_em = coalesce(revogada_em, now()),
                revogada_por = coalesce(revogada_por, 'municipe')
         WHERE id = $1`,
        [s.id],
      );
      await tx.query(
        `UPDATE app_dispositivos SET ativo = false, desativado_em = now(),
                motivo_desativacao = 'sessao_terminada', atualizado_em = now()
         WHERE sessao_id = $1 AND ativo`,
        [s.id],
      );
      await this.auditoria.registar(
        {
          municipioId: s.municipio.id,
          atorTipo: 'municipe',
          atorId: s.municipeId,
          acao: 'sair_app',
          objetoTipo: 'sessao_app',
          objetoId: s.id,
          ip,
        },
        tx,
      );
    });
    return { saiu: true };
  }

  private hash(texto: string): Buffer {
    const segredo = this.config.get<string>('app.dadosChave') || 'dev-app';
    return createHmac('sha256', segredo).update(texto).digest();
  }
}
