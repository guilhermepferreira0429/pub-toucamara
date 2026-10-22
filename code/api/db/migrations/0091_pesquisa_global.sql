-- Pesquisa global do painel (⌘K): procurar sem acentos nem maiúsculas a
-- importar, com índices de trigramas para o «contém» (LIKE '%…%') ser rápido.
-- As extensões (pg_trgm, unaccent) vêm da 0001.

-- O unaccent não é IMMUTABLE (depende do dicionário), e um índice só aceita
-- funções que o são. Com o dicionário escrito por extenso o resultado não
-- muda: pode-se marcar assim.
CREATE OR REPLACE FUNCTION pesquisavel(texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto)) $$;

CREATE INDEX IF NOT EXISTS municipes_nome_pesquisa_idx
  ON municipes USING gin (pesquisavel(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS conversas_resumo_pesquisa_idx
  ON conversas USING gin (pesquisavel(resumo) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS processos_assunto_pesquisa_idx
  ON processos USING gin (pesquisavel(assunto) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS processos_numero_pesquisa_idx
  ON processos USING gin (pesquisavel(numero) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ocorrencias_morada_pesquisa_idx
  ON ocorrencias USING gin (pesquisavel(morada) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ocorrencias_descricao_pesquisa_idx
  ON ocorrencias USING gin (pesquisavel(descricao) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ocorrencias_numero_pesquisa_idx
  ON ocorrencias USING gin (pesquisavel(numero) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS reclamacoes_descricao_pesquisa_idx
  ON reclamacoes USING gin (pesquisavel(descricao) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS reclamacoes_numero_pesquisa_idx
  ON reclamacoes USING gin (pesquisavel(numero) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS fontes_titulo_pesquisa_idx
  ON fontes USING gin (pesquisavel(titulo) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS respostas_pergunta_pesquisa_idx
  ON respostas USING gin (pesquisavel(pergunta_tipo) gin_trgm_ops);
