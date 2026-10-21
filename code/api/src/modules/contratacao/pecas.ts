import { z } from 'zod';
import { formatarEuros } from '../pagamentos/taxas.js';
import {
  AVISO_RASCUNHO,
  NOMES_PROCEDIMENTO,
  NOMES_TIPO,
  Procedimento,
  TipoContrato,
} from './config.js';

/*
 * Rascunhos das peças (convite e caderno de encargos). Com IA, o texto
 * parte do objeto; sem IA, modelos fixos com campos "[a preencher: …]".
 * Nunca se escreve texto jurídico como definitivo: tudo é rascunho para
 * revisão jurídica, sem artigos nem números que não venham do pedido.
 */

export const TIPOS_PECA = ['convite', 'caderno_encargos'] as const;
export type TipoPeca = (typeof TIPOS_PECA)[number];

export const esquemaSecao = z.object({
  titulo: z.string().trim().min(1).max(200),
  texto: z.string().trim().max(8000),
});
export type Secao = z.infer<typeof esquemaSecao>;

export const esquemaSecoes = z.array(esquemaSecao).min(1).max(40);

export interface DadosPecas {
  municipio: string;
  procedimento: Procedimento;
  tipo: TipoContrato;
  objeto: string;
  valor_estimado_cent: number;
  prazo_meses: number;
  servico_requerente: string;
  fundamentacao: string | null;
  entidade_nome: string | null;
  entidade_nif: string | null;
  prazo_propostas_dias: number | null;
}

export interface RascunhoPeca {
  tipo: TipoPeca;
  titulo: string;
  secoes: Secao[];
  campos_a_preencher: string[];
  modo: 'ia' | 'modelo';
  aviso: string;
}

const P = (o_que: string) => `[a preencher: ${o_que}]`;

/** Os "[a preencher: …]" que ficaram no texto, sem repetições. */
export function camposAPreencher(secoes: Secao[]): string[] {
  const vistos = new Set<string>();
  for (const s of secoes) {
    for (const m of `${s.titulo}\n${s.texto}`.matchAll(
      /\[a preencher: ([^\]]+)\]/gi,
    )) {
      vistos.add(m[1].trim());
    }
  }
  return [...vistos];
}

export function tituloPeca(tipo: TipoPeca, proc: Procedimento): string {
  if (tipo === 'caderno_encargos') return 'Caderno de encargos';
  if (proc === 'concurso_publico') return 'Programa do procedimento';
  if (proc === 'ajuste_direto_simplificado') return 'Pedido de proposta';
  return 'Convite';
}

function conviteModelo(d: DadosPecas): Secao[] {
  const entidade =
    d.entidade_nome || d.entidade_nif
      ? [d.entidade_nome, d.entidade_nif ? `NIF ${d.entidade_nif}` : null]
          .filter(Boolean)
          .join(', ')
      : P('entidade(s) a convidar e NIF');
  return [
    {
      titulo: 'Entidade adjudicante',
      texto: `${d.municipio}, com sede em ${P('morada')}, NIF ${P('NIF do município')}. Serviço requerente: ${d.servico_requerente}.`,
    },
    {
      titulo: 'Objeto',
      texto: `${d.objeto} (${NOMES_TIPO[d.tipo]}). CPV: ${P('código CPV')}.`,
    },
    {
      titulo: 'Procedimento',
      texto: `${NOMES_PROCEDIMENTO[d.procedimento][0].toUpperCase()}${NOMES_PROCEDIMENTO[d.procedimento].slice(1)}, ao abrigo do Código dos Contratos Públicos — ${P('artigo e alínea, a confirmar pelo jurista')}.`,
    },
    {
      titulo: 'Entidade(s) convidada(s)',
      texto:
        d.procedimento === 'consulta_previa'
          ? `${entidade}; ${P('pelo menos mais duas entidades')}.`
          : d.procedimento === 'concurso_publico'
            ? 'Concurso aberto: pode concorrer qualquer entidade que cumpra os requisitos.'
            : entidade,
    },
    {
      titulo: 'Preço base',
      texto: `${formatarEuros(d.valor_estimado_cent)}, sem IVA. ${P('fundamentação do preço base')}.`,
    },
    {
      titulo: 'Prazo de execução',
      texto: `${d.prazo_meses} ${d.prazo_meses === 1 ? 'mês' : 'meses'} a contar de ${P('data de início')}.`,
    },
    {
      titulo: 'Documentos da proposta',
      texto: `Proposta de preço; declaração de aceitação do caderno de encargos; ${P('outros documentos pedidos')}.`,
    },
    {
      titulo: 'Prazo e modo de apresentação das propostas',
      texto: `${d.prazo_propostas_dias ? `Pelo menos ${d.prazo_propostas_dias} dias (prazo de demonstração)` : P('prazo')}, na plataforma eletrónica ${P('nome da plataforma')}.`,
    },
    {
      titulo: 'Critério de adjudicação',
      texto: P(
        'preço mais baixo ou melhor relação qualidade-preço, com os fatores e a ponderação',
      ),
    },
    {
      titulo: 'Esclarecimentos',
      texto: `Pedidos de esclarecimento até ${P('prazo')}, para ${P('contacto')}.`,
    },
  ];
}

