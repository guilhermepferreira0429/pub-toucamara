-- Verificação de documentos por fotografia e requerimentos noutra língua.

-- Os valores ditos na língua da conversa, antes da tradução para português
-- (só os campos que mudaram). Em `dados` fica sempre o português.
ALTER TABLE requerimentos ADD COLUMN dados_originais jsonb;

-- O melhor estado de cada documento exigido de um requerimento.
CREATE INDEX documentos_requerimento_tipo_idx
  ON documentos (requerimento_id, tipo_documento_id) WHERE requerimento_id IS NOT NULL;
