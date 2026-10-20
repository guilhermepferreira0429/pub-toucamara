import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';

export interface Municipe {
  id: string;
  municipio_id: string;
  telefone_e164: string | null;
  nome: string | null;
  email: string | null;
  idioma: string;
  tem_nif: boolean;
}

/** '+351 912 345 214', '912345214', '00351…' → '+351912345214'. Inválido → null. */
export function normalizarTelefone(
  tel: string | null | undefined,
): string | null {
  if (!tel) return null;
  const n = parsePhoneNumberFromString(tel.trim(), 'PT');
  return n?.isValid() ? n.number : null;
}

/**
 * O número da chamada: o principal (`system__caller_id`) se for válido; senão
 * o alternativo (a variável `telefone` que a página de chamada pelo browser
 * manda, porque aí o ElevenLabs não tem número). Normalizado, ou null.
 */
export function telefoneComAlternativa(
  principal: string | null | undefined,
  alternativo: string | null | undefined,
): string | null {
  return normalizarTelefone(principal) ?? normalizarTelefone(alternativo);
}

/** Para logs: '+351 9•• ••• 214'. */
export function mascararTelefone(tel: string | null | undefined): string {
  if (!tel) return '—';
  const d = tel.replace(/\D/g, '');
  return `+${d.slice(0, 3)} ${d.slice(3, 4)}•• ••• ${d.slice(-3)}`;
}

/** NIF português: 9 dígitos com dígito de controlo. */
export function nifValido(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const soma = [...nif.slice(0, 8)].reduce(
    (s, d, i) => s + Number(d) * (9 - i),
    0,
  );
  const controlo = 11 - (soma % 11);
  return Number(nif[8]) === (controlo >= 10 ? 0 : controlo);
}

const COLUNAS = `id, municipio_id, telefone_e164, nome, email, idioma,
  nif_hash IS NOT NULL AS tem_nif`;

/**
 * Munícipes: criados pelo número que liga, identificados depois pelo NIF.
 * O NIF vai cifrado (pgp_sym_encrypt) e com hash HMAC para procurar; nunca
 * em claro na BD nem em logs.
 */
@Injectable()
export class MunicipesService {
  private readonly logger = new Logger(MunicipesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private segredos(): { chave: string; pepper: string } {
    const chave = this.config.get<string>('app.dadosChave') ?? '';
    const pepper = this.config.get<string>('app.nifPepper') ?? '';
    if (chave && pepper) return { chave, pepper };
    if (this.config.get<string>('app.ambiente') === 'production') {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'cifra_sem_chave',
        'DADOS_CHAVE e NIF_PEPPER são obrigatórios em produção.',
      );
    }
    this.logger.warn('DADOS_CHAVE/NIF_PEPPER vazios: a usar chaves de dev.');
    return { chave: chave || 'dev-chave', pepper: pepper || 'dev-pepper' };
  }

  async porId(id: string): Promise<Municipe | null> {
    const [m] = await this.db.query<Municipe>(
      `SELECT ${COLUNAS} FROM municipes WHERE id = $1`,
      [id],
    );
    return m ?? null;
  }

  /** O munícipe deste número (cria se não existir). Número inválido → null. */
  async porTelefone(
    municipioId: string,
    telefone: string | null | undefined,
    tx?: Tx,
  ): Promise<Municipe | null> {
    const e164 = normalizarTelefone(telefone);
    if (!e164) return null;
    const q = tx ?? this.db;
    const [m] = await q.query<Municipe>(
      `INSERT INTO municipes (municipio_id, telefone_e164) VALUES ($1, $2)
       ON CONFLICT (municipio_id, telefone_e164) WHERE anonimizado_em IS NULL
       DO UPDATE SET telefone_e164 = EXCLUDED.telefone_e164
       RETURNING ${COLUNAS}`,
      [municipioId, e164],
    );
    return m;
  }

  /**
   * Munícipe novo sem telefone associado (chat sem número, ou um familiar a
   * ligar de um telefone que já é de outra pessoa).
   */
  async criar(
    municipioId: string,
    dados: { nif?: string; nome?: string; email?: string },
    tx?: Tx,
  ): Promise<Municipe> {
    const [novo] = await (tx ?? this.db).query<{ id: string }>(
      'INSERT INTO municipes (municipio_id) VALUES ($1) RETURNING id',
      [municipioId],
    );
    return this.atualizar(novo.id, dados, tx);
  }

  /** Procura pelo NIF (hash). */
  async porNif(municipioId: string, nif: string): Promise<Municipe | null> {
    const { pepper } = this.segredos();
    const [m] = await this.db.query<Municipe>(
      `SELECT ${COLUNAS} FROM municipes
       WHERE municipio_id = $1 AND nif_hash = hmac($2, $3, 'sha256')
         AND anonimizado_em IS NULL
       ORDER BY criado_em LIMIT 1`,
      [municipioId, nif, pepper],
    );
    return m ?? null;
  }

  /** Guarda nome, email, idioma e NIF (cifrado) do munícipe. */
  async atualizar(
    id: string,
    dados: { nome?: string; email?: string; idioma?: string; nif?: string },
    tx?: Tx,
  ): Promise<Municipe> {
    if (dados.nif !== undefined && !nifValido(dados.nif)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'nif_invalido',
        'NIF inválido.',
      );
    }
    const { chave, pepper } =
      dados.nif !== undefined ? this.segredos() : { chave: '', pepper: '' };
    const [m] = await (tx ?? this.db).query<Municipe>(
      `UPDATE municipes SET
         nome = coalesce($2, nome),
         email = coalesce($3, email),
         idioma = coalesce($4, idioma),
         nif_cifrado = CASE WHEN $5::text IS NULL THEN nif_cifrado ELSE pgp_sym_encrypt($5, $6) END,
         nif_hash = CASE WHEN $5::text IS NULL THEN nif_hash ELSE hmac($5, $7, 'sha256') END
       WHERE id = $1
       RETURNING ${COLUNAS}`,
      [
        id,
        dados.nome ?? null,
        dados.email ?? null,
        dados.idioma ?? null,
        dados.nif ?? null,
        chave,
        pepper,
      ],
    );
    if (!m) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'nao_encontrado',
        'Munícipe não existe.',
      );
    }
    return m;
  }

  /** O NIF em claro, só para gerar documentos (requerimento em PDF). */
  async nifEmClaro(id: string): Promise<string | null> {
    const { chave } = this.segredos();
    const [r] = await this.db.query<{ nif: string | null }>(
      `SELECT CASE WHEN nif_cifrado IS NULL THEN NULL
              ELSE pgp_sym_decrypt(nif_cifrado, $2) END AS nif
       FROM municipes WHERE id = $1`,
      [id, chave],
    );
    return r?.nif ?? null;
  }
}
