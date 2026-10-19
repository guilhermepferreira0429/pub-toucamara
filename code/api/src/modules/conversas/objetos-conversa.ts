import type { Tx } from '../../database/database.service.js';

/*
 * O que ficou criado numa conversa (painel, página pública do resumo e
 * contexto do resumo pela IA). Os tokens públicos e códigos de links só
 * servem para montar URLs: quem responde ao painel não os devolve.
 */

export interface ObjetosConversa {
  requerimentos: {
    id: string;
    tipo: string;
    estado: string;
    campos_em_falta: string[];
    token_publico: string;
    processo_id: string | null;
  }[];
  processos: {
    id: string;
    numero: string;
    assunto: string;
    fase: string;
    link_codigo: string | null;
  }[];
  ocorrencias: {
    id: string;
    numero: string;
    categoria: string;
    morada: string;
    estado: string;
    token_publico: string;
  }[];
  marcacoes: {
    id: string;
    agenda: string;
    local: string | null;
    inicio: string;
    assunto: string | null;
    levar: string[] | null;
    estado: string;
    token_publico: string;
  }[];
  recolhas: {
    id: string;
    janela_inicio: string;
    estado: string;
    itens: unknown;
  }[];
  pagamentos: {
    id: string;
    valor_cent: number;
    estado: string;
    pagar_ate: string | null;
    modo_teste: boolean;
    link_codigo: string | null;
  }[];
  passagens: {
    id: string;
    motivo: string;
    estado: string;
    responder_ate: string | null;
  }[];
}

// Link curto ainda válido para um objeto aberto pelo código (processo, pagamento).
const LINK = (tipo: string, id: string) =>
  `(SELECT l.codigo FROM links_curtos l
    WHERE l.destino_id = ${id} AND l.destino_tipo = '${tipo}' AND l.expira_em > now()
    ORDER BY l.expira_em DESC LIMIT 1)`;

const SQL = `
SELECT
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'tipo', tp.nome, 'estado', r.estado, 'campos_em_falta', r.campos_em_falta,
      'token_publico', r.token_publico, 'processo_id', r.processo_id) ORDER BY r.criado_em)
    FROM requerimentos r JOIN tipos_processo tp ON tp.id = r.tipo_processo_id
    WHERE r.conversa_id = $1), '[]') AS requerimentos,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'assunto', p.assunto, 'fase', p.fase,
      'link_codigo', ${LINK('processo', 'p.id')}) ORDER BY p.criado_em)
    FROM processos p
    WHERE p.conversa_origem_id = $1
       OR p.id IN (SELECT processo_id FROM requerimentos WHERE conversa_id = $1)), '[]') AS processos,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'categoria', co.nome, 'morada', o.morada,
      'estado', o.estado, 'token_publico', o.token_publico) ORDER BY o.criada_em)
    FROM ocorrencias o JOIN categorias_ocorrencia co ON co.id = o.categoria_id
    WHERE o.conversa_id = $1), '[]') AS ocorrencias,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'agenda', a.nome, 'local', a.local, 'inicio', lower(m.periodo),
      'assunto', m.assunto, 'levar', m.levar, 'estado', m.estado,
      'token_publico', m.token_publico) ORDER BY lower(m.periodo))
    FROM marcacoes m JOIN agendas a ON a.id = m.agenda_id
    WHERE m.conversa_id = $1), '[]') AS marcacoes,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', rc.id, 'janela_inicio', lower(rc.janela), 'estado', rc.estado, 'itens', rc.itens)
      ORDER BY lower(rc.janela))
    FROM recolhas rc WHERE rc.conversa_id = $1), '[]') AS recolhas,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', pg.id, 'valor_cent', pg.valor_cent, 'estado', pg.estado, 'pagar_ate', pg.pagar_ate,
      'modo_teste', pg.modo_teste, 'link_codigo', ${LINK('pagamento', 'pg.id')}) ORDER BY pg.criado_em)
    FROM pagamentos pg
    WHERE pg.requerimento_id IN (SELECT id FROM requerimentos WHERE conversa_id = $1)
       OR pg.processo_id IN (SELECT id FROM processos WHERE conversa_origem_id = $1)), '[]') AS pagamentos,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', ph.id, 'motivo', ph.motivo, 'estado', ph.estado, 'responder_ate', ph.responder_ate)
      ORDER BY ph.criada_em)
    FROM passagens_humano ph WHERE ph.conversa_id = $1), '[]') AS passagens`;

export async function objetosDaConversa(
  db: Tx,
  conversaId: string,
): Promise<ObjetosConversa> {
  const [r] = await db.query<ObjetosConversa & Record<string, unknown>>(SQL, [
    conversaId,
  ]);
  return r;
}

/** O que ficou registado na conversa, uma linha por objeto (sem tokens). */
export function linhasObjetos(o: ObjetosConversa): string[] {
  return [
    ...o.requerimentos.map(
      (r) =>
        `Requerimento "${r.tipo}" (${r.estado})${r.campos_em_falta.length ? `, falta: ${r.campos_em_falta.join(', ')}` : ''}`,
    ),
    ...o.processos.map((p) => `Processo ${p.numero}: ${p.assunto} (${p.fase})`),
    ...o.ocorrencias.map(
      (x) => `Ocorrência ${x.numero}: ${x.categoria} (${x.estado})`,
    ),
    ...o.marcacoes.map(
      (m) =>
        `Marcação em ${m.agenda} a ${m.inicio}${m.levar?.length ? `, levar: ${m.levar.join(', ')}` : ''} (${m.estado})`,
    ),
    ...o.recolhas.map(
      (r) => `Recolha de monos a ${r.janela_inicio} (${r.estado})`,
    ),
    ...o.pagamentos.map(
      (p) =>
        `Pagamento de ${(p.valor_cent / 100).toFixed(2)} € (${p.estado})${p.pagar_ate ? ` até ${p.pagar_ate}` : ''}`,
    ),
    ...o.passagens.map(
      (p) => `Passada a funcionário (motivo: ${p.motivo}, ${p.estado})`,
    ),
  ];
}

/** Linhas curtas para o modelo saber o que ficou registado na chamada. */
export function descreverObjetos(o: ObjetosConversa): string {
  const linhas = linhasObjetos(o);
  return linhas.length ? linhas.map((l) => `- ${l}`).join('\n') : '- Nada';
}
