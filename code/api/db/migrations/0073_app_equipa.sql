-- App da equipa de campo ("Tou, Câmara · Equipa", Flutter, Android).
--
-- Entrar no telemóvel: o utilizador do painel pede um código de 6 dígitos
-- por email (só o hash na BD, 10 minutos, 5 tentativas) e recebe um JWT do
-- painel com o id de uma sessão de dispositivo (`sid`). A sessão é longa e
-- revogável: o PainelGuard aceita o JWT só enquanto a sessão não estiver
-- revogada. Sem municipio_id nestas tabelas: são lidas antes de o município
-- do pedido estar resolvido (como `links_magicos`).

CREATE TABLE painel_app_codigos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizador_id  uuid NOT NULL REFERENCES utilizadores(id),
  codigo_hash    bytea NOT NULL,
  tentativas     integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX painel_app_codigos_utilizador_idx ON painel_app_codigos (utilizador_id, criado_em DESC);

CREATE TABLE painel_app_sessoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizador_id  uuid NOT NULL REFERENCES utilizadores(id),
  dispositivo    text CHECK (length(dispositivo) <= 120),   -- "Samsung A52" (o que a app disser)
  expira_em      timestamptz NOT NULL,
  ultimo_uso_em  timestamptz,
  revogada_em    timestamptz,
  revogada_por   text CHECK (revogada_por IN ('utilizador','chefia','sistema')),
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX painel_app_sessoes_utilizador_idx ON painel_app_sessoes (utilizador_id) WHERE revogada_em IS NULL;

-- A fotografia "do depois" que a equipa tira ao fechar a ocorrência fica
-- junto das do munícipe, marcada pela origem.
ALTER TABLE ocorrencia_fotos
  ADD COLUMN origem     text NOT NULL DEFAULT 'municipe' CHECK (origem IN ('municipe','equipa')),
  ADD COLUMN enviada_por uuid REFERENCES utilizadores(id),
  ADD COLUMN legenda    text CHECK (length(legenda) <= 300),
  ADD COLUMN lat        double precision CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng        double precision CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN tirada_em  timestamptz;

-- Onde e quando o fiscal tirou a fotografia (GPS e hora do telemóvel).
ALTER TABLE fiscalizacao_fotos
  ADD COLUMN lat        double precision CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng        double precision CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN tirada_em  timestamptz;
