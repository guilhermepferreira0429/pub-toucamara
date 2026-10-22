-- Dois agentes de voz no ElevenLabs: o de entrada (quem liga para a câmara,
-- linha e /ligar) e o de saída (as chamadas que a câmara faz: campanhas,
-- emergências, antecipações, renovações, processos). Cada um só tem as
-- ferramentas de que precisa, para pesar menos em cada resposta.
--
-- As chamadas de saída usam este agente; se estiver vazio, usam o de entrada
-- (elevenlabs_agent_id). O webhook do início e o do fim da chamada
-- reconhecem os dois como do mesmo município.

ALTER TABLE agente_config ADD COLUMN elevenlabs_agent_id_saida text UNIQUE
  CHECK (elevenlabs_agent_id_saida IS NULL
         OR elevenlabs_agent_id_saida IS DISTINCT FROM elevenlabs_agent_id);
