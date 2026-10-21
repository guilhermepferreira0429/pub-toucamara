-- V2 · Agente: o nome da voz que a câmara vê (o voz_id é o do ElevenLabs) e o
-- ritmo da fala. "As perguntas da câmara" usam o esquema avaliacao: um conjunto
-- do município com o nome 'Perguntas da câmara' (versões, como o avaliador).
ALTER TABLE agente_config
  ADD COLUMN voz_nome text,
  ADD COLUMN ritmo text NOT NULL DEFAULT 'normal'
    CHECK (ritmo IN ('calmo','normal','rapido'));
