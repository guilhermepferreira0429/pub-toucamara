-- Escala de avaliação por categorias (v2). Ao lado do veredicto binário
-- (certa / passada_bem / errada / sem_resposta), que continua igual e com o
-- mesmo significado, cada avaliação feita com a rubrica v2 grava também a
-- categoria, a regra que a deu, se a resposta chega para o munícipe e os
-- erros graves e menores. As avaliações antigas ficam com estas colunas a
-- NULL. Nada do que existe muda de significado.

-- Factos obrigatórios marcados S (secundários). Os que não estão aqui são E
-- (essenciais): sem classificação, todos contam como essenciais.
ALTER TABLE avaliacao.gabarito
  ADD COLUMN factos_secundarios text[] NOT NULL DEFAULT '{}';

ALTER TABLE avaliacao.avaliacoes
  ADD COLUMN categoria text CHECK (categoria IN ('certa','maioritariamente_certa','parcialmente_certa',
    'maioritariamente_errada','errada','mandou_contactar','nao_encontrou','inconclusiva','sem_resposta')),
  ADD COLUMN regra_categoria text,                     -- 'C1-sem-resposta' … 'C10-completa'
  ADD COLUMN suficiente text CHECK (suficiente IN ('sim','em_parte','nao')),
  ADD COLUMN erros_graves text[],                      -- = factos_errados nas avaliações v2
  ADD COLUMN erros_menores text[],
  ADD COLUMN nao_encontrou boolean,
  ADD COLUMN categoria_juiz text CHECK (categoria_juiz IN ('certa','maioritariamente_certa','parcialmente_certa',
    'maioritariamente_errada','errada','mandou_contactar','nao_encontrou','inconclusiva','sem_resposta'));

-- A mesma vista de sempre (mesma ordem e mesmas colunas), refeita para o a.*
-- incluir as colunas novas no fim.
CREATE OR REPLACE VIEW avaliacao.avaliacao_final AS
SELECT DISTINCT ON (a.resposta_id) a.*
FROM avaliacao.avaliacoes a
ORDER BY a.resposta_id, (a.avaliador <> 'juiz') DESC, a.criada_em DESC;

-- A avaliação que conta para a escala v2: a mesma ordem, só entre as que têm
-- categoria (uma avaliação humana só com veredicto não apaga a categoria).
CREATE VIEW avaliacao.avaliacao_final_categoria AS
SELECT DISTINCT ON (a.resposta_id) a.*
FROM avaliacao.avaliacoes a
WHERE a.categoria IS NOT NULL
ORDER BY a.resposta_id, (a.avaliador <> 'juiz') DESC, a.criada_em DESC;

-- Resultado da escala v2 por execução (e por categoria de pergunta; linha com
-- categoria NULL = total). Mesma forma da vista `resultados`. "nota" = média
-- de 0 a 100 (certa 100, maioritariamente_certa 75, parcialmente_certa 50,
-- maioritariamente_errada 25, as outras 0); reporta-se sempre com a
-- distribuição. "sem_categoria" = respostas avaliadas só com a rubrica antiga.
CREATE VIEW avaliacao.resultados_categorias AS
SELECT execucao_id, sistema_id, sistema, nosso, municipio_id, conjunto_id, agente_versao,
       motivo, amostra, estado, iniciada_em, terminada_em, categoria,
       count(*) FILTER (WHERE erro IS NULL AND cat IS NOT NULL)::int AS total,
       count(*) FILTER (WHERE cat = 'certa')::int AS certa,
       count(*) FILTER (WHERE cat = 'maioritariamente_certa')::int AS maioritariamente_certa,
       count(*) FILTER (WHERE cat = 'parcialmente_certa')::int AS parcialmente_certa,
       count(*) FILTER (WHERE cat = 'maioritariamente_errada')::int AS maioritariamente_errada,
       count(*) FILTER (WHERE cat = 'errada')::int AS errada,
       count(*) FILTER (WHERE cat = 'mandou_contactar')::int AS mandou_contactar,
       count(*) FILTER (WHERE cat = 'nao_encontrou')::int AS nao_encontrou,
       count(*) FILTER (WHERE cat = 'inconclusiva')::int AS inconclusiva,
       count(*) FILTER (WHERE cat = 'sem_resposta')::int AS sem_resposta,
       count(*) FILTER (WHERE suficiente = 'sim')::int AS suficiente_sim,
       count(*) FILTER (WHERE suficiente = 'em_parte')::int AS suficiente_em_parte,
       count(*) FILTER (WHERE suficiente = 'nao')::int AS suficiente_nao,
       count(*) FILTER (WHERE erro IS NOT NULL)::int AS por_responder,
       count(*) FILTER (WHERE erro IS NULL AND cat IS NULL AND avaliada)::int AS sem_categoria,
       count(*) FILTER (WHERE erro IS NULL AND NOT avaliada)::int AS por_avaliar,
       round(avg(CASE cat WHEN 'certa' THEN 100 WHEN 'maioritariamente_certa' THEN 75
                          WHEN 'parcialmente_certa' THEN 50 WHEN 'maioritariamente_errada' THEN 25
                          ELSE 0 END) FILTER (WHERE erro IS NULL AND cat IS NOT NULL), 2) AS nota
FROM (
  SELECT e.id AS execucao_id, e.sistema_id, s.nome AS sistema, s.nosso, s.municipio_id, e.conjunto_id, e.agente_versao, e.motivo, e.amostra, e.estado, e.iniciada_em, e.terminada_em, p.categoria, r.erro,
         c.categoria AS cat, c.suficiente, EXISTS (SELECT 1 FROM avaliacao.avaliacoes a WHERE a.resposta_id = r.id) AS avaliada
    FROM avaliacao.execucoes e
    JOIN avaliacao.sistemas s ON s.id = e.sistema_id
    JOIN avaliacao.respostas r ON r.execucao_id = e.id
    JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
    LEFT JOIN avaliacao.avaliacao_final_categoria c ON c.resposta_id = r.id
  UNION ALL
  SELECT e.id AS execucao_id, e.sistema_id, s.nome AS sistema, s.nosso, s.municipio_id, e.conjunto_id, e.agente_versao, e.motivo, e.amostra, e.estado, e.iniciada_em, e.terminada_em, NULL::text, r.erro,
         c.categoria AS cat, c.suficiente, EXISTS (SELECT 1 FROM avaliacao.avaliacoes a WHERE a.resposta_id = r.id) AS avaliada
    FROM avaliacao.execucoes e
    JOIN avaliacao.sistemas s ON s.id = e.sistema_id
    JOIN avaliacao.respostas r ON r.execucao_id = e.id
    JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
    LEFT JOIN avaliacao.avaliacao_final_categoria c ON c.resposta_id = r.id
) x
GROUP BY execucao_id, sistema_id, sistema, nosso, municipio_id, conjunto_id, agente_versao,
         motivo, amostra, estado, iniciada_em, terminada_em, categoria;
