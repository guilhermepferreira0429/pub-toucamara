-- Conversas: fim da chamada (webhook do ElevenLabs), resumo e SMS.

-- O webhook do fim da chamada traz o agent_id: quando nenhuma ferramenta foi
-- chamada (a conversa ainda não existe) é por aqui que se sabe o município.
ALTER TABLE agente_config ADD COLUMN elevenlabs_agent_id text UNIQUE;

-- O que o job resumir_conversa produz além do resumo do painel:
-- os próximos passos (página "O que tem de fazer") e o texto curto do SMS.
ALTER TABLE conversas
  ADD COLUMN proximos_passos jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN resumo_sms      text,
  ADD COLUMN resumida_em     timestamptz;

-- Os momentos são marcados pelas ferramentas durante a chamada, antes de
-- haver turnos: a hora de criação permite pô-los no sítio certo da linha do
-- tempo (em_ms, turno_id) quando a transcrição chega.
ALTER TABLE conversa_momentos ADD COLUMN criado_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX conversa_momentos_conversa_idx ON conversa_momentos (conversa_id);

-- Agrupar perguntas sem resposta por semelhança de texto (similarity > 0.45).
CREATE INDEX IF NOT EXISTS perguntas_sem_resposta_trgm_idx
  ON perguntas_sem_resposta USING gin (texto gin_trgm_ops);

-- Página pública do resumo: links já criados para pagamentos e processos.
CREATE INDEX IF NOT EXISTS links_curtos_destino_idx ON links_curtos (destino_id, destino_tipo);
