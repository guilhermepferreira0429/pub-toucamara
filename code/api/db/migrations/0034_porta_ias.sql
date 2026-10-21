-- Porta para as IAs: um servidor MCP com as mesmas ferramentas do agente,
-- para o assistente de cada pessoa (Claude, ChatGPT, ...) falar com a câmara.
-- Sem chave só há informação pública (procurar, encaminhar, simular taxas);
-- com a chave pessoal, ligada ao número verificado por SMS, o assistente age
-- em nome da pessoa (ocorrências, marcações, processos, requerimentos).

-- Conversas feitas por um assistente de IA (uma por sessão MCP).
ALTER TYPE canal ADD VALUE IF NOT EXISTS 'ia';

-- A autorização da pessoa: uma chave por assistente. Só se guarda o hash;
-- a chave aparece uma vez, no fim da verificação.
CREATE TABLE ligacoes_ia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  municipe_id    uuid NOT NULL REFERENCES municipes(id),
  assistente     text NOT NULL CHECK (length(assistente) BETWEEN 1 AND 60),
  chave_hash     bytea NOT NULL UNIQUE,
  chave_fim      text NOT NULL,                 -- últimos 4 caracteres, para a reconhecer
  pedidos        integer NOT NULL DEFAULT 0 CHECK (pedidos >= 0),
  ultimo_uso_em  timestamptz,
  revogada_em    timestamptz,
  revogada_por   text CHECK (revogada_por IN ('municipe','camara')),
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ligacoes_ia_lista_idx ON ligacoes_ia (municipio_id, criada_em DESC, id DESC);
CREATE INDEX ligacoes_ia_municipe_idx ON ligacoes_ia (municipe_id) WHERE revogada_em IS NULL;

-- O código por SMS que autoriza a ligação (o mesmo esquema do chat).
CREATE TABLE ligacao_ia_codigos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  telefone_e164  text NOT NULL,
  assistente     text NOT NULL,
  codigo_hash    bytea NOT NULL,
  tentativas     integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  ligacao_id     uuid REFERENCES ligacoes_ia(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- Cada ferramenta que um assistente chamou (o feed do painel e a auditoria).
-- Sem a entrada em claro: só o resumo que o painel mostra.
CREATE TABLE ligacao_ia_pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  ligacao_id     uuid REFERENCES ligacoes_ia(id),   -- NULL = acesso público, sem chave
  conversa_id    uuid REFERENCES conversas(id),
  cliente        text,                              -- clientInfo.name do MCP (ex.: "claude-ai")
  ferramenta     text NOT NULL,
  ok             boolean NOT NULL,
  erro_codigo    text,
  resumo         text,
  duracao_ms     integer NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ligacao_ia_pedidos_lista_idx ON ligacao_ia_pedidos (municipio_id, criado_em DESC, id DESC);
CREATE INDEX ligacao_ia_pedidos_ligacao_idx ON ligacao_ia_pedidos (ligacao_id, criado_em DESC);
