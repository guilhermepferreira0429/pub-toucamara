-- Habitação municipal (V4 #7): candidaturas (arrendamento apoiado e renda
-- acessível) com pontuação provisória, e para os inquilinos a renda e as
-- prestações, os pedidos de reparação e a revisão da renda.
--
-- Os critérios, a pontuação, o IAS e a fórmula da renda são valores de
-- demonstração até a câmara confirmar o seu regulamento.

CREATE TABLE habitacao_fogos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  codigo        text NOT NULL,
  morada        text NOT NULL,
  freguesia     text,
  tipologia     text NOT NULL CHECK (tipologia ~ '^T[0-6]$'),
  area_m2       numeric(6,1),
  estado        text NOT NULL DEFAULT 'livre' CHECK (estado IN ('ocupado','livre','em_obras')),
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, codigo)
);

CREATE TABLE habitacao_contratos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  fogo_id                 uuid NOT NULL REFERENCES habitacao_fogos(id),
  municipe_id             uuid NOT NULL REFERENCES municipes(id),
  regime                  text NOT NULL CHECK (regime IN ('apoiado','acessivel')),
  inicio                  date NOT NULL,
  renda_cent              integer NOT NULL CHECK (renda_cent >= 0),
  -- Dia do mês em que a renda vence.
  dia_vencimento          integer NOT NULL DEFAULT 8 CHECK (dia_vencimento BETWEEN 1 AND 28),
  rendimento_mensal_cent  integer,
  agregado                integer NOT NULL DEFAULT 1 CHECK (agregado >= 1),
  em_divida_cent          integer NOT NULL DEFAULT 0 CHECK (em_divida_cent >= 0),
  estado                  text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo','terminado')),
  demonstracao            boolean NOT NULL DEFAULT false,
  criado_em               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX habitacao_contratos_fogo_uq
  ON habitacao_contratos (fogo_id) WHERE estado = 'ativo';
CREATE INDEX habitacao_contratos_municipe_idx ON habitacao_contratos (municipe_id) WHERE estado = 'ativo';

CREATE TABLE habitacao_candidaturas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id           uuid NOT NULL REFERENCES municipios(id),
  municipe_id            uuid NOT NULL REFERENCES municipes(id),
  codigo                 text NOT NULL UNIQUE,
  regime                 text NOT NULL CHECK (regime IN ('apoiado','acessivel')),
  agregado               integer NOT NULL CHECK (agregado >= 1),
  rendimento_anual_cent  integer NOT NULL CHECK (rendimento_anual_cent >= 0),
  -- As respostas (situação, menores, idosos, anos de residência…).
  dados                  jsonb NOT NULL DEFAULT '{}',
  elegivel               boolean NOT NULL,
  pontuacao              integer NOT NULL,
  -- {lista: [{criterio, pontos, maximo, porque}], exclusoes: [...], limite_cent}.
  criterios              jsonb NOT NULL DEFAULT '{}',
  estado                 text NOT NULL DEFAULT 'submetida'
                         CHECK (estado IN ('submetida','em_analise','admitida','excluida','atribuida')),
  nota                   text,
  demonstracao           boolean NOT NULL DEFAULT false,
  conversa_id            uuid REFERENCES conversas(id),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habitacao_candidaturas_mun_idx
  ON habitacao_candidaturas (municipio_id, estado, pontuacao DESC);

CREATE TABLE habitacao_reparacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  contrato_id    uuid NOT NULL REFERENCES habitacao_contratos(id),
  municipe_id    uuid NOT NULL REFERENCES municipes(id),
  codigo         text NOT NULL UNIQUE,
  categoria      text NOT NULL,
  descricao      text NOT NULL,
  urgencia       text NOT NULL CHECK (urgencia IN ('urgente','normal')),
  estado         text NOT NULL DEFAULT 'registada'
                 CHECK (estado IN ('registada','atribuida','em_curso','concluida')),
  atribuida_a    text,
  conversa_id    uuid REFERENCES conversas(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habitacao_reparacoes_mun_idx
  ON habitacao_reparacoes (municipio_id, estado, criado_em DESC);

CREATE TABLE habitacao_revisoes_renda (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  contrato_id             uuid NOT NULL REFERENCES habitacao_contratos(id),
  municipe_id             uuid NOT NULL REFERENCES municipes(id),
  codigo                  text NOT NULL UNIQUE,
  rendimento_mensal_cent  integer NOT NULL CHECK (rendimento_mensal_cent >= 0),
  agregado                integer NOT NULL CHECK (agregado >= 1),
  motivo                  text NOT NULL,
  renda_atual_cent        integer NOT NULL,
  renda_estimada_cent     integer NOT NULL,
  estado                  text NOT NULL DEFAULT 'pedida'
                          CHECK (estado IN ('pedida','em_analise','aceite','recusada')),
  conversa_id             uuid REFERENCES conversas(id),
  criado_em               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX habitacao_revisoes_aberta_uq
  ON habitacao_revisoes_renda (contrato_id) WHERE estado IN ('pedida','em_analise');
