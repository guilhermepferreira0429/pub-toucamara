-- MB WAY em modo de teste: os pedidos de pagamento feitos ao telemóvel.
--
-- Tabela à parte (e não colunas em `pagamentos` nem `detalhe`, que são as
-- linhas da simulação): um pagamento pode ter vários pedidos (expirou, pediu
-- outro; no máximo 3) e cada pedido tem a sua referência no fornecedor, que é
-- por onde o webhook o encontra.
--
-- O pedido expira sozinho: `estado` fica 'pendente' e quem lê compara
-- `expira_em` com a hora (sem job). Passa a 'expirado' quando se pede outro
-- ou o fornecedor o diz. Um pedido expirado NÃO expira o pagamento: este
-- continua 'pendente' e paga-se por Multibanco (a referência mantém-se) ou
-- com um novo pedido.
--
-- `pagamentos.metodo` é o método escolhido; depois de pago, o usado.
CREATE TABLE pedidos_mbway (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id    uuid NOT NULL REFERENCES pagamentos(id),
  telemovel_e164  text NOT NULL,
  provider_ref    text NOT NULL UNIQUE,
  -- pendente: à espera de ser aceite (até expira_em) · pago · expirado ·
  -- cancelado (recusado na app, trocou de número/método ou pagou por MB)
  estado          estado_pag NOT NULL DEFAULT 'pendente',
  criado_em       timestamptz NOT NULL DEFAULT now(),
  expira_em       timestamptz NOT NULL,
  fechado_em      timestamptz
);
-- Um só pedido aberto por pagamento.
CREATE UNIQUE INDEX pedidos_mbway_aberto_uidx
  ON pedidos_mbway (pagamento_id) WHERE estado = 'pendente';
CREATE INDEX pedidos_mbway_pagamento_idx ON pedidos_mbway (pagamento_id, criado_em DESC);

-- Painel: filtrar por método.
CREATE INDEX pagamentos_metodo_idx ON pagamentos (municipio_id, metodo, criado_em DESC);
