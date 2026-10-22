-- O modelo (LLM) do agente de voz no ElevenLabs passa a escolher-se no painel
-- (Agente › Editar). null: fica o que estiver no ElevenLabs. A sincronização
-- leva-o a conversation_config.agent.prompt.llm dos dois agentes.
ALTER TABLE agente_config ADD COLUMN IF NOT EXISTS modelo_voz text;
