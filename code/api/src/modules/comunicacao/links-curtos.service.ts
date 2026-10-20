import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService, Tx } from '../../database/database.service.js';

export type DestinoLink =
  | 'resumo'
  | 'requerimento'
  | 'ocorrencia'
  | 'processo'
  | 'marcacao'
  | 'pagamento'
  | 'aviso';

// Sem 0/O, 1/I/L: lê-se num SMS e dita-se ao telefone.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Validade por defeito (secção 8 do plano). */
const VALIDADE_DIAS: Record<DestinoLink, number> = {
  resumo: 30,
  requerimento: 30,
  ocorrencia: 90,
  processo: 365,
  marcacao: 60,
  pagamento: 30,
  aviso: 90,
};

/*
 * Os objetos com `token_publico` (requerimentos, ocorrências, marcações) são
 * abertos pelo token; os outros (resumo da conversa, processo, pagamento)
 * pelo próprio código do link.
 */
const TOKEN: Partial<Record<DestinoLink, string>> = {
  requerimento: 'requerimentos',
  ocorrencia: 'ocorrencias',
  marcacao: 'marcacoes',
};

export interface LinkCurto {
  codigo: string;
  url: string;
}

/**
 * Links curtos dos SMS: toucamara.pt/r/8K2F9Q. Sem dados pessoais na URL;
 * `GET /r/{codigo}` conta a abertura e redireciona para a página da web:
 * `${WEB_URL}/{destino}/{token}`.
 */
@Injectable()
export class LinksCurtosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  async criar(
    municipioId: string,
    destino: DestinoLink,
    destinoId: string,
    opcoes: { validadeDias?: number; ate?: Date; tx?: Tx } = {},
  ): Promise<LinkCurto> {
    const expira =
      opcoes.ate ??
      new Date(
        Date.now() +
          (opcoes.validadeDias ?? VALIDADE_DIAS[destino]) * 86_400_000,
      );
    const q = opcoes.tx ?? this.db;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = Array.from(
        { length: 6 },
        () => ALFABETO[randomInt(ALFABETO.length)],
      ).join('');
      const [r] = await q.query<{ codigo: string }>(
        `INSERT INTO links_curtos (codigo, municipio_id, destino_tipo, destino_id, expira_em)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (codigo) DO NOTHING RETURNING codigo`,
        [codigo, municipioId, destino, destinoId, expira],
      );
      if (r) return { codigo, url: `${this.webUrl()}/r/${codigo}` };
    }
    throw new Error('Não foi possível gerar um código de link livre.');
  }

  /**
   * Para as páginas abertas pelo código do link (resumo, processo,
   * pagamento): o id do objeto, se o link for deste tipo e estiver válido.
   */
  async resolver(
    codigo: string,
    destino: DestinoLink,
  ): Promise<{ destinoId: string; municipioId: string }> {
    const [l] = await this.db.query<{
      destino_id: string;
      municipio_id: string;
    }>(
      `SELECT destino_id, municipio_id FROM links_curtos
       WHERE codigo = $1 AND destino_tipo = $2 AND expira_em > now()`,
      [codigo.toUpperCase(), destino],
    );
    if (!l) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'link_invalido',
        'Este link não existe ou já expirou.',
      );
    }
    return { destinoId: l.destino_id, municipioId: l.municipio_id };
  }

  /** Conta a abertura e devolve para onde redirecionar. */
  async abrir(codigo: string): Promise<string> {
    const [l] = await this.db.query<{
      destino_tipo: DestinoLink;
      destino_id: string;
      valido: boolean;
    }>(
      `UPDATE links_curtos
       SET aberturas = aberturas + 1,
           primeira_abertura_em = coalesce(primeira_abertura_em, now())
       WHERE codigo = $1
       RETURNING destino_tipo, destino_id, expira_em > now() AS valido`,
      [codigo.toUpperCase()],
    );
    if (!l || !l.valido) return `${this.webUrl()}/expirado`;
    const tabela = TOKEN[l.destino_tipo];
    let token = codigo.toUpperCase();
    if (tabela) {
      const [o] = await this.db.query<{ token_publico: string }>(
        `SELECT token_publico FROM ${tabela} WHERE id = $1`,
        [l.destino_id],
      );
      if (!o) return `${this.webUrl()}/expirado`;
      token = o.token_publico;
    }
    return `${this.webUrl()}/${l.destino_tipo}/${token}`;
  }
}
