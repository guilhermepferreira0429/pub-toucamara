/*
 * SMS de entrada: o que a pessoa quer e a resposta (sem BD, para testar à
 * parte). As respostas são curtas: cada 160 caracteres (70 com acentos) é
 * um SMS pago.
 */
import { lerNumero } from '../processos/regras.js';

export type Intencao = 'estado' | 'parar' | 'ajuda';

/** No máximo isto por número e por hora (resposta a cada SMS custa). */
export const MAXIMO_POR_HORA = 6;

const PARAR =
  /^(parar|stop|sair|cancelar|nao quero avisos|não quero avisos)\.?$/i;
const ESTADO = /\b(estado|processo|pedido|licen[cç]a)\b/i;

export function intencao(corpo: string): Intencao {
  const t = corpo.trim().replace(/\s+/g, ' ');
  if (PARAR.test(t)) return 'parar';
  if (ESTADO.test(t) || (/\d/.test(t) && lerNumero(t))) return 'estado';
  return 'ajuda';
}

/** O número do processo, se vier no SMS ("CP 12/2026", "estado 12/2026"). */
export function numeroNoSms(corpo: string): string | undefined {
  return /\d/.test(corpo) ? corpo.trim() : undefined;
}

export interface ResultadoEstado {
  precisa_identificacao?: boolean;
  encontrado?: boolean;
  mensagem?: string;
  processos?: { resumo: string }[];
  processos_da_pessoa?: string[];
}

export function respostaEstado(
  r: ResultadoEstado,
  linha: string | null,
): string {
  const ligar = linha ? ` Ligue para ${linha}.` : '';
  if (r.precisa_identificacao) {
    return `Por SMS só damos o estado dos processos associados a este número.${ligar || ' Contacte a câmara.'}`;
  }
  if (!r.encontrado) {
    const outros = r.processos_da_pessoa?.length
      ? ` Os seus processos: ${r.processos_da_pessoa.slice(0, 3).join(', ')}.`
      : '';
    return `${r.mensagem ?? 'Não encontrámos esse processo.'}${outros}`;
  }
  const resumos = (r.processos ?? []).slice(0, 2).map((p) => p.resumo);
  return `${resumos.join(' ')}${ligar ? ` Dúvidas?${ligar}` : ''}`;
}

export function respostaAjuda(municipio: string, linha: string | null): string {
  return (
    `Câmara de ${municipio}: para saber o estado de um processo, envie o número (ex.: CP 12/2026).` +
    ` Para deixar de receber avisos, envie PARAR.${linha ? ` Para o resto, ligue ${linha}.` : ''}`
  );
}
