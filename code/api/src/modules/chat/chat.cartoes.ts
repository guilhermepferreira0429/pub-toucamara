/**
 * Cartões do chat: o que o ecrã mostra além do texto, construído a partir do
 * resultado das ferramentas. O mapeamento é por nome de ferramenta;
 * ferramentas desconhecidas não geram cartão.
 */
export type TipoCartao =
  | 'fonte'
  | 'contacto'
  | 'marcacao'
  | 'simulacao'
  | 'pagamento'
  | 'rascunho'
  | 'emergencia'
  | 'requerimento'
  | 'ocorrencia'
  | 'passagem'
  | 'vagas'
  | 'processo'
  | 'apoios'
  | 'consulta'
  | 'reclamacao'
  | 'agora'
  | 'empresa'
  | 'entrega'
  | 'documento'
  | 'termo'
  | 'carta';

export interface FonteCartao {
  titulo: string;
  url: string;
  entidade: string;
  referencia: string | null;
}

export type Cartao =
  | { tipo: 'fonte'; fontes: FonteCartao[] }
  | { tipo: 'emergencia'; telefone: '112'; dados: Record<string, unknown> }
  | {
      tipo: Exclude<TipoCartao, 'fonte' | 'emergencia'>;
      ferramenta: string;
      dados: Record<string, unknown>;
    };

const POR_FERRAMENTA: Record<
  string,
  Exclude<TipoCartao, 'fonte' | 'emergencia'>
> = {
  encaminhar: 'contacto',
  marcar: 'marcacao',
  agendar_recolha: 'marcacao',
  simular_taxa: 'simulacao',
  criar_pagamento: 'pagamento',
  redigir: 'rascunho',
  iniciar_requerimento: 'requerimento',
  preencher_campo: 'requerimento',
  concluir_requerimento: 'requerimento',
  registar_ocorrencia: 'ocorrencia',
  // Passagem a pessoa: responder_ate, fora_de_horas e o "dizer".
  passar_a_humano: 'passagem',
  // As vagas (inicio, dito) e a agenda; ou precisa_escolher com as agendas.
  ver_vagas: 'vagas',
  // Os processos (fase, prazo, o que falta) ou precisa_identificacao.
  estado_processo: 'processo',
  // A que apoios pode ter direito (e o pedido de um apoio).
  que_apoios_tenho: 'apoios',
  pedir_apoio: 'apoios',
  // Consulta pública: participação registada (dizer, relatório, link).
  participar_consulta: 'consulta',
  // Reclamação formal: número, data-limite de resposta e link.
  registar_reclamacao: 'reclamacao',
  // O que se passa perto: os itens (frase, link), o link do feed; e a
  // subscrição "avise-me" (zona, tipos).
  o_que_se_passa: 'agora',
  avisar_me: 'agora',
  // Balcão para empresas: a lista do que precisa (itens, link) e o
  // calendário de obrigações (próximas datas, link).
  o_que_a_empresa_precisa: 'empresa',
  obrigacoes_da_empresa: 'empresa',
  // Entregar em nome da pessoa: o resumo por confirmar ou o link/estado.
  entregar_pedido: 'entrega',
  // Linguagem simples: o resumo revisto com o link (resumo + texto oficial).
  documento_simples: 'documento',
  // Glossário: o termo e a explicação simples.
  explicar_termo: 'termo',
  // "Não percebi esta carta": a explicação, o prazo e o rascunho.
  ler_carta: 'carta',
  preparar_resposta_carta: 'carta',
};

function objeto(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function lista(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(objeto) : [];
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** As fontes de um resultado de `procurar_conhecimento`, sem repetidos. */
export function fontesDe(resultado: unknown): FonteCartao[] {
  const r = objeto(resultado);
  const brutas = [
    ...lista(r.respostas).flatMap((x) => lista(x.fontes)),
    ...lista(r.trechos),
  ];
  const vistas = new Set<string>();
  const fontes: FonteCartao[] = [];
  for (const f of brutas) {
    const titulo = texto(f.titulo);
    const url = texto(f.url);
    if (!titulo || !url) continue;
    const referencia = texto(f.referencia);
    const chave = `${url}#${referencia ?? ''}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    fontes.push({
      titulo,
      url,
      entidade: texto(f.entidade) ?? '',
      referencia,
    });
  }
  return fontes;
}

/** Os trechos devolvidos por `procurar_conhecimento`, para gravar em `citacoes`. */
export function trechosDe(resultado: unknown): string[] {
  const r = objeto(resultado);
  const ids = [
    ...lista(r.respostas).flatMap((x) => lista(x.fontes)),
    ...lista(r.trechos),
  ]
    .map((t) => texto(t.trecho_id))
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/**
 * O cartão do resultado de uma ferramenta, ou null. Uma ferramenta que falhou
 * não gera cartão, exceto a emergência: o 112 aparece sempre.
 */
export function cartaoDe(
  nome: string,
  resultado: unknown,
  erro = false,
): Cartao | null {
  if (nome === 'emergencia') {
    return {
      tipo: 'emergencia',
      telefone: '112',
      dados: erro ? {} : objeto(resultado),
    };
  }
  if (erro) return null;
  if (nome === 'procurar_conhecimento') {
    if (objeto(resultado).sem_fonte === true) return null;
    const fontes = fontesDe(resultado);
    return fontes.length > 0 ? { tipo: 'fonte', fontes } : null;
  }
  const tipo = POR_FERRAMENTA[nome];
  if (!tipo) return null;
  return { tipo, ferramenta: nome, dados: objeto(resultado) };
}
