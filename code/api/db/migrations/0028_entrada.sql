-- Caixa de entrada única (V2): telefone, chat, email e balcão numa lista só,
-- com o encaminhamento automático para o serviço e o técnico certos.
--
-- Cada fonte continua na sua tabela (passagens_humano, emails_entrada,
-- processos, ocorrencias); a vista `entrada_itens` junta-as com colunas
-- comuns. O que não tem tabela própria (atendimento ao balcão e "outros")
-- fica em `pedidos_entrada`.

-- Atendimentos registados no painel (o funcionário do balcão escreve o que o
-- munícipe pediu). A conversa canal 'balcao' guarda o resumo como turno.
CREATE TABLE pedidos_entrada (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  tipo            text NOT NULL DEFAULT 'balcao' CHECK (tipo IN ('balcao','outro')),
  canal           canal NOT NULL DEFAULT 'balcao',
  municipe_id     uuid REFERENCES municipes(id),
  conversa_id     uuid REFERENCES conversas(id),
  assunto         text NOT NULL,
  descricao       text NOT NULL,
  servico_id      uuid REFERENCES servicos(id),
  tecnico_id      uuid REFERENCES utilizadores(id),
  urgente         boolean NOT NULL DEFAULT false,
  prazo_resposta  timestamptz,
  estado          text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','virou_processo','fechado')),
  processo_id     uuid REFERENCES processos(id),
  criado_por      uuid REFERENCES utilizadores(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  fechado_em      timestamptz
);
CREATE INDEX pedidos_entrada_abertos_idx ON pedidos_entrada (municipio_id, criado_em DESC)
  WHERE estado = 'aberto';
-- Carga dos técnicos (encaminhamento).
CREATE INDEX pedidos_entrada_tecnico_idx ON pedidos_entrada (tecnico_id)
  WHERE estado = 'aberto' AND tecnico_id IS NOT NULL;
CREATE INDEX pedidos_entrada_processo_idx ON pedidos_entrada (processo_id)
  WHERE processo_id IS NOT NULL;
-- O canal de um processo que nasceu de um email (vista abaixo).
CREATE INDEX emails_entrada_processo_idx ON emails_entrada (processo_id)
  WHERE processo_id IS NOT NULL;

-- Registo de cada decisão de encaminhamento (automática ou manual), com o
-- motivo ("serviço do tipo de processo CP; menor carga: 3 abertos"). Uma só
-- automática por item: é o que impede o job de decidir duas vezes. Ao
-- reatribuir à mão, a automática fica `desfeito_em`.
CREATE TABLE encaminhamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  item_tipo     text NOT NULL CHECK (item_tipo IN ('passagem','email','processo','ocorrencia','pedido')),
  item_id       uuid NOT NULL,
  servico_id    uuid REFERENCES servicos(id),
  tecnico_id    uuid REFERENCES utilizadores(id),
  motivo        text NOT NULL,
  automatico    boolean NOT NULL,
  criado_por    uuid REFERENCES utilizadores(id),   -- NULL = automático
  criado_em     timestamptz NOT NULL DEFAULT now(),
  desfeito_em   timestamptz,
  desfeito_por  uuid REFERENCES utilizadores(id)
);
CREATE UNIQUE INDEX encaminhamentos_auto_uq ON encaminhamentos (item_tipo, item_id) WHERE automatico;
CREATE INDEX encaminhamentos_item_idx ON encaminhamentos (item_tipo, item_id, criado_em DESC);

-- Por município: o encaminhamento automático vem DESLIGADO; a chefia ativa.
CREATE TABLE entrada_config (
  municipio_id      uuid PRIMARY KEY REFERENCES municipios(id),
  ativo             boolean NOT NULL DEFAULT false,
  atribuir_tecnico  boolean NOT NULL DEFAULT true,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_por    uuid REFERENCES utilizadores(id)
);

