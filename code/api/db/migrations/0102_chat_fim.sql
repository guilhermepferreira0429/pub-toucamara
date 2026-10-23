-- Fim das conversas de chat: o chat não tem "desligar", por isso uma conversa sem mensagens há 30 minutos
-- passa a terminada, ganha resultado e vai para o resumo (o job fechar_chats, a cada 5 minutos).
-- ultima_atividade_em é atualizada a cada turno; nas conversas antigas fica nula e conta a hora de início.
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ultima_atividade_em timestamptz;
CREATE INDEX IF NOT EXISTS conversas_chat_abertas_idx
  ON conversas (coalesce(ultima_atividade_em, iniciada_em))
  WHERE canal = 'chat' AND terminada_em IS NULL;
