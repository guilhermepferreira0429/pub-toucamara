import { nifValido } from '../municipes/municipes.service.js';
import { NOMES_PROCEDIMENTO, NOMES_TIPO, TipoContrato } from './config.js';
import type { ResultadoAvaliacao } from './motor.js';
import { formatarEuros } from '../pagamentos/taxas.js';

/*
 * "Cabe no ajuste direto?" no assistente interno: reconhece a pergunta e
 * tira dela o tipo, o valor, o prazo e o NIF, para o motor responder (sem
 * IA, com as regras do município). Puro, para testar à parte.
 */

export interface PerguntaContratacao {
  tipo: TipoContrato;
  /** O tipo não vinha na pergunta: assumiu-se serviços. */
  tipo_assumido: boolean;
  valor_estimado_cent: number;
  prazo_meses: number;
  prazo_assumido: boolean;
  entidade_nif: string | null;
  objeto: string;
}

const ASSUNTO =
  /ajuste direto|ajuste directo|consulta previa|concurso publico|contratacao publica|procedimento de contratacao|que procedimento/;

/** Prazo por omissão quando a pergunta não o diz (só para a resposta rápida). */
export const PRAZO_ASSUMIDO_MESES = 12;

function sem(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function lerValor(t: string): number | null {
  const r =
    /(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k)?\s*(?:€|euros?\b|eur\b)/.exec(
      t,
    ) ?? /€\s*(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k)?/.exec(t);
  if (!r) return null;
  const inteiro = Number(r[1].replace(/[ .]/g, ''));
  const cent = r[2] ? Number(r[2].padEnd(2, '0')) : 0;
  const mult = r[3] ? 1000 : 1;
  const v = Math.round((inteiro + cent / 100) * mult * 100);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function lerPerguntaContratacao(
  pergunta: string,
): PerguntaContratacao | null {
  const t = sem(pergunta);
  if (!ASSUNTO.test(t)) return null;
  const valor = lerValor(t);
  if (valor === null) return null;

  let tipo: TipoContrato | null = null;
  if (/empreitada|\bobras?\b/.test(t)) tipo = 'empreitada';
  else if (/servico/.test(t)) tipo = 'servicos';
  else if (
    /\bbens\b|material|equipamento|fornecimento|comprar|compra de/.test(t)
  )
    tipo = 'bens';

  const p = /(\d+)\s*(meses|mes|anos?)\b/.exec(t);
  const prazo = p ? Number(p[1]) * (p[2].startsWith('ano') ? 12 : 1) : null;

  const nif = /\b(\d{9})\b/.exec(t)?.[1] ?? null;

  return {
    tipo: tipo ?? 'servicos',
    tipo_assumido: tipo === null,
    valor_estimado_cent: valor,
    prazo_meses:
      prazo && prazo > 0 && prazo <= 240 ? prazo : PRAZO_ASSUMIDO_MESES,
    prazo_assumido: !(prazo && prazo > 0 && prazo <= 240),
    entidade_nif: nif && nifValido(nif) ? nif : null,
    objeto: pergunta.trim().slice(0, 500),
  };
}

/** A resposta em texto do assistente, a partir do resultado do motor. */
export function respostaContratacao(
  p: PerguntaContratacao,
  r: ResultadoAvaliacao,
): string {
  const linhas: string[] = [];
  linhas.push(
    r.cabe_ajuste_direto
      ? `Sim, pelas regras configuradas cabe no ${NOMES_PROCEDIMENTO[r.recomendado]}.`
      : `Não cabe no ajuste direto: pelas regras configuradas é preciso ${NOMES_PROCEDIMENTO[r.recomendado]}.`,
  );
  const assumido = [
    p.tipo_assumido ? `considerei ${NOMES_TIPO[p.tipo]}` : null,
    p.prazo_assumido ? `um contrato de ${p.prazo_meses} meses` : null,
  ].filter(Boolean);
  linhas.push(
    `${NOMES_TIPO[p.tipo][0].toUpperCase()}${NOMES_TIPO[p.tipo].slice(1)} de ${formatarEuros(p.valor_estimado_cent)} sem IVA` +
      (assumido.length
        ? ` (a pergunta não dizia: ${assumido.join(' e ')}).`
        : '.'),
  );
  const escolhido = r.procedimentos.find(
    (x) => x.procedimento === r.recomendado,
  );
  for (const x of escolhido?.porque ?? []) linhas.push(`• ${x}`);
  for (const a of [...r.alertas, ...(escolhido?.alertas ?? [])])
    linhas.push(`Atenção: ${a}`);
  if (r.demonstracao) {
    linhas.push(
      `Valores de demonstração, a confirmar pelo jurista. Fonte: ${r.fonte}`,
    );
  }
  linhas.push(
    'Para preparar as peças (convite e caderno de encargos), use Contratação pública no painel.',
  );
  return linhas.join('\n');
}
