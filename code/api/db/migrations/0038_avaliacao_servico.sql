-- "Como foi tratar disto connosco?" (V2 · Decisão): uma resposta por
-- processo, de 1 (difícil) a 3 (fácil). Entra nos indicadores.
CREATE TABLE avaliacoes_servico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  processo_id   uuid NOT NULL UNIQUE REFERENCES processos(id),
  nota          smallint NOT NULL CHECK (nota BETWEEN 1 AND 3),
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avaliacoes_servico_idx ON avaliacoes_servico (municipio_id, criada_em DESC);
