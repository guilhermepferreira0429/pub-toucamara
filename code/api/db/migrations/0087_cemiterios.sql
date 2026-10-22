-- Cemitérios (V4 #8): onde está sepultada uma pessoa, a concessão de uma
-- sepultura ou jazigo (titular, validade, taxas de conservação por pagar),
-- pedidos de renovação/averbamento e os horários.
--
-- Os dados que a câmara ainda não deu (cemitérios, sepulturas, pessoas
-- sepultadas, horários) entram pelo "Preparar demo" com demonstracao = true
-- e nomes claramente fictícios. As taxas ficam no código (cemiterios/regras.ts),
-- também marcadas como valores de demonstração.

CREATE TABLE cemiterios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,
  freguesia     text,
  morada        text,
  -- {"seg-sex":"08:00-17:00","sab-dom":"09:00-17:00"} (como em entidade_contactos)
  horario       jsonb,
  -- Nota curta para dizer (ex.: "No verão fecha às 19:00").
  nota_horario  text,
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, nome)
);

CREATE TABLE sepulturas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  cemiterio_id        uuid NOT NULL REFERENCES cemiterios(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('sepultura','jazigo','gavetao','ossario')),
  talhao              text NOT NULL,
  numero              text NOT NULL,
  -- Concessão: temporária (com fim) ou perpétua (sem fim).
  concessao           text NOT NULL DEFAULT 'temporaria' CHECK (concessao IN ('temporaria','perpetua')),
  titular_nome        text,
  concessao_inicio    date,
  concessao_fim       date,
  -- Taxas de conservação em dívida (cêntimos) e desde que ano.
  conservacao_divida_cent integer NOT NULL DEFAULT 0 CHECK (conservacao_divida_cent >= 0),
  conservacao_divida_desde integer,
  demonstracao        boolean NOT NULL DEFAULT false,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cemiterio_id, talhao, numero)
);
CREATE INDEX sepulturas_municipio_idx ON sepulturas (municipio_id, cemiterio_id);

CREATE TABLE inumados (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  sepultura_id     uuid NOT NULL REFERENCES sepulturas(id) ON DELETE CASCADE,
  nome             text NOT NULL,
  data_falecimento date,
  data_inumacao    date,
  demonstracao     boolean NOT NULL DEFAULT false
);
-- A procura por nome é sem acentos e por semelhança (unaccent + pg_trgm),
-- numa tabela pequena por município: chega o índice por sepultura.
CREATE INDEX inumados_sepultura_idx ON inumados (sepultura_id);

-- Pedidos de renovação de concessão, averbamento (mudança de titular) ou
-- 2.ª via do alvará, feitos ao agente ou ao balcão.
CREATE TABLE pedidos_cemiterio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  numero          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('renovacao','averbamento','segunda_via_alvara')),
  sepultura_id    uuid REFERENCES sepulturas(id) ON DELETE SET NULL,
  -- O que a pessoa disse para identificar a sepultura (cemitério, talhão, número ou nome).
  referencia      text NOT NULL,
  requerente_nome text NOT NULL,
  relacao         text,
  observacoes     text,
  telefone        text,
  municipe_id     uuid REFERENCES municipes(id),
  conversa_id     uuid REFERENCES conversas(id),
  canal           text NOT NULL DEFAULT 'telefone',
  estado          text NOT NULL DEFAULT 'recebido'
                  CHECK (estado IN ('recebido','em_analise','concluido','recusado')),
  resposta        text,
  tratado_por     uuid REFERENCES utilizadores(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX pedidos_cemiterio_lista_idx ON pedidos_cemiterio (municipio_id, criado_em DESC, id DESC);
