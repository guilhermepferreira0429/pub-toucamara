-- "Preparar demo": a câmara de demonstração pronta com um botão.
--
-- demo_registos: o que a preparação criou, com uma chave fixa por objeto
-- ('conversa:07', 'processo:porta_cozinha'...). Correr outra vez salta o que
-- já tem chave: é isto que torna a preparação idempotente e que marca na BD
-- o que é de demonstração.
--
-- demo_preparacoes: quando foi preparada (e por quem), com o resumo.
--
-- oculto_em: as conversas e ocorrências criadas pela equipa nos testes saem
-- do painel sem se apagarem (reversível: "repor" volta a pôr NULL). As
-- passagens a funcionário escondem-se com a sua conversa. As vistas
-- materializadas do painel passam a ignorar o que está oculto.

CREATE TABLE demo_registos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id uuid NOT NULL REFERENCES municipios(id) ON DELETE CASCADE,
  chave        text NOT NULL CHECK (chave ~ '^[a-z0-9_:.-]{3,80}$'),
  tipo         text NOT NULL,
  objeto_id    uuid NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, chave)
);
CREATE INDEX demo_registos_objeto_idx ON demo_registos (municipio_id, tipo, objeto_id);

CREATE TABLE demo_preparacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL UNIQUE REFERENCES municipios(id) ON DELETE CASCADE,
  preparada_em   timestamptz NOT NULL DEFAULT now(),
  preparada_por  uuid REFERENCES utilizadores(id) ON DELETE SET NULL,
  vezes          integer NOT NULL DEFAULT 1,
  resumo         jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE conversas ADD COLUMN oculto_em timestamptz;
ALTER TABLE ocorrencias ADD COLUMN oculto_em timestamptz;
CREATE INDEX conversas_ocultas_idx ON conversas (municipio_id) WHERE oculto_em IS NOT NULL;
CREATE INDEX ocorrencias_ocultas_idx ON ocorrencias (municipio_id) WHERE oculto_em IS NOT NULL;

-- ----------------------------------------------------------------------
-- As vistas do painel (0018) sem o que está oculto. Mesmas colunas e os
-- mesmos índices únicos (o REFRESH ... CONCURRENTLY precisa deles).
-- ----------------------------------------------------------------------
DROP MATERIALIZED VIEW mv_conversas_por_hora;
CREATE MATERIALIZED VIEW mv_conversas_por_hora AS
SELECT c.municipio_id,
       (c.iniciada_em AT TIME ZONE m.fuso)::date                      AS dia,
       extract(hour FROM c.iniciada_em AT TIME ZONE m.fuso)::int      AS hora,
       count(*)::int                                                  AS total,
       count(*) FILTER (WHERE c.canal = 'telefone')::int              AS chamadas,
       count(*) FILTER (WHERE c.canal <> 'telefone')::int             AS escritas,
       count(*) FILTER (WHERE c.fora_de_horas)::int                   AS fora_de_horas
FROM conversas c
JOIN municipios m ON m.id = c.municipio_id
WHERE c.iniciada_em >= now() - interval '400 days'
  AND c.oculto_em IS NULL
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_conversas_por_hora_uq ON mv_conversas_por_hora (municipio_id, dia, hora);

DROP MATERIALIZED VIEW mv_temas_periodo;
CREATE MATERIALIZED VIEW mv_temas_periodo AS
SELECT c.municipio_id,
       (c.iniciada_em AT TIME ZONE m.fuso)::date AS dia,
       c.tema_id,
       count(*)::int                             AS total
FROM conversas c
JOIN municipios m ON m.id = c.municipio_id
WHERE c.tema_id IS NOT NULL
  AND c.iniciada_em >= now() - interval '400 days'
  AND c.oculto_em IS NULL
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_temas_periodo_uq ON mv_temas_periodo (municipio_id, dia, tema_id);

DROP MATERIALIZED VIEW mv_resultados_periodo;
CREATE MATERIALIZED VIEW mv_resultados_periodo AS
SELECT c.municipio_id,
       (c.iniciada_em AT TIME ZONE m.fuso)::date                                    AS dia,
       c.canal,
       count(*)::int                                                                AS total,
       count(*) FILTER (WHERE c.resultado <> 'em_curso')::int                       AS terminadas,
       count(*) FILTER (WHERE c.resultado IN ('resolvida','marcacao'))::int         AS resolvidas_sem_humano,
       count(*) FILTER (WHERE c.resultado = 'passada_funcionario')::int             AS passadas,
       count(*) FILTER (WHERE c.resultado = 'sem_resposta')::int                    AS sem_resposta,
       count(*) FILTER (WHERE c.resultado = 'marcacao')::int                        AS marcacoes,
       count(*) FILTER (WHERE c.resultado = 'emergencia')::int                      AS emergencias,
       count(*) FILTER (WHERE c.resultado = 'caiu')::int                            AS caiu,
       count(*) FILTER (WHERE c.fora_de_horas)::int                                 AS fora_de_horas,
       coalesce(sum(c.duracao_s), 0)::bigint                                        AS duracao_total_s,
       count(c.duracao_s)::int                                                      AS com_duracao
