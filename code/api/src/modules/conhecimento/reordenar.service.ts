import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ClaudeService } from '../../ia/claude.service.js';
import type { Trecho } from './conhecimento.service.js';

/** Candidatos que vão ao modelo (os primeiros da pesquisa híbrida). */
export const CANDIDATOS_REORDENAR = 20;
/** Se o modelo demorar mais do que isto, fica a ordem da pesquisa. */
const TIMEOUT_MS = Number(process.env.CONHECIMENTO_REORDENAR_TIMEOUT_MS) || 8000;
/** Texto de cada candidato mostrado ao modelo. */
const MAX_TEXTO = 700;

const esquema = z.object({
  relevantes: z
    .array(z.string())
    .describe('Os códigos (T1, T2, …) dos trechos que ajudam a responder, do mais útil para o menos útil.'),
});

const SISTEMA = `Recebes a pergunta de um munícipe a uma câmara municipal portuguesa e uma lista de trechos de fontes oficiais (câmara, empresas municipais, leis), cada um com um código T1, T2, …

Escolhe os trechos que ajudam a responder à pergunta, mesmo que digam as coisas com outras palavras (a pessoa diz "rampa para a garagem", a fonte diz "rebaixamento de lancil"; a pessoa diz "furo no quintal", a fonte diz "captação de águas subterrâneas"). Ordena-os do mais útil para o menos útil. Deixa de fora listas de links, notícias e trechos que só partilham palavras soltas com a pergunta.

Devolve só os códigos. Se nenhum ajudar, devolve a lista vazia.`;

/**
 * Reordenação dos trechos pelo modelo (reranking): a pesquisa híbrida traz
 * os candidatos (palavras e significado), e o modelo, que percebe a pergunta
 * e o trecho juntos, escolhe e ordena os que respondem de facto. É o passo
 * que tira da frente as páginas de listas e as notícias que só partilham
 * palavras com a pergunta. Nunca falha para fora: sem IA, com erro ou acima
 * do tempo, devolve a ordem da pesquisa.
 */
@Injectable()
export class ReordenarService {
  private readonly logger = new Logger(ReordenarService.name);

  constructor(private readonly claude: ClaudeService) {}

  get disponivel(): boolean {
    return this.claude.disponivel;
  }

  async reordenar<T extends Pick<Trecho, 'trecho_id' | 'titulo' | 'entidade' | 'texto' | 'referencia'>>(
    pergunta: string,
    termos: string[],
    trechos: T[],
    limite: number,
    municipioId?: string,
  ): Promise<T[]> {
    if (!this.claude.disponivel || trechos.length <= 1) {
      return trechos.slice(0, limite);
    }
    const candidatos = trechos.slice(0, CANDIDATOS_REORDENAR);
    try {
      const pedido = this.claude.extrair(esquema, {
        tarefa: 'reordenar_pesquisa',
        sistema: SISTEMA,
        esforco: 'low',
        maxTokens: 800,
        municipioId: municipioId ?? null,
        conteudo: termos.length
          ? `Termos das fontes sugeridos: ${termos.join('; ')}`
          : 'Sem termos sugeridos.',
        externos: [
          { origem: 'municipe', texto: pergunta, rotulo: 'Pergunta' },
          {
            origem: 'fonte',
            rotulo: 'Trechos',
            texto: candidatos
              .map(
                (t, i) =>
                  `T${i + 1} · ${t.titulo}${t.referencia ? `, ${t.referencia}` : ''} · ${t.entidade}\n${t.texto.replace(/\s+/g, ' ').slice(0, MAX_TEXTO)}`,
              )
              .join('\n\n'),
          },
        ],
      });
      const r = await Promise.race([
        pedido,
        new Promise<null>((ok) => setTimeout(() => ok(null), TIMEOUT_MS)),
      ]);
      if (!r) {
        this.logger.warn('Reordenação acima do tempo: fica a ordem da pesquisa.');
        return trechos.slice(0, limite);
      }
      return aplicarOrdem(candidatos, r.relevantes, limite);
    } catch (e) {
      this.logger.warn(`Reordenação falhou: ${(e as Error).message}`);
      return trechos.slice(0, limite);
    }
  }
}

/**
 * Os escolhidos pela ordem do modelo (códigos inválidos ou repetidos ignorados).
 * Se o modelo não escolher nenhum, fica a ordem da pesquisa: dizer "não
 * encontrei" é decisão do agente, com os trechos à frente.
 */
export function aplicarOrdem<T>(candidatos: T[], codigos: string[], limite: number): T[] {
  const vistos = new Set<number>();
  const escolhidos: T[] = [];
  for (const c of codigos) {
    const n = Number(/^T(\d+)$/i.exec(c.trim())?.[1]);
    if (!Number.isInteger(n) || n < 1 || n > candidatos.length || vistos.has(n)) continue;
    vistos.add(n);
    escolhidos.push(candidatos[n - 1]);
  }
  if (!escolhidos.length) return candidatos.slice(0, limite);
  return escolhidos.slice(0, limite);
}
