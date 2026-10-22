-- Animais (V4 #9): os animais do canil/gatil municipal para adoção (página
-- pública /adotar), os pedidos de visita para adotar e os animais perdidos,
-- encontrados, abandonados, feridos ou agressivos reportados ao agente.
--
-- Os animais entram pelo "Preparar demo" (demonstracao = true). Feridos e
-- agressivos na via viram também uma ocorrência urgente (ocorrencia_id).

CREATE TABLE animais_adocao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,
  especie       text NOT NULL CHECK (especie IN ('cao','gato')),
  sexo          text CHECK (sexo IN ('macho','femea')),
  porte         text CHECK (porte IN ('pequeno','medio','grande')),
  -- Idade dita ("cerca de 2 anos"): no canil raramente se sabe ao certo.
  idade         text,
  descricao     text NOT NULL,
  -- Cor da ilustração na página (sem fotografias externas): #rrggbb.
  cor           text CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  esterilizado  boolean NOT NULL DEFAULT false,
  vacinado      boolean NOT NULL DEFAULT false,
  com_chip      boolean NOT NULL DEFAULT true,
  estado        text NOT NULL DEFAULT 'disponivel'
                CHECK (estado IN ('disponivel','reservado','adotado')),
  entrada_em    date NOT NULL DEFAULT current_date,
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX animais_adocao_idx ON animais_adocao (municipio_id, estado, especie);

-- Pedido de visita para conhecer/adotar um animal: dia e período preferidos;
-- a equipa do canil confirma a hora (SMS).
CREATE TABLE visitas_adocao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  numero          text NOT NULL,
  animal_id       uuid REFERENCES animais_adocao(id) ON DELETE SET NULL,
  -- O que a pessoa disse ("o Tejo", "um gato pequeno").
  animal_dito     text,
  nome            text NOT NULL,
  telefone        text,
  municipe_id     uuid REFERENCES municipes(id),
  conversa_id     uuid REFERENCES conversas(id),
  canal           text NOT NULL DEFAULT 'telefone',
  dia             date NOT NULL,
  periodo         text NOT NULL CHECK (periodo IN ('manha','tarde')),
  observacoes     text,
  estado          text NOT NULL DEFAULT 'pedida'
                  CHECK (estado IN ('pedida','confirmada','realizada','adotou','cancelada')),
  tratado_por     uuid REFERENCES utilizadores(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX visitas_adocao_lista_idx ON visitas_adocao (municipio_id, criado_em DESC, id DESC);

CREATE TABLE animais_reportados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  numero          text NOT NULL,
  tipo            text NOT NULL
                  CHECK (tipo IN ('perdido','encontrado','abandonado','ferido','agressivo')),
  especie         text NOT NULL,
  nome_animal     text,
  descricao       text NOT NULL,
  morada          text NOT NULL,
  lat             double precision,
  lng             double precision,
  com_chip        boolean,
  urgente         boolean NOT NULL DEFAULT false,
  ocorrencia_id   uuid REFERENCES ocorrencias(id) ON DELETE SET NULL,
  nome            text,
  telefone        text,
  municipe_id     uuid REFERENCES municipes(id),
  conversa_id     uuid REFERENCES conversas(id),
  canal           text NOT NULL DEFAULT 'telefone',
  estado          text NOT NULL DEFAULT 'aberto'
                  CHECK (estado IN ('aberto','recolhido','devolvido','resolvido')),
  tratado_por     uuid REFERENCES utilizadores(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX animais_reportados_lista_idx ON animais_reportados (municipio_id, criado_em DESC, id DESC);
