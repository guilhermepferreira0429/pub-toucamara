-- V2 · Login com a conta da câmara (OIDC). Um fornecedor por município; o
-- segredo do cliente fica no ambiente da API (segredo_env = nome da
-- variável), nunca na BD.
CREATE TABLE oidc_fornecedores (
  municipio_id   uuid PRIMARY KEY REFERENCES municipios(id),
  nome_botao     text NOT NULL DEFAULT 'Entrar com a conta da câmara',
  issuer         text NOT NULL,                       -- https://login.cm-exemplo.pt/realms/camara
  client_id      text NOT NULL,
  segredo_env    text,                                -- ex.: OIDC_SEGREDO_GUIMARAES (NULL = cliente público, só PKCE)
  escopos        text NOT NULL DEFAULT 'openid email profile',
  ativo          boolean NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- Pedidos de login em curso (state de uso único, 10 minutos).
CREATE TABLE oidc_pedidos (
  state_hash     bytea PRIMARY KEY,
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  nonce          text NOT NULL,
  verificador    text NOT NULL,                       -- PKCE code_verifier
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL
);
