-- Chat (identificação por SMS) e email geral (triagem e resposta).

-- O email geral de cada câmara (ex.: geral@cm-guimaraes.pt). O webhook de
-- entrada identifica o município pelo endereço "para" (ou pelo X-Municipio).
ALTER TABLE municipios ADD COLUMN email_geral citext UNIQUE;

-- Códigos de 6 dígitos para o munícipe se identificar no chat e ver os seus
-- processos. Guarda-se só o hash (HMAC com a conversa); validade 10 min;
-- no máximo 5 tentativas por código.
CREATE TABLE chat_codigos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id    uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  telefone_e164  text NOT NULL,
  codigo_hash    bytea NOT NULL,
  expira_em      timestamptz NOT NULL,
  tentativas     integer NOT NULL DEFAULT 0,
  usado_em       timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_codigos_conversa_idx ON chat_codigos (conversa_id, criado_em DESC);

-- Email geral: o que faltava para receber, classificar e responder.
ALTER TABLE emails_entrada
  ADD COLUMN para             citext,
  ADD COLUMN html             text,
  ADD COLUMN mensagem_id      text,                  -- Message-ID do email: o reencaminhamento pode repetir
  ADD COLUMN tema             text,                  -- tema livre quando não bate com `temas`
  ADD COLUMN trechos_citados  uuid[] NOT NULL DEFAULT '{}', -- fontes usadas no rascunho
  ADD COLUMN classificado_em  timestamptz,
  ADD COLUMN resposta         text,                  -- o que foi enviado ao remetente
  ADD COLUMN respondido_em    timestamptz,
  ADD COLUMN encaminhado_em   timestamptz;
CREATE UNIQUE INDEX emails_entrada_mensagem_uq ON emails_entrada (municipio_id, mensagem_id)
  WHERE mensagem_id IS NOT NULL;
CREATE INDEX emails_entrada_painel_idx ON emails_entrada (municipio_id, recebido_em DESC, id DESC);
