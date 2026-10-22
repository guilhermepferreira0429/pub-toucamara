-- Água e saneamento (V4 #6): em Guimarães são da Vimágua, não da câmara.
-- O agente recolhe o pedido (leitura do contador, 2.ª via ou explicação da
-- fatura, avaria/rotura/falta de água), regista-o aqui e envia-o à Vimágua
-- por um adaptador (IntegracaoVimagua). Enquanto não houver acordo com a
-- Vimágua o adaptador é SIMULADO (simulado = true em cada envio).
-- Rotura com água na via ou perigo → também uma ocorrência na câmara.

CREATE TABLE pedidos_agua (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  numero              text NOT NULL,
  tipo                text NOT NULL
                      CHECK (tipo IN ('leitura','fatura','avaria','rotura','falta_agua')),
  morada              text NOT NULL,
  numero_cliente      text,
  leitura_m3          numeric(12,3),
  descricao           text,
  urgente             boolean NOT NULL DEFAULT false,
  perigo_via          boolean NOT NULL DEFAULT false,
  ocorrencia_id       uuid REFERENCES ocorrencias(id) ON DELETE SET NULL,
  nome                text,
  telefone            text,
  municipe_id         uuid REFERENCES municipes(id),
  conversa_id         uuid REFERENCES conversas(id),
  canal               text NOT NULL DEFAULT 'telefone',
  -- O envio à entidade gestora.
  envio_estado        text NOT NULL DEFAULT 'por_enviar'
                      CHECK (envio_estado IN ('por_enviar','enviado','falhou')),
  envio_tentativas    integer NOT NULL DEFAULT 0,
  enviado_em          timestamptz,
  referencia_externa  text,
  envio_erro          text,
  envio_simulado      boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX pedidos_agua_lista_idx ON pedidos_agua (municipio_id, criado_em DESC, id DESC);
CREATE INDEX pedidos_agua_por_enviar_idx ON pedidos_agua (envio_estado, criado_em)
  WHERE envio_estado <> 'enviado';
