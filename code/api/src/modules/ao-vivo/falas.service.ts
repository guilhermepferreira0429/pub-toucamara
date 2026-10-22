import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DatabaseService, Tx } from '../../database/database.service.js';
import { Quem, textoPublicoSeguro, TipoEventoPublico } from './regras.js';

export interface MensagemSse {
  type?: string;
  data: unknown;
}

export interface Fala {
  seq: number;
  quem: Quem;
  texto: string;
  ferramenta: string | null;
  dados: Record<string, unknown>;
  em: string;
}

const ESPERA_MS = 700;
const PING_MS = 15_000;
const DURACAO_MS = 60 * 60_000;

/**
 * SSE por sondagem leve (o mesmo mecanismo do requerimento ao vivo,
 * `painel/requerimentos/:id/ao-vivo`): a cada 700 ms o `passo` diz o que há
 * de novo; um ping a cada 15 s mantém o proxy acordado; acaba quando o passo
 * diz `fim` ou ao fim de uma hora. Funciona com várias instâncias da API,
 * porque tudo passa pela BD.
 */
export function sondar(
  passo: () => Promise<{ eventos: MensagemSse[]; fim?: boolean }>,
  opcoes: { esperaMs?: number; duracaoMs?: number } = {},
): Observable<MensagemSse> {
  return new Observable<MensagemSse>((sub) => {
    let parado = false;
    let timer: NodeJS.Timeout | undefined;
    let ultimoEnvio = Date.now();
    const fim = Date.now() + (opcoes.duracaoMs ?? DURACAO_MS);
    const correr = async () => {
      try {
        const r = await passo();
        if (parado) return;
        for (const e of r.eventos) sub.next(e);
        if (r.eventos.length) ultimoEnvio = Date.now();
        else if (Date.now() - ultimoEnvio > PING_MS) {
          sub.next({ type: 'ping', data: { em: new Date().toISOString() } });
          ultimoEnvio = Date.now();
        }
        if (r.fim || Date.now() > fim) return sub.complete();
        timer = setTimeout(() => void correr(), opcoes.esperaMs ?? ESPERA_MS);
      } catch (e) {
        if (!parado) sub.error(e);
      }
    };
    void correr();
    return () => {
      parado = true;
      clearTimeout(timer);
    };
  });
}

/** As falas em direto e os eventos públicos: o que os outros serviços partilham. */
@Injectable()
export class FalasAoVivoService {
  private readonly logger = new Logger(FalasAoVivoService.name);

  constructor(private readonly db: DatabaseService) {}

  async inserir(
    f: {
      municipioId: string;
      conversaId: string;
      quem: Quem;
      texto: string;
      ferramenta?: string | null;
      dados?: Record<string, unknown>;
      autorId?: string | null;
      em?: Date | null;
    },
    tx?: Tx,
  ): Promise<number> {
    const [r] = await (tx ?? this.db).query<{ seq: string }>(
      `INSERT INTO conversa_falas_ao_vivo
         (municipio_id, conversa_id, quem, texto, ferramenta, dados, autor_id, em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))
       RETURNING seq`,
      [
        f.municipioId,
        f.conversaId,
        f.quem,
        f.texto.slice(0, 2000),
        f.ferramenta ?? null,
        JSON.stringify(f.dados ?? {}),
        f.autorId ?? null,
        f.em ?? null,
      ],
    );
    return Number(r.seq);
  }

  /** As falas da conversa depois de `seq` (opcionalmente só de quem). */
  async desde(
    conversaId: string,
    seq: number,
    quem: Quem[] | null = null,
    limite = 200,
  ): Promise<Fala[]> {
    const linhas = await this.db.query<Fala & { seq: string; em: Date }>(
      `SELECT seq, quem, texto, ferramenta, dados, em FROM conversa_falas_ao_vivo
       WHERE conversa_id = $1 AND seq > $2 AND ($3::text[] IS NULL OR quem = ANY ($3))
       ORDER BY seq LIMIT $4`,
      [conversaId, seq, quem, limite],
    );
    return linhas.map((l) => ({
      ...l,
      seq: Number(l.seq),
      em: new Date(l.em).toISOString(),
    }));
  }

  async ultimaSeq(conversaId: string): Promise<number> {
    const [r] = await this.db.query<{ s: string | null }>(
      `SELECT max(seq) AS s FROM conversa_falas_ao_vivo WHERE conversa_id = $1`,
      [conversaId],
    );
    return Number(r?.s ?? 0);
  }

  /**
   * Evento do slide "Ao vivo" do pitch. Só textos fixos (ou a rua sem
   * número); o último filtro recusa o que pareça um dado pessoal.
   */
  async publicar(
    municipioId: string,
    tipo: TipoEventoPublico,
    texto: string,
    tx?: Tx,
  ): Promise<void> {
    const seguro = textoPublicoSeguro(texto);
    if (!seguro) {
      this.logger.warn(
        `Evento público recusado (${tipo}): parece ter dados pessoais.`,
      );
      return;
    }
    await (tx ?? this.db).query(
      `INSERT INTO ao_vivo_eventos (municipio_id, tipo, texto) VALUES ($1, $2, $3)`,
      [municipioId, tipo, seguro],
    );
  }
}
