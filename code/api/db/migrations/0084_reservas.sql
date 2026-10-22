-- Reservas (V4 #4): pavilhões, piscinas, auditórios e salas municipais, e
-- bilhetes para eventos municipais com lugares limitados.
--
-- Uma reserva de equipamento ocupa um período (sem sobreposições enquanto
-- estiver ativa); um bilhete ocupa `quantidade` lugares de uma sessão. Com
-- preço, paga-se pelo módulo de pagamentos (modo de teste), através de um
-- processo criado com a reserva. `codigo` é o segredo da página pública
-- /reserva/{codigo} (link do SMS, com QR no bilhete).

CREATE TABLE reserva_equipamentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  chave               text,                            -- identificador estável (dados de demonstração)
  nome                text NOT NULL CHECK (length(nome) BETWEEN 3 AND 140),
  tipo                text NOT NULL CHECK (tipo IN ('pavilhao','piscina','auditorio','sala','campo')),
  morada              text NOT NULL,
  descricao           text,
  lotacao             integer CHECK (lotacao > 0),
  -- {"seg":["08:00-23:00"], ...}: quando se pode reservar.
  horario             jsonb NOT NULL,
  duracao_slot_min    integer NOT NULL DEFAULT 60 CHECK (duracao_slot_min IN (30, 60, 90, 120)),
  duracao_max_horas   integer NOT NULL DEFAULT 3 CHECK (duracao_max_horas BETWEEN 1 AND 12),
  antecedencia_horas  integer NOT NULL DEFAULT 24 CHECK (antecedencia_horas >= 0),
  preco_hora_cent     integer NOT NULL DEFAULT 0 CHECK (preco_hora_cent >= 0),
  -- Informação para quem pergunta (entrada nas piscinas, aulas…).
  entrada_cent        integer CHECK (entrada_cent >= 0),
  notas               text,
  aprovacao           text NOT NULL DEFAULT 'automatica' CHECK (aprovacao IN ('automatica','funcionario')),
  ativo               boolean NOT NULL DEFAULT true,
  demonstracao        boolean NOT NULL DEFAULT false,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, chave)
);

-- Sessões com bilhete (lugares limitados). Pode apontar para um evento do
-- feed "o que se passa perto de mim" (eventos, migração 0062).
CREATE TABLE reserva_sessoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  chave         text,
  evento_id     uuid REFERENCES eventos(id),
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 140),
  local         text NOT NULL,
  inicio        timestamptz NOT NULL,
  fim           timestamptz,
  lotacao       integer NOT NULL CHECK (lotacao > 0),
  preco_cent    integer NOT NULL DEFAULT 0 CHECK (preco_cent >= 0),
  max_por_pessoa integer NOT NULL DEFAULT 6 CHECK (max_por_pessoa BETWEEN 1 AND 50),
  ativo         boolean NOT NULL DEFAULT true,
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, chave)
);
CREATE INDEX reserva_sessoes_idx ON reserva_sessoes (municipio_id, inicio);

CREATE TABLE reservas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  tipo            text NOT NULL CHECK (tipo IN ('equipamento','bilhete')),
  codigo          text NOT NULL UNIQUE,
  equipamento_id  uuid REFERENCES reserva_equipamentos(id),
  sessao_id       uuid REFERENCES reserva_sessoes(id),
  periodo         tstzrange,
  quantidade      integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  finalidade      text,
  nome            text,
  telefone        text,
  municipe_id     uuid REFERENCES municipes(id),
  conversa_id     uuid REFERENCES conversas(id),
  canal           text NOT NULL,
  valor_cent      integer NOT NULL DEFAULT 0 CHECK (valor_cent >= 0),
  estado          text NOT NULL
                    CHECK (estado IN ('por_aprovar','por_pagar','confirmada','recusada','cancelada')),
  processo_id     uuid REFERENCES processos(id),
  motivo_recusa   text,
  decidida_por    uuid REFERENCES utilizadores(id),
  decidida_em     timestamptz,
  confirmada_em   timestamptz,
  cancelada_em    timestamptz,
  demonstracao    boolean NOT NULL DEFAULT false,
  criada_em       timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'equipamento') = (equipamento_id IS NOT NULL AND periodo IS NOT NULL)),
  CHECK ((tipo = 'bilhete') = (sessao_id IS NOT NULL)),
  -- O mesmo equipamento não fica reservado duas vezes à mesma hora.
  EXCLUDE USING gist (equipamento_id WITH =, periodo WITH &&)
    WHERE (estado IN ('por_aprovar','por_pagar','confirmada'))
);
CREATE INDEX reservas_lista_idx ON reservas (municipio_id, criada_em DESC);
CREATE INDEX reservas_sessao_idx ON reservas (sessao_id) WHERE sessao_id IS NOT NULL;
CREATE INDEX reservas_processo_idx ON reservas (processo_id) WHERE processo_id IS NOT NULL;
CREATE INDEX reservas_municipe_idx ON reservas (municipe_id);
