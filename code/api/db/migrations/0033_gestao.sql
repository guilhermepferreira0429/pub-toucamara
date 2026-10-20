-- V2 · Gestão e indicadores (painel, /v1/painel/gestao/*): a história das
-- fases de cada processo, para o tempo médio em cada fase e o "normal" de
-- cada fase (percentil 75) em "onde os processos ficam parados".
--
-- Uma linha por passagem de um processo por uma fase (segmento), a partir dos
-- eventos 'fase' de `processo_eventos` (dados {de, para}, escritos pelo painel
-- dos processos, o único sítio que muda a fase):
--   ordem 0   da entrada (criado_em) até à primeira mudança de fase, na fase
--             `de` dessa mudança (sem `de`: 'entrada'); sem nenhuma mudança,
--             na fase atual.
--   ordem n   do n-ésimo evento 'fase' até ao seguinte, na fase `para`.
--   fim       início do segmento seguinte; NULL = é a fase atual.
--   coerente  false quando o evento seguinte diz que saiu de outra fase (falta
--             um evento pelo meio): o tempo fica na última fase conhecida.
-- Eventos com uma fase que não existe no enum ficam de fora.
--
-- Dias no fuso do município; os dias úteis contam-se na API (feriados).
-- Refrescada pelo job `refrescar_vistas` com as outras (CONCURRENTLY: índice
-- único só com colunas).
CREATE MATERIALIZED VIEW mv_processos_fases_historia AS
WITH ev AS (
  SELECT e.processo_id, e.em, e.id,
         nullif(e.dados->>'de', '')  AS de,
         e.dados->>'para'            AS para
  FROM processo_eventos e
  WHERE e.tipo = 'fase'
    AND e.dados->>'para' = ANY (ARRAY(SELECT unnest(enum_range(NULL::fase_processo))::text))
),
numerados AS (
  SELECT ev.*, row_number() OVER (PARTITION BY ev.processo_id ORDER BY ev.em, ev.id) AS ordem
  FROM ev
),
inicios AS (
  -- Segmento 0: a fase de entrada (o `de` da primeira mudança).
  SELECT p.id AS processo_id, p.criado_em AS inicio, 0::bigint AS ordem,
         CASE WHEN pr.processo_id IS NULL THEN p.fase::text
              WHEN pr.de = ANY (ARRAY(SELECT unnest(enum_range(NULL::fase_processo))::text)) THEN pr.de
              ELSE 'entrada' END AS fase,
         NULL::text AS de
  FROM processos p
  LEFT JOIN numerados pr ON pr.processo_id = p.id AND pr.ordem = 1
  UNION ALL
  -- Segmentos 1..n: cada mudança de fase.
  SELECT n.processo_id, n.em, n.ordem, n.para, n.de
  FROM numerados n
),
seg AS (
  SELECT i.*,
         lead(i.inicio) OVER w AS fim,
         lead(i.de) OVER w     AS de_seguinte
  FROM inicios i
  WINDOW w AS (PARTITION BY i.processo_id ORDER BY i.ordem)
)
SELECT p.municipio_id,
       s.processo_id,
       p.tipo_processo_id,
       s.ordem::int                                      AS ordem,
       s.fase::fase_processo                             AS fase,
       s.inicio,
       s.fim,
       (s.inicio AT TIME ZONE m.fuso)::date              AS inicio_dia,
       (s.fim AT TIME ZONE m.fuso)::date                 AS fim_dia,
       (s.de_seguinte IS NULL OR s.de_seguinte = s.fase) AS coerente
FROM seg s
JOIN processos p  ON p.id = s.processo_id
JOIN municipios m ON m.id = p.municipio_id;

CREATE UNIQUE INDEX mv_processos_fases_historia_uq ON mv_processos_fases_historia (processo_id, ordem);
-- O "normal" de cada fase: segmentos acabados no último ano, por município.
CREATE INDEX mv_processos_fases_historia_fim_idx ON mv_processos_fases_historia (municipio_id, fim_dia)
  WHERE fim IS NOT NULL;

-- Tempos: processos decididos num período.
CREATE INDEX processos_decididos_idx ON processos (municipio_id, decidido_em)
  WHERE decidido_em IS NOT NULL;
-- Atrasados: em curso por prazo (a lista paginada por (prazo_fim, id)).
CREATE INDEX processos_em_curso_prazo_idx ON processos (municipio_id, prazo_fim, id)
  WHERE fase NOT IN ('notificado', 'arquivado');
