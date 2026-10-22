-- App do munícipe (Flutter, Android) com notificações por Firebase Cloud
-- Messaging. A pessoa entra com o telemóvel (código por SMS, como no chat e
-- na porta para as IAs) e fica com uma sessão longa e revogável: só o hash
-- do token fica na BD. Cada telemóvel regista o seu token FCM; os envios
-- ficam em push_enviados para o painel.

-- O código de 6 dígitos para entrar (só o hash).
CREATE TABLE app_codigos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  telefone_e164  text NOT NULL,
  codigo_hash    bytea NOT NULL,
  tentativas     integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_codigos_telefone_idx ON app_codigos (municipio_id, telefone_e164, criado_em DESC);

-- Uma sessão por instalação da app. O token sai uma vez, ao entrar.
CREATE TABLE app_sessoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  municipe_id    uuid NOT NULL REFERENCES municipes(id),
  token_hash     bytea NOT NULL UNIQUE,
  token_fim      text NOT NULL,                       -- últimos 4 caracteres, para a reconhecer
  dispositivo    text CHECK (length(dispositivo) <= 120),  -- "Samsung A52" (o que a app disser)
  ultimo_uso_em  timestamptz,
  revogada_em    timestamptz,
  revogada_por   text CHECK (revogada_por IN ('municipe','camara','sistema')),
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_sessoes_municipe_idx ON app_sessoes (municipe_id) WHERE revogada_em IS NULL;
CREATE INDEX app_sessoes_lista_idx ON app_sessoes (municipio_id, criada_em DESC);

-- Os telemóveis com a app, para o push. O token FCM pode mudar (a app volta
-- a registar: upsert pelo token); um token que o FCM diga UNREGISTERED fica
-- inativo.
CREATE TABLE app_dispositivos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  municipe_id         uuid NOT NULL REFERENCES municipes(id),
  sessao_id           uuid REFERENCES app_sessoes(id),
  fcm_token           text NOT NULL UNIQUE CHECK (length(fcm_token) BETWEEN 20 AND 4096),
  plataforma          text NOT NULL DEFAULT 'android' CHECK (plataforma IN ('android')),
  idioma              text NOT NULL DEFAULT 'pt-PT',
  versao_app          text,
  ativo               boolean NOT NULL DEFAULT true,
  desativado_em       timestamptz,
  motivo_desativacao  text CHECK (motivo_desativacao IN ('token_invalido','removido','sessao_terminada')),
  ultimo_push_em      timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_dispositivos_municipe_idx ON app_dispositivos (municipe_id) WHERE ativo;
CREATE INDEX app_dispositivos_municipio_idx ON app_dispositivos (municipio_id) WHERE ativo;

-- O que a pessoa quer receber na app. Os urgentes (emergências) não se
-- desligam. A zona serve para os avisos por zona.
CREATE TABLE app_preferencias (
  municipe_id    uuid PRIMARY KEY REFERENCES municipes(id),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  avisos         boolean NOT NULL DEFAULT true,       -- avisos por zona (obras, água, trânsito...)
  processos      boolean NOT NULL DEFAULT true,       -- os seus pedidos: processos, pagamentos, marcações
  freguesia      text CHECK (length(freguesia) <= 120),
  morada         text CHECK (length(morada) <= 300),
  lat            double precision CHECK (lat BETWEEN -90 AND 90),
  lng            double precision CHECK (lng BETWEEN -180 AND 180),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- Cada push enviado (ou tentado), por dispositivo. Sem o token em claro.
CREATE TABLE push_enviados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  municipe_id     uuid NOT NULL REFERENCES municipes(id),
  dispositivo_id  uuid NOT NULL REFERENCES app_dispositivos(id),
  tipo            text NOT NULL CHECK (tipo IN ('urgente','avisos','processos')),
  origem          text NOT NULL CHECK (length(origem) BETWEEN 1 AND 60),  -- 'emergencia', 'aviso_zona', 'processo_fase'...
  titulo          text NOT NULL,
  corpo           text NOT NULL,
  dados           jsonb NOT NULL DEFAULT '{}',
  estado          text NOT NULL DEFAULT 'pendente'
                    CHECK (estado IN ('pendente','enviado','enviado_teste','falhado','token_invalido')),
  erro            text,
  fcm_id          text,                               -- "projects/x/messages/123"
  chave           text UNIQUE,                        -- idempotência: <origem>:<id>:<dispositivo>
  criado_em       timestamptz NOT NULL DEFAULT now(),
  enviado_em      timestamptz
);
CREATE INDEX push_enviados_painel_idx ON push_enviados (municipio_id, criado_em DESC);
CREATE INDEX push_enviados_municipe_idx ON push_enviados (municipe_id, criado_em DESC);