FROM conversas c
JOIN municipios m ON m.id = c.municipio_id
WHERE c.iniciada_em >= now() - interval '400 days'
  AND c.oculto_em IS NULL
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_resultados_periodo_uq ON mv_resultados_periodo (municipio_id, dia, canal);

-- O trabalho da semana: as ocorrências ocultas e as passagens e marcações de
-- conversas ocultas deixam de contar.
DROP MATERIALIZED VIEW mv_trabalho_feito_semana;
CREATE MATERIALIZED VIEW mv_trabalho_feito_semana AS
WITH ev AS (
  SELECT municipio_id, criado_em AS em, 'requerimento' AS k, 0::numeric AS v, 0::numeric AS v2
    FROM requerimentos WHERE conversa_id IS NOT NULL
  UNION ALL
  SELECT municipio_id, criada_em, 'ocorrencia_agente', 0, 0
    FROM ocorrencias WHERE conversa_id IS NOT NULL AND oculto_em IS NULL
  UNION ALL
  SELECT municipio_id, criada_em, 'ocorrencia', 0, 0
    FROM ocorrencias WHERE oculto_em IS NULL
  UNION ALL
  SELECT municipio_id, resolvida_em, 'ocorrencia_resolvida',
         extract(epoch FROM resolvida_em - criada_em) / 3600, 0
    FROM ocorrencias WHERE resolvida_em IS NOT NULL AND oculto_em IS NULL
  UNION ALL
  SELECT municipio_id, criado_em, 'referencia_mb', 0, 0
    FROM pagamentos WHERE mb_referencia IS NOT NULL
  UNION ALL
  SELECT municipio_id, pago_em, 'pagamento', valor_cent, 0
    FROM pagamentos WHERE pago_em IS NOT NULL
  UNION ALL
  SELECT c.municipio_id, c.iniciada_em, 'marcacao', 0, 0
    FROM marcacoes mc JOIN conversas c ON c.id = mc.conversa_id
   WHERE c.oculto_em IS NULL
  UNION ALL
  SELECT r.municipio_id, c.iniciada_em, 'recolha', 0, 0
    FROM recolhas r JOIN conversas c ON c.id = r.conversa_id
   WHERE c.oculto_em IS NULL
  UNION ALL
  SELECT c.municipio_id, p.criada_em, 'passagem', 0, 0
    FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
   WHERE c.oculto_em IS NULL
  UNION ALL
  SELECT municipio_id, em, 'consulta_processo', 0, 0
    FROM audit_log
   WHERE ator_tipo = 'agente' AND objeto_tipo = 'processo' AND municipio_id IS NOT NULL
  UNION ALL
  SELECT municipio_id, enviada_em, 'sms', coalesce(segmentos, 1), coalesce(custo_cent, 0)
    FROM mensagens_saida
   WHERE canal = 'sms' AND enviada_em IS NOT NULL AND estado IN ('enviada','entregue')
)
SELECT ev.municipio_id,
       (ev.em AT TIME ZONE m.fuso)::date                                          AS dia,
       count(*) FILTER (WHERE k = 'requerimento')::int                            AS requerimentos,
       count(*) FILTER (WHERE k = 'ocorrencia_agente')::int                       AS ocorrencias_agente,
       count(*) FILTER (WHERE k = 'consulta_processo')::int                       AS consultas_processo,
       count(*) FILTER (WHERE k = 'referencia_mb')::int                           AS referencias_mb,
       count(*) FILTER (WHERE k = 'pagamento')::int                               AS pagamentos_pagos,
       coalesce(sum(v) FILTER (WHERE k = 'pagamento'), 0)::bigint                 AS pagos_cent,
       count(*) FILTER (WHERE k = 'marcacao')::int                                AS marcacoes,
       count(*) FILTER (WHERE k = 'recolha')::int                                 AS recolhas,
       count(*) FILTER (WHERE k = 'passagem')::int                                AS passagens,
       count(*) FILTER (WHERE k = 'ocorrencia')::int                              AS ocorrencias,
       count(*) FILTER (WHERE k = 'ocorrencia_resolvida')::int                    AS ocorrencias_resolvidas,
       coalesce(sum(v) FILTER (WHERE k = 'ocorrencia_resolvida'), 0)::float8      AS horas_resolucao,
       count(*) FILTER (WHERE k = 'sms')::int                                     AS sms_enviados,
       coalesce(sum(v) FILTER (WHERE k = 'sms'), 0)::bigint                       AS sms_segmentos,
       coalesce(sum(v2) FILTER (WHERE k = 'sms'), 0)::bigint                      AS sms_custo_cent
FROM ev
JOIN municipios m ON m.id = ev.municipio_id
WHERE ev.em >= now() - interval '400 days'
GROUP BY 1, 2;
CREATE UNIQUE INDEX mv_trabalho_feito_semana_uq ON mv_trabalho_feito_semana (municipio_id, dia);