function cadernoModelo(d: DadosPecas): Secao[] {
  return [
    { titulo: 'Cláusula 1.ª — Objeto', texto: `${d.objeto}.` },
    {
      titulo: 'Cláusula 2.ª — Especificações',
      texto: `${d.fundamentacao ? `${d.fundamentacao} ` : ''}${P('especificações técnicas, quantidades e níveis de serviço')}.`,
    },
    {
      titulo: 'Cláusula 3.ª — Prazo',
      texto: `O contrato dura ${d.prazo_meses} ${d.prazo_meses === 1 ? 'mês' : 'meses'}. ${P('renovações, se houver')}.`,
    },
    {
      titulo: 'Cláusula 4.ª — Local de execução',
      texto: P('local'),
    },
    {
      titulo: 'Cláusula 5.ª — Preço e condições de pagamento',
      texto: `Preço base: ${formatarEuros(d.valor_estimado_cent)}, sem IVA. Pagamento: ${P('prazo e forma de pagamento')}.`,
    },
    {
      titulo: 'Cláusula 6.ª — Obrigações do adjudicatário',
      texto: P('obrigações principais e acessórias'),
    },
    {
      titulo: 'Cláusula 7.ª — Gestor do contrato',
      texto: `${P('nome e função do gestor do contrato')}.`,
    },
    {
      titulo: 'Cláusula 8.ª — Penalidades',
      texto: P(
        'penalidades por atraso ou incumprimento, a definir com o jurista',
      ),
    },
    {
      titulo: 'Cláusula 9.ª — Resolução do contrato',
      texto: P('causas de resolução, a definir com o jurista'),
    },
    {
      titulo: 'Cláusula 10.ª — Foro e legislação aplicável',
      texto: P(
        'foro competente e legislação aplicável, a definir com o jurista',
      ),
    },
  ];
}

/** Modelos fixos, sem IA. */
export function pecasModelo(d: DadosPecas): RascunhoPeca[] {
  return TIPOS_PECA.map((tipo) => {
    const secoes = tipo === 'convite' ? conviteModelo(d) : cadernoModelo(d);
    return {
      tipo,
      titulo: tituloPeca(tipo, d.procedimento),
      secoes,
      campos_a_preencher: camposAPreencher(secoes),
      modo: 'modelo' as const,
      aviso: AVISO_RASCUNHO,
    };
  });
}

// --- Com IA -------------------------------------------------------------------

export const esquemaPecasIa = z.object({
  convite: z.array(esquemaSecao).min(1).max(30),
  caderno_encargos: z.array(esquemaSecao).min(1).max(30),
});

export const SISTEMA_PECAS = `És um assistente da divisão de compras de uma câmara municipal portuguesa. Escreves RASCUNHOS de peças de contratação pública (convite ou programa do procedimento, e caderno de encargos) para depois serem revistos por um jurista.

Regras:
- Português de Portugal, frases claras.
- É um rascunho para revisão jurídica: não apresentes nada como definitivo.
- Não inventes artigos de lei, números, prazos, preços, nomes, moradas nem NIF. Usa só o que vem no pedido.
- Tudo o que faltar escreve exatamente "[a preencher: o que falta]".
- O convite tem secções curtas: entidade adjudicante, objeto, procedimento, entidades convidadas, preço base, prazo de execução, documentos da proposta, prazo de apresentação das propostas, critério de adjudicação, esclarecimentos.
- O caderno de encargos tem cláusulas numeradas ("Cláusula 1.ª — Objeto", ...): objeto, especificações (concretiza o que se percebe do objeto, sem inventar quantidades), prazo, local, preço e pagamento, obrigações do adjudicatário, gestor do contrato, penalidades, resolução, foro.
- Devolve só o JSON pedido.`;

export function conteudoPecasIa(d: DadosPecas): string {
  return [
    `Município: ${d.municipio}`,
    `Procedimento: ${NOMES_PROCEDIMENTO[d.procedimento]}`,
    `Tipo de contrato: ${NOMES_TIPO[d.tipo]}`,
    `Objeto: ${d.objeto}`,
    `Fundamentação do serviço requerente: ${d.fundamentacao ?? '(não indicada)'}`,
    `Serviço requerente: ${d.servico_requerente}`,
    `Preço base (sem IVA): ${formatarEuros(d.valor_estimado_cent)}`,
    `Prazo de execução: ${d.prazo_meses} meses`,
    `Entidade a convidar: ${d.entidade_nome ?? '(não indicada)'}${d.entidade_nif ? `, NIF ${d.entidade_nif}` : ''}`,
    `Prazo para as propostas (valor de demonstração): ${d.prazo_propostas_dias ? `${d.prazo_propostas_dias} dias` : '(não indicado)'}`,
  ].join('\n');
}

/** A resposta da IA nas mesmas peças dos modelos (com os campos em falta). */
export function pecasDaIa(
  d: DadosPecas,
  r: z.infer<typeof esquemaPecasIa>,
): RascunhoPeca[] {
  return TIPOS_PECA.map((tipo) => {
    const secoes = r[tipo];
    return {
      tipo,
      titulo: tituloPeca(tipo, d.procedimento),
      secoes,
      campos_a_preencher: camposAPreencher(secoes),
      modo: 'ia' as const,
      aviso: AVISO_RASCUNHO,
    };
  });
}
