-- Respostas guardadas por Idempotency-Key (secção 5.1 do plano).
-- O ElevenLabs e os fornecedores repetem chamadas: a segunda recebe a mesma
-- resposta da primeira, sem criar outro requerimento, SMS ou pagamento.
CREATE TABLE pedidos_idempotentes (
  chave         text PRIMARY KEY,
  municipio_id  uuid REFERENCES municipios(id),       -- NULL nos webhooks antes de se saber
  rota          text NOT NULL,                        -- 'POST /v1/agent/tools/requerimentos'
  estado_http   integer NOT NULL,
  resposta      jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
-- Para o job de limpeza (chega guardar uns dias).
CREATE INDEX pedidos_idempotentes_criado_idx ON pedidos_idempotentes (criado_em);
