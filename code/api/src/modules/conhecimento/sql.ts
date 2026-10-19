/*
 * Fragmentos de SQL partilhados pela pesquisa, pela ingestão e pelo painel.
 * Só texto fixo (alias de tabelas): os valores vão sempre em $n.
 */

/** Em vigor hoje (vigência legal) para o alias `a` (fonte_versoes ou trechos). */
export const EM_VIGOR = (a: string) =>
  `(${a}.vigor_desde IS NULL OR ${a}.vigor_desde <= current_date)
   AND (${a}.vigor_ate IS NULL OR ${a}.vigor_ate >= current_date)`;

/**
 * `fv` é a versão atual da fonte `fo`: a lida mais recentemente entre as que
 * estão em vigor hoje. As versões antigas ficam para a história ("que regra
 * valia em cada data") e para as citações já feitas, mas não se procuram.
 */
export const VERSAO_ATUAL = `fv.id = (
  SELECT v.id FROM fonte_versoes v
  WHERE v.fonte_id = fo.id AND ${EM_VIGOR('v')}
  ORDER BY v.lida_em DESC LIMIT 1)`;

/**
 * A pergunta vem falada ("preciso de licença para obras na cozinha?"): exigir
 * todas as palavras (websearch_to_tsquery) quase nunca acerta. Parte-se em
 * lexemas do dicionário português (sem acentos nem palavras vazias) e
 * procura-se qualquer um deles (OU); a ordenação faz o resto. O cast direto
 * para tsquery não volta a reduzir lexemas já reduzidos. `$n` é o texto.
 */
export const CONSULTA_OU = (n: number) => `
  SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery AS q
  FROM unnest(to_tsvector('pt_unaccent', $${n}))`;

/** Fonte de um trecho (aliases t, fv, fo, e), no formato da ferramenta. */
export const FONTE_JSON = `jsonb_build_object(
  'trecho_id', t.id, 'referencia', t.referencia, 'titulo', fo.titulo,
  'url', fo.url, 'entidade', e.nome, 'lida_em', fv.lida_em)`;