-- A caixa de entrada: o que espera por alguém, de todos os canais.
--   passagem    passagens a funcionário por responder (aberta, em_curso)
--   email       email geral por tratar (nova)
--   processo    processos não fechados ainda na entrada ou sem técnico
--   ocorrencia  ocorrências novas sem serviço
--   pedido      atendimentos de balcão e outros, abertos
-- servico_id da passagem e do processo (que não têm a coluna): o último
-- encaminhamento em vigor, senão o do técnico (passagem) ou o do tipo
-- (processo). urgente: marcado à mão ou prazo nas próximas 24 h.
-- prazo_resposta: o da passagem e do processo; email 2 dias depois de
-- chegar; ocorrência 1 dia para ser triada. servico_sugerido_*: a regra
-- determinística para o encaminhamento. pronto: o email já passou pela
-- triagem (ou esperou 15 min por ela).
CREATE VIEW entrada_itens AS
WITH base AS (
  SELECT 'passagem'::text AS tipo, p.id, c.municipio_id,
         CASE c.canal WHEN 'sms' THEN 'telefone' WHEN 'whatsapp' THEN 'chat' ELSE c.canal::text END AS canal,
         coalesce(t.nome, 'Pedido para falar com um funcionário') AS assunto,
         left(p.resumo, 300) AS resumo,
         c.municipe_id, NULL::text AS contacto,
         coalesce(enc.servico_id, u.servico_id) AS servico_id,
         p.atribuida_a AS tecnico_id,
         p.estado, false AS marcado_urgente,
         p.responder_ate AS prazo_resposta,
         p.criada_em AS criado_em,
         true AS atribui_tecnico, true AS pronto,
         rq.servico_id AS servico_sugerido_id,
         CASE WHEN rq.servico_id IS NOT NULL
              THEN 'serviço do tipo de processo ' || rq.codigo || ' (requerimento da conversa)' END AS servico_sugerido_motivo,
         p.resumo AS texto
  FROM passagens_humano p
  JOIN conversas c ON c.id = p.conversa_id
  LEFT JOIN temas t ON t.id = c.tema_id
  LEFT JOIN utilizadores u ON u.id = p.atribuida_a
  LEFT JOIN LATERAL (
    SELECT e.servico_id FROM encaminhamentos e
    WHERE e.item_tipo = 'passagem' AND e.item_id = p.id
      AND e.desfeito_em IS NULL AND e.servico_id IS NOT NULL
    ORDER BY e.criado_em DESC LIMIT 1) enc ON true
  LEFT JOIN LATERAL (
    SELECT tp.servico_id, tp.codigo FROM requerimentos r
    JOIN tipos_processo tp ON tp.id = r.tipo_processo_id
    WHERE r.conversa_id = c.id AND tp.servico_id IS NOT NULL
    ORDER BY r.criado_em DESC LIMIT 1) rq ON true
  WHERE p.estado IN ('aberta','em_curso')

  UNION ALL
  SELECT 'email', ee.id, ee.municipio_id, 'email',
         coalesce(nullif(btrim(ee.assunto), ''), '(sem assunto)'),
         left(ee.corpo, 300),
         (SELECT mu.id FROM municipes mu
          WHERE mu.municipio_id = ee.municipio_id AND mu.email = ee.de AND mu.anonimizado_em IS NULL
          ORDER BY mu.criado_em LIMIT 1),
         ee.de::text,
         ee.servico_id, NULL::uuid,
         ee.estado, false,
         ee.recebido_em + interval '2 days',
         ee.recebido_em,
         false, (ee.classificado_em IS NOT NULL OR ee.recebido_em < now() - interval '15 minutes'),
         NULL::uuid, NULL::text,
         coalesce(ee.assunto, '') || E'\n\n' || left(ee.corpo, 4000)
  FROM emails_entrada ee
  WHERE ee.estado = 'nova'

  UNION ALL
  SELECT 'processo', p.id, p.municipio_id,
         coalesce(
           CASE c.canal WHEN 'sms' THEN 'telefone' WHEN 'whatsapp' THEN 'chat' ELSE c.canal::text END,
           (SELECT pe.canal::text FROM pedidos_entrada pe WHERE pe.processo_id = p.id LIMIT 1),
           (SELECT 'email' FROM emails_entrada ee WHERE ee.processo_id = p.id LIMIT 1),
           'chat'),
         p.numero || ' · ' || p.assunto,
         left(tp.nome, 300),
         p.municipe_id, NULL::text,
         coalesce(enc.servico_id, tp.servico_id),
         p.tecnico_id,
         p.fase::text, false,
         (p.prazo_fim + 1)::timestamp AT TIME ZONE m.fuso,
         p.criado_em,
         true, true,
         tp.servico_id,
         CASE WHEN tp.servico_id IS NOT NULL THEN 'serviço do tipo de processo ' || tp.codigo END,
         tp.nome || E'\n\n' || p.assunto
  FROM processos p
  JOIN tipos_processo tp ON tp.id = p.tipo_processo_id
  JOIN municipios m ON m.id = p.municipio_id
  LEFT JOIN conversas c ON c.id = p.conversa_origem_id
  LEFT JOIN LATERAL (
    SELECT e.servico_id FROM encaminhamentos e
    WHERE e.item_tipo = 'processo' AND e.item_id = p.id
      AND e.desfeito_em IS NULL AND e.servico_id IS NOT NULL
    ORDER BY e.criado_em DESC LIMIT 1) enc ON true
  WHERE p.fase NOT IN ('notificado','arquivado')
    AND (p.tecnico_id IS NULL OR p.fase = 'entrada')

  UNION ALL
  SELECT 'ocorrencia', o.id, o.municipio_id,
         coalesce(CASE c.canal WHEN 'sms' THEN 'telefone' WHEN 'whatsapp' THEN 'chat' ELSE c.canal::text END, 'chat'),
         o.numero || ' · ' || cat.nome,
         left(o.descricao || ' (' || o.morada || ')', 300),
         o.municipe_id, NULL::text,
         o.servico_id, NULL::uuid,
         o.estado::text, false,
         o.criada_em + interval '1 day',
         o.criada_em,
         false, true,
         cat.servico_id,
         CASE WHEN cat.servico_id IS NOT NULL THEN 'serviço da categoria ' || cat.nome END,
         cat.nome || E'\n\n' || o.descricao
  FROM ocorrencias o
  JOIN categorias_ocorrencia cat ON cat.id = o.categoria_id
  LEFT JOIN conversas c ON c.id = o.conversa_id
  WHERE o.estado = 'nova' AND o.servico_id IS NULL AND o.duplicada_de IS NULL

  UNION ALL
  SELECT 'pedido', pe.id, pe.municipio_id, pe.canal::text,
         pe.assunto, left(pe.descricao, 300),
         pe.municipe_id, NULL::text,
         pe.servico_id, pe.tecnico_id,
         pe.estado, pe.urgente,
         pe.prazo_resposta,
         pe.criado_em,
         true, true,
         NULL::uuid, NULL::text,
         pe.assunto || E'\n\n' || left(pe.descricao, 4000)
  FROM pedidos_entrada pe
  WHERE pe.estado = 'aberto'
)
SELECT tipo, id, municipio_id, canal, assunto, resumo, municipe_id, contacto,
       servico_id, tecnico_id, estado,
       (marcado_urgente OR coalesce(prazo_resposta <= now() + interval '24 hours', false)) AS urgente,
       prazo_resposta, criado_em, atribui_tecnico, pronto,
       servico_sugerido_id, servico_sugerido_motivo, texto
FROM base;
