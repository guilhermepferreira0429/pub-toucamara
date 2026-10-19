-- Vistas materializadas do painel (secção 4.13 do plano).
--
-- O painel não agrega as tabelas a cada pedido: lê estas vistas, que o job
-- `refrescar_vistas` atualiza a cada 5 minutos com REFRESH ... CONCURRENTLY
-- (por isso cada uma tem um índice único só com colunas, sem WHERE).
--
-- Dias e horas no fuso de cada município (`AT TIME ZONE municipios.fuso`).
-- Guardam os últimos 400 dias: chega para comparar um mês com o anterior e um
-- ano de relatórios. Granularidade ao dia: a semana, o mês ou um período
-- qualquer (?de=&ate=) somam-se na consulta.

-- ----------------------------------------------------------------------
-- "Quando ligam e escrevem": mapa de calor dia da semana × hora.
-- ----------------------------------------------------------------------
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
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_conversas_por_hora_uq ON mv_conversas_por_hora (municipio_id, dia, hora);

-- ----------------------------------------------------------------------
-- "O que mais perguntam": conversas por tema e dia (a variação calcula-se
-- na consulta, contra o período anterior do mesmo tamanho).
-- ----------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_temas_periodo AS
SELECT c.municipio_id,
       (c.iniciada_em AT TIME ZONE m.fuso)::date AS dia,
       c.tema_id,
       count(*)::int                             AS total
FROM conversas c
JOIN municipios m ON m.id = c.municipio_id
WHERE c.tema_id IS NOT NULL
  AND c.iniciada_em >= now() - interval '400 days'
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_temas_periodo_uq ON mv_temas_periodo (municipio_id, dia, tema_id);

-- ----------------------------------------------------------------------
-- Indicadores: resultado das conversas por dia e canal.
--   resolvidas_sem_humano = resultado 'resolvida' ou 'marcacao' (o agente
--   acabou o assunto sozinho); passadas = 'passada_funcionario';
--   terminadas = tudo menos 'em_curso' (base das percentagens).
-- ----------------------------------------------------------------------
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
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_resultados_periodo_uq ON mv_resultados_periodo (municipio_id, dia, canal);

-- ----------------------------------------------------------------------
-- "O que o agente tratou" e a operação à volta, por dia. Cada número:
--   requerimentos         requerimentos criados numa conversa (pelo agente)
--   ocorrencias_agente    ocorrências registadas numa conversa (pelo agente)
--   consultas_processo    consultas de processo feitas pelo agente: linhas do
--                         audit_log com ator 'agente' e objeto 'processo'
--   referencias_mb        referências Multibanco geradas (pagamentos com referência)
--   pagamentos_pagos      pagamentos confirmados (por pago_em); pagos_cent = soma
--   marcacoes             marcações feitas numa conversa (dia da conversa)
--   recolhas              recolhas marcadas numa conversa (dia da conversa)
--   passagens             passagens a um funcionário (por criada_em)
--   ocorrencias           todas as ocorrências registadas (qualquer canal)
--   ocorrencias_resolvidas ocorrências resolvidas nesse dia; horas_resolucao =
--                         soma das horas entre registo e resolução
--   sms_enviados          SMS enviados (por enviada_em); sms_segmentos e
--                         sms_custo_cent somados
-- ----------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_trabalho_feito_semana AS
WITH ev AS (
  SELECT municipio_id, criado_em AS em, 'requerimento' AS k, 0::numeric AS v, 0::numeric AS v2
    FROM requerimentos WHERE conversa_id IS NOT NULL
  UNION ALL
  SELECT municipio_id, criada_em, 'ocorrencia_agente', 0, 0
    FROM ocorrencias WHERE conversa_id IS NOT NULL
  UNION ALL
  SELECT municipio_id, criada_em, 'ocorrencia', 0, 0
    FROM ocorrencias
  UNION ALL
  SELECT municipio_id, resolvida_em, 'ocorrencia_resolvida',
         extract(epoch FROM resolvida_em - criada_em) / 3600, 0
    FROM ocorrencias WHERE resolvida_em IS NOT NULL
  UNION ALL
  SELECT municipio_id, criado_em, 'referencia_mb', 0, 0
    FROM pagamentos WHERE mb_referencia IS NOT NULL
  UNION ALL
  SELECT municipio_id, pago_em, 'pagamento', valor_cent, 0
    FROM pagamentos WHERE pago_em IS NOT NULL
  UNION ALL
  SELECT c.municipio_id, c.iniciada_em, 'marcacao', 0, 0
    FROM marcacoes mc JOIN conversas c ON c.id = mc.conversa_id
  UNION ALL
  SELECT r.municipio_id, c.iniciada_em, 'recolha', 0, 0
    FROM recolhas r JOIN conversas c ON c.id = r.conversa_id
  UNION ALL
  SELECT c.municipio_id, p.criada_em, 'passagem', 0, 0
    FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
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

-- ----------------------------------------------------------------------
-- V2 · processos em curso (fotografia do momento, sem arquivados): carga por
-- fase e técnico, atrasados (prazo_fim já passou no fuso do município) e
-- dias médios na fase atual (desde o último evento 'fase' ou a criação).
-- ----------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_processos_fases AS
SELECT p.municipio_id,
       p.fase,
       p.tecnico_id,
       count(*)::int AS total,
       count(*) FILTER (WHERE p.fase <> 'notificado'
                          AND p.prazo_fim < (now() AT TIME ZONE m.fuso)::date)::int AS atrasados,
       round(avg(extract(epoch FROM now() - coalesce(f.desde, p.criado_em)) / 86400), 1)::float8
                                                                              AS dias_medios_na_fase
FROM processos p
JOIN municipios m ON m.id = p.municipio_id
LEFT JOIN LATERAL (
  SELECT max(e.em) AS desde FROM processo_eventos e
  WHERE e.processo_id = p.id AND e.tipo = 'fase'
) f ON true
WHERE p.fase <> 'arquivado'
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_processos_fases_uq ON mv_processos_fases (municipio_id, fase, tecnico_id) NULLS NOT DISTINCT;

-- ----------------------------------------------------------------------
-- Relatórios: um por (município, tipo, período). Os jobs semanal e mensal
-- podem repetir sem criar outro.
-- ----------------------------------------------------------------------
CREATE UNIQUE INDEX relatorios_periodo_uq ON relatorios (municipio_id, tipo, periodo);
