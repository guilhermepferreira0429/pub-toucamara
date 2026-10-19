/*
 * Leitura do SSE do nosso chat (`POST /v1/chat/sessoes/:sessao/mensagens`).
 * O formato é o de `code/api/src/modules/chat/sse.ts`: blocos
 * `event: <nome>\ndata: <json>\n\n`, mais comentários `: vivo` a cada 15 s.
 * Puro e incremental: os pedaços da rede podem cortar um evento a meio.
 */

export interface EventoSse {
  evento: string;
  dados: unknown;
}

/** Parser incremental: dá-se-lhe texto à medida que chega, devolve os eventos completos. */
export class ParserSse {
  private resto = '';

  alimentar(pedaco: string): EventoSse[] {
    // Normalizar CRLF: o SSE aceita \r\n e \r como fim de linha.
    this.resto += pedaco.replace(/\r\n?/g, '\n');
    const eventos: EventoSse[] = [];
    let fim: number;
    while ((fim = this.resto.indexOf('\n\n')) !== -1) {
      const bloco = this.resto.slice(0, fim);
      this.resto = this.resto.slice(fim + 2);
      const e = lerBloco(bloco);
      if (e) eventos.push(e);
    }
    return eventos;
  }

  /** O que ficou por fechar quando a ligação acaba (um evento sem linha vazia final). */
  terminar(): EventoSse[] {
    const bloco = this.resto;
    this.resto = '';
    const e = bloco.trim() ? lerBloco(bloco) : null;
    return e ? [e] : [];
  }
}

function lerBloco(bloco: string): EventoSse | null {
  let evento = 'message';
  const dados: string[] = [];
  for (const linha of bloco.split('\n')) {
    if (!linha || linha.startsWith(':')) continue; // comentário (`: vivo`)
    const i = linha.indexOf(':');
    const campo = i === -1 ? linha : linha.slice(0, i);
    let valor = i === -1 ? '' : linha.slice(i + 1);
    if (valor.startsWith(' ')) valor = valor.slice(1);
    if (campo === 'event') evento = valor;
    else if (campo === 'data') dados.push(valor);
  }
  if (dados.length === 0) return null;
  const bruto = dados.join('\n');
  try {
    return { evento, dados: JSON.parse(bruto) };
  } catch {
    return { evento, dados: bruto };
  }
}

/** Lê um corpo de resposta (stream de bytes) evento a evento. */
export async function* lerSse(
  corpo: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<EventoSse> {
  const parser = new ParserSse();
  const dec = new TextDecoder();
  for await (const pedaco of corpo) {
    const texto =
      typeof pedaco === 'string'
        ? pedaco
        : dec.decode(pedaco, { stream: true });
    yield* parser.alimentar(texto);
  }
  yield* parser.alimentar(dec.decode());
  yield* parser.terminar();
}

export interface RespostaChat {
  texto: string;
  ferramentas: string[];
  fontes: { titulo: string; url: string }[];
  /** Evento `erro` do chat, se houve. */
  erro: { codigo: string; mensagem: string } | null;
  /** true se chegou o evento `fim`. */
  terminou: boolean;
  turnoId: string | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Acumulador dos eventos de um turno: texto, ferramentas e fontes (cartões `fonte`). */
export class AcumuladorChat {
  private readonly r: RespostaChat = {
    texto: '',
    ferramentas: [],
    fontes: [],
    erro: null,
    terminou: false,
    turnoId: null,
  };
  private readonly urls = new Set<string>();

  /** Devolve true quando o turno acabou (`fim` ou `erro`). */
  juntar(e: EventoSse): boolean {
    const d = obj(e.dados);
    switch (e.evento) {
      case 'texto':
        if (typeof d.texto === 'string') this.r.texto += d.texto;
        return false;
      case 'ferramenta':
        // Pela ordem em que correram; repetidas contam uma vez.
        if (typeof d.nome === 'string' && !this.r.ferramentas.includes(d.nome))
          this.r.ferramentas.push(d.nome);
        return false;
      case 'cartao':
        if (d.tipo === 'fonte' && Array.isArray(d.fontes)) {
          for (const f of d.fontes.map(obj)) {
            if (typeof f.titulo !== 'string' || typeof f.url !== 'string')
              continue;
            if (this.urls.has(f.url)) continue;
            this.urls.add(f.url);
            this.r.fontes.push({ titulo: f.titulo, url: f.url });
          }
        }
        return false;
      case 'fim':
        this.r.terminou = true;
        this.r.turnoId = typeof d.turno_id === 'string' ? d.turno_id : null;
        return true;
      case 'erro':
        this.r.erro = {
          codigo: typeof d.codigo === 'string' ? d.codigo : 'erro',
          mensagem:
            typeof d.mensagem === 'string' ? d.mensagem : String(e.dados),
        };
        return true;
      default:
        return false;
    }
  }

  get resultado(): RespostaChat {
    return { ...this.r, texto: this.r.texto.trim() };
  }
}

/** Atalho puro: junta uma lista de eventos já lidos. */
export function juntarEventos(eventos: EventoSse[]): RespostaChat {
  const a = new AcumuladorChat();
  for (const e of eventos) if (a.juntar(e)) break;
  return a.resultado;
}
