/*
 * Regras puras dos avisos ao munícipe: prazos dos pedidos de documentos,
 * lembretes antes do fim e o texto de cada aviso (SMS ou email). Sem BD,
 * para testar à parte.
 *
 * Os textos são curtos de propósito: com um só acento o SMS passa a UCS-2
 * (70 caracteres por parte, 67 com várias) e cada parte paga-se.
 */
import { diasUteisEntre, Feriados } from '../../common/dias-uteis.js';
import { diaMes, Fase, FASE_ROTULO } from './regras.js';

/**
 * Prazo por omissão para o munícipe responder a um pedido de elementos: 10
 * dias úteis, o prazo supletivo do CPA para os interessados quando a lei ou
 * o técnico não fixam outro.
 */
export const PRAZO_PEDIDO_DIAS_UTEIS = 10;

/** O lembrete sai quando faltam este número de dias úteis (ou menos). */
export const LEMBRETE_DIAS_UTEIS = 3;

/** Fases que o munícipe percebe e de que é avisado ao entrar nelas. */
export const FASES_AVISADAS: readonly Fase[] = [
  'documentos',
  'apreciacao',
  'pareceres_externos',
];

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** 'AAAA-MM-DD' → '30 de outubro' (o que o agente diz). */
export function diaPorExtenso(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} de ${MESES[Number(m) - 1]}`;
}

/** Um documento em falta e, se foi pedido pelo técnico, até quando. */
export interface EmFalta {
  nome: string;
  prazo: string | null;
}

/** Pedido do técnico ainda por responder. */
export interface PedidoAberto {
  descricao: string;
  prazo: string;
}

/**
 * Junta a cada nome em falta o prazo do pedido correspondente (o mais
 * cedo, se o mesmo documento foi pedido duas vezes). Os obrigatórios do tipo
 * que ninguém pediu não têm prazo próprio.
 */
export function comPrazos(
  faltam: string[],
  pedidos: PedidoAberto[],
): EmFalta[] {
  return faltam.map((nome) => {
    const prazos = pedidos
      .filter((p) => p.descricao === nome)
      .map((p) => p.prazo)
      .sort();
    return { nome, prazo: prazos[0] ?? null };
  });
}

export type EstadoPedido = 'respondido' | 'por_responder' | 'fora_de_prazo';

/** Respondido, por responder ou com o prazo já passado sem resposta. */
export function estadoPedido(
  p: { respondido_em: Date | string | null; prazo: string },
  hoje: string,
): EstadoPedido {
  if (p.respondido_em) return 'respondido';
  return p.prazo < hoje ? 'fora_de_prazo' : 'por_responder';
}

/** 'Certidão (tem até dia 30 de outubro), Planta' — para o agente dizer. */
export function emFaltaFalado(itens: EmFalta[], hoje: string): string {
  return itens
    .map(({ nome, prazo }) => {
      if (!prazo) return nome;
      if (prazo < hoje)
        return `${nome} (o prazo terminou a ${diaPorExtenso(prazo)})`;
      if (prazo === hoje) return `${nome} (o prazo termina hoje)`;
      return `${nome} (tem até dia ${diaPorExtenso(prazo)})`;
    })
    .join(', ');
}

/**
 * Lembrete para um pedido por responder? Só quando faltam
 * LEMBRETE_DIAS_UTEIS ou menos (e o prazo ainda não passou), e só se o
 * pedido deu mais do que isso: um pedido de 2 dias já disse o prazo no SMS
 * do próprio pedido, outro logo a seguir seria ruído.
 */
export function precisaLembrete(p: {
  pedidoDia: string;
  prazo: string;
  hoje: string;
  feriados: Feriados;
}): boolean {
  const restantes = diasUteisEntre(p.hoje, p.prazo, p.feriados);
  if (restantes < 0 || restantes > LEMBRETE_DIAS_UTEIS) return false;
  return diasUteisEntre(p.pedidoDia, p.prazo, p.feriados) > LEMBRETE_DIAS_UTEIS;
}

export type CanalAviso = 'sms' | 'email';

/**
 * Por onde avisar: email se o munícipe o preferir e o tiver, senão SMS;
 * sem telefone, o email que houver. Sem nenhum → null.
 */
export function escolherCanal(m: {
  telefone: string | null;
  email: string | null;
  preferido: string | null;
}): { canal: CanalAviso; destino: string } | null {
  if (m.preferido === 'email' && m.email)
    return { canal: 'email', destino: m.email };
  if (m.telefone) return { canal: 'sms', destino: m.telefone };
  if (m.email) return { canal: 'email', destino: m.email };
  return null;
}

export interface Aviso {
  assunto: string;
  texto: string;
}

interface Base {
  municipio: string;
  numero: string;
  link: string;
}

/** Lista curta para SMS: com muitos nomes compridos diz só quantos são. */
function listaCurta(nomes: string[]): string {
  const junta = nomes.join(', ');
  return junta.length <= 60 ? junta : `${nomes.length} documentos`;
}

/**
 * O aviso de mudança de fase, ou null se a fase não se avisa (entrada,
 * arquivado; decisão e notificado têm o SMS da decisão).
 */
export function avisoFase(
  para: Fase,
  d: Base & { prazoFim: string | null; faltam: string[] },
): Aviso | null {
  const assunto = `Processo ${d.numero}: ${FASE_ROTULO[para]}`;
  const inicio = `${d.municipio}: o processo ${d.numero}`;
  switch (para) {
    case 'documentos':
      return {
        assunto,
        texto: d.faltam.length
          ? `${inicio} aguarda documentos seus: ${listaCurta(d.faltam)}. Envie aqui: ${d.link}`
          : `${inicio} aguarda documentos seus. Veja o que falta: ${d.link}`,
      };
    case 'apreciacao':
      return {
        assunto,
        texto: d.prazoFim
          ? `${inicio} está completo e em análise. O prazo da câmara termina a ${diaMes(d.prazoFim)}. ${d.link}`
          : `${inicio} está completo e em análise. ${d.link}`,
      };
    case 'pareceres_externos':
      return {
        assunto,
        texto: `${inicio} aguarda pareceres de entidades externas. ${d.link}`,
      };
    default:
      return null;
  }
}

/** O pedido de um documento, com o prazo. */
export function avisoPedido(
  d: Base & { nome: string; nota: string | null; prazo: string },
): Aviso {
  return {
    assunto: `Processo ${d.numero}: documento pedido`,
    texto:
      `${d.municipio}: no processo ${d.numero} precisamos de: ${d.nome}, até ${diaMes(d.prazo)}.` +
      `${d.nota ? ` ${d.nota.trim().replace(/[.!?]?$/, '.')}` : ''} Envie aqui: ${d.link}`,
  };
}

/** O lembrete antes do fim do prazo de um pedido. */
export function avisoLembrete(
  d: Base & { descricao: string; prazo: string; hoje: string },
): Aviso {
  const ate = `até ${d.prazo === d.hoje ? 'hoje' : diaMes(d.prazo)}`;
  return {
    assunto: `Processo ${d.numero}: prazo a terminar`,
    texto: `${d.municipio}: lembrete, no processo ${d.numero} falta entregar ${d.descricao} ${ate}. Envie aqui: ${d.link}`,
  };
}
