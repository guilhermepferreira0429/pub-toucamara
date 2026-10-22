-- Estacionamento (V4 #5): multas municipais, defesas, parques e pedidos de
-- lugar reservado para pessoas com deficiência.
--
-- O dístico de residente NÃO está aqui: já é uma licença (licencas, tipo
-- distico_residente). As multas são as contraordenações de estacionamento
-- levantadas pela fiscalização municipal (zona tarifada, lugares reservados);
-- pagam-se pelo módulo de pagamentos (modo de teste), através de um processo
-- criado quando a pessoa pede para pagar.
--
-- Os valores (coimas, prazos, tarifas, horários) dos dados de demonstração
-- estão marcados com `demonstracao = true`.

CREATE TABLE estacionamento_multas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  numero_auto      text NOT NULL,                     -- 'EST-2026-000123'
  matricula        text NOT NULL,                     -- normalizada: 'AA-00-BB'
  infracao         text NOT NULL,                     -- 'Estacionamento em zona tarifada sem título válido'
  norma            text,                              -- 'Código da Estrada, art. 71.º'
  local            text NOT NULL,
  verificada_em    timestamptz NOT NULL,
  valor_cent       integer NOT NULL CHECK (valor_cent > 0),   -- o que se paga agora (pagamento voluntário)
  valor_maximo_cent integer,                          -- coima máxima, se não pagar
  prazo_pagamento  date NOT NULL,
  prazo_defesa     date NOT NULL,
  estado           text NOT NULL DEFAULT 'por_pagar'
                     CHECK (estado IN ('por_pagar','paga','em_defesa','anulada')),
  processo_id      uuid REFERENCES processos(id),     -- criado no pedido de pagamento
  municipe_id      uuid REFERENCES municipes(id),     -- quem pagou ou se defendeu
  paga_em          timestamptz,
  demonstracao     boolean NOT NULL DEFAULT false,
  criada_em        timestamptz NOT NULL DEFAULT now(),
  atualizada_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero_auto)
);
CREATE INDEX estacionamento_multas_matricula_idx ON estacionamento_multas (municipio_id, matricula);
CREATE INDEX estacionamento_multas_processo_idx ON estacionamento_multas (processo_id)
  WHERE processo_id IS NOT NULL;

-- A defesa (contestação por escrito): fica registada para o serviço decidir.
CREATE TABLE estacionamento_defesas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  multa_id       uuid NOT NULL REFERENCES estacionamento_multas(id),
  municipe_id    uuid REFERENCES municipes(id),
  conversa_id    uuid REFERENCES conversas(id),
  canal          text NOT NULL,
  nome           text,
  telefone       text,                                -- para o SMS da decisão
  texto          text NOT NULL CHECK (length(texto) BETWEEN 10 AND 4000),
  estado         text NOT NULL DEFAULT 'por_analisar'
                   CHECK (estado IN ('por_analisar','aceite','recusada')),
  nota           text,                                -- a decisão, explicada (vai por SMS)
  decidida_por   uuid REFERENCES utilizadores(id),
  decidida_em    timestamptz,
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX estacionamento_defesas_idx ON estacionamento_defesas (municipio_id, estado, criada_em DESC);
-- Uma defesa por analisar de cada vez por multa.
CREATE UNIQUE INDEX estacionamento_defesas_aberta_idx ON estacionamento_defesas (multa_id)
  WHERE estado = 'por_analisar';

-- Parques municipais e zonas de estacionamento tarifado.
CREATE TABLE estacionamento_parques (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  chave                text NOT NULL,                 -- identificador estável (dados de demonstração)
  nome                 text NOT NULL,
  tipo                 text NOT NULL CHECK (tipo IN ('parque','zona_tarifada')),
  morada               text NOT NULL,
  zonas                text[] NOT NULL DEFAULT '{}',  -- ruas, largos e zonas perto (para "perto de…")
  lat                  double precision,
  lng                  double precision,
  lugares              integer,
  lugares_deficiencia  integer,
  -- {"seg":["00:00-24:00"], ...}: quando está aberto (parque) ou quando é pago (zona).
  horario              jsonb NOT NULL,
  -- {primeira_hora_cent, hora_seguinte_cent, maximo_dia_cent, minutos_gratis}
  tarifa               jsonb NOT NULL,
  pagamento_telemovel  boolean NOT NULL DEFAULT false,
  notas                text,
  ativo                boolean NOT NULL DEFAULT true,
  demonstracao         boolean NOT NULL DEFAULT false,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, chave)
);

-- Pedido de lugar de estacionamento reservado para pessoa com deficiência
-- (perto de casa ou do trabalho). Fica registado para o serviço analisar.
CREATE TABLE estacionamento_lugares_pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  numero         text NOT NULL,                       -- 'LRD 12/2026'
  municipe_id    uuid REFERENCES municipes(id),
  conversa_id    uuid REFERENCES conversas(id),
  canal          text NOT NULL,
  nome           text,
  telefone       text,
  morada         text NOT NULL,
  matricula      text,
  tem_cartao     boolean NOT NULL,                    -- cartão de estacionamento para pessoas com deficiência
  observacoes    text,
  estado         text NOT NULL DEFAULT 'recebido'
                   CHECK (estado IN ('recebido','aprovado','recusado')),
  nota           text,
  decidido_por   uuid REFERENCES utilizadores(id),
  decidido_em    timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX estacionamento_lugares_idx ON estacionamento_lugares_pedidos (municipio_id, estado, criado_em DESC);
