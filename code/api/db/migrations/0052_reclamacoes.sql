-- Livro de reclamações com prazo de resposta controlado (V3 · FUN §13, ponto 6).
--
-- Uma reclamação formal (número REC n/ano) entra pelo agente (telefone ou
-- chat), por um email da triagem, ao balcão ou pelo Livro Amarelo em papel
-- digitalizado. O prazo legal conta em dias úteis com os feriados do
-- município e é configurável (municipios.reclamacoes_config; sem config o
-- código usa um valor de demonstração, marcado como tal).

ALTER TABLE municipios ADD COLUMN IF NOT EXISTS reclamacoes_config jsonb;

CREATE TABLE reclamacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  numero             text NOT NULL,                       -- 'REC 12/2026'
  codigo_publico     text NOT NULL UNIQUE,                -- a página /reclamacao/{codigo}
  municipe_id        uuid REFERENCES municipes(id),
  conversa_id        uuid REFERENCES conversas(id),
  email_id           uuid UNIQUE REFERENCES emails_entrada(id),
  canal              text NOT NULL CHECK (canal IN ('telefone','chat','sms','email','balcao','livro_amarelo')),
  nome               text,
  telefone           text,                                -- E.164
  email              citext,
  resposta_por       text NOT NULL DEFAULT 'sms' CHECK (resposta_por IN ('sms','email','carta')),
  servico_visado     text,                                -- como a pessoa o disse
  servico_id         uuid REFERENCES servicos(id),        -- quem trata (atribuído no painel)
  atribuida_a        uuid REFERENCES utilizadores(id),
  descricao          text NOT NULL,
  pedido             text,                                -- o que a pessoa pede
  estado             text NOT NULL DEFAULT 'recebida'
                     CHECK (estado IN ('recebida','em_analise','respondida','encerrada')),
  recebida_em        date NOT NULL,                       -- o dia em que entrou (o papel pode ser anterior)
  prazo_dias_uteis   integer NOT NULL CHECK (prazo_dias_uteis > 0),
  responder_ate      date NOT NULL,
  config_usada       jsonb NOT NULL,
  resposta           text,
  respondida_em      timestamptz,
  respondida_por     uuid REFERENCES utilizadores(id),
  encerrada_em       timestamptz,
  nota_encerramento  text,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  atualizada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX reclamacoes_lista_idx ON reclamacoes (municipio_id, estado, responder_ate);
CREATE INDEX reclamacoes_municipe_idx ON reclamacoes (municipe_id);

-- Histórico (só se acrescenta): recebida, atribuída, resposta, encerrada.
CREATE TABLE reclamacao_eventos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reclamacao_id  uuid NOT NULL REFERENCES reclamacoes(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  descricao      text NOT NULL,
  ator_tipo      text NOT NULL CHECK (ator_tipo IN ('agente','utilizador','sistema','municipe')),
  ator_id        uuid,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reclamacao_eventos_idx ON reclamacao_eventos (reclamacao_id, criado_em);

-- Anexos: a folha do Livro Amarelo digitalizada, fotos, os anexos do email.
-- ficheiro_key NULL = só o nome (anexo de um email que não foi guardado).
CREATE TABLE reclamacao_anexos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  reclamacao_id  uuid NOT NULL REFERENCES reclamacoes(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  mime           text NOT NULL,
  ficheiro_key   text,
  criado_por     uuid REFERENCES utilizadores(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reclamacao_anexos_idx ON reclamacao_anexos (reclamacao_id);
