-- Outras licenças simples decididas na chamada (ocupação da via pública
-- para obras, esplanada, dístico de residente) e "testar uma lei antes de a
-- aprovar": a câmara corre as regras propostas contra os pedidos antigos.
--
-- Os pedidos antigos são as licenças já pedidas ao agente mais os que vêm
-- do sistema antigo (`licenca_historico`). Para a demonstração, o painel
-- carrega pedidos inventados, marcados com demonstracao = true.

ALTER TABLE licenca_regras DROP CONSTRAINT licenca_regras_tipo_check;
ALTER TABLE licenca_regras ADD CONSTRAINT licenca_regras_tipo_check
  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente'));

ALTER TABLE licencas DROP CONSTRAINT licencas_tipo_check;
ALTER TABLE licencas ADD CONSTRAINT licencas_tipo_check
  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente'));
CREATE INDEX licencas_tipo_idx ON licencas (municipio_id, tipo, criada_em DESC);

CREATE TABLE licenca_historico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  tipo          text NOT NULL
                  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente')),
  referencia    text NOT NULL,             -- o número no sistema antigo
  pedido_em     date NOT NULL,             -- a antecedência conta a partir daqui
  dados         jsonb NOT NULL,            -- a mesma forma que licencas.dados desse tipo
  demonstracao  boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, tipo, referencia)
);
CREATE INDEX licenca_historico_idx ON licenca_historico (municipio_id, tipo, pedido_em);
