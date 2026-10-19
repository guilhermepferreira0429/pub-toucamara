-- Apoio ao técnico no painel dos processos (19 out.): resumo do processo
-- numa página, regulamento aplicável destacado e rascunhos de ofício, pedido
-- de elementos ou SMS que o técnico só aprova.

-- Resumo e regulamento ficam em cache por processo. `estado_hash` resume o
-- estado do processo quando foram gerados (fase, prazos, eventos, documentos,
-- pedidos, requerimento; no regulamento também a última leitura das fontes):
-- só se volta a chamar a IA se o hash mudou ou o técnico pedir.
CREATE TABLE processo_apoio (
  processo_id  uuid NOT NULL REFERENCES processos(id),
  tipo         text NOT NULL CHECK (tipo IN ('resumo','regulamento')),
  estado_hash  text NOT NULL,
  conteudo     jsonb NOT NULL,
  gerado_em    timestamptz NOT NULL DEFAULT now(),
  gerado_por   uuid REFERENCES utilizadores(id),
  PRIMARY KEY (processo_id, tipo)
);

-- documentos_gerados (0001, V2) passa a servir os rascunhos do técnico.
-- O pedido de elementos é um tipo próprio (e não um 'oficio' com marca): ao
-- aprovar cria pedidos com prazo ao munícipe, e o painel filtra por tipo.
-- 'descartado' fecha um rascunho sem o apagar (fica o rasto).
ALTER TABLE documentos_gerados DROP CONSTRAINT documentos_gerados_tipo_check;
ALTER TABLE documentos_gerados ADD CONSTRAINT documentos_gerados_tipo_check
  CHECK (tipo IN ('parecer','oficio','pedido_elementos','notificacao_sms'));
ALTER TABLE documentos_gerados DROP CONSTRAINT documentos_gerados_estado_check;
ALTER TABLE documentos_gerados ADD CONSTRAINT documentos_gerados_estado_check
  CHECK (estado IN ('rascunho','aprovado','assinado','enviado','descartado'));

ALTER TABLE documentos_gerados
  ADD COLUMN instrucoes    text,                      -- o que o técnico pediu à IA
  -- documentos pedidos [{tipo_documento_id, nome}], prazo_dias_uteis, artigos
  -- citados; depois de aprovar: evento_id, pedido_ids, aviso
  ADD COLUMN dados         jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN criado_por    uuid REFERENCES utilizadores(id),
  ADD COLUMN criado_em     timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN descartado_por uuid REFERENCES utilizadores(id),
  ADD COLUMN descartado_em timestamptz;
CREATE INDEX documentos_gerados_processo_idx ON documentos_gerados (processo_id, criado_em);

-- Todas as versões do corpo (a 1 é a da IA; as seguintes, edições do
-- técnico). `documentos_gerados.corpo/versao` é sempre a última.
CREATE TABLE documento_gerado_versoes (
  documento_id uuid NOT NULL REFERENCES documentos_gerados(id),
  versao       integer NOT NULL,
  corpo        text NOT NULL,
  origem       text NOT NULL CHECK (origem IN ('ia','tecnico')),
  autor_id     uuid REFERENCES utilizadores(id),
  em           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id, versao)
);
