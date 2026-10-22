-- Pedidos de avaliação (PLANO 6.3, "correr_evals"): a API pede, o avaliador
-- (`avaliador pedidos trabalhar`, com a chave do juiz) faz as perguntas,
-- avalia e liga a execução ao pedido. Um pendente por município e conjunto.
CREATE TABLE avaliacao.pedidos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  motivo        text NOT NULL CHECK (motivo IN ('manual','ingestao','mudanca_agente')),
  conjunto      text NOT NULL DEFAULT 'Perguntas base',
  amostra       boolean NOT NULL DEFAULT false,
  estado        text NOT NULL DEFAULT 'pendente'
                  CHECK (estado IN ('pendente','a_correr','terminado','falhou')),
  pedido_por    uuid REFERENCES utilizadores(id),
  execucao_id   uuid REFERENCES avaliacao.execucoes(id),
  erro          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  iniciado_em   timestamptz,
  terminado_em  timestamptz
);
CREATE UNIQUE INDEX pedidos_pendente_uq ON avaliacao.pedidos (municipio_id, conjunto)
  WHERE estado = 'pendente';
CREATE INDEX pedidos_fila_idx ON avaliacao.pedidos (criado_em) WHERE estado = 'pendente';
