-- Escolas (V4 #3): o que a câmara trata no pré-escolar e no 1.º ciclo.
-- Refeições escolares (inscrição na cantina, marcar/desmarcar um dia, conta
-- do mês pelo escalão da ação social escolar), transporte escolar,
-- atividades (AEC e férias desportivas) e pré-inscrições no pré-escolar.
--
-- Os alunos são menores: só o encarregado de educação identificado (NIF)
-- mexe nos dados. As alergias e outras informações de saúde ficam só aqui
-- (para a escola e a cozinha, no painel) e nunca voltam ao agente.

CREATE TABLE escolas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,
  agrupamento   text,
  nivel         text NOT NULL CHECK (nivel IN ('pre_escolar','1_ciclo','ambos')),
  freguesia     text,
  morada        text,
  tem_cantina   boolean NOT NULL DEFAULT true,
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, nome)
);

CREATE TABLE escolas_alunos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  encarregado_id  uuid NOT NULL REFERENCES municipes(id),
  nome            text NOT NULL,
  data_nascimento date,
  escola_id       uuid REFERENCES escolas(id),
  -- 'pre' (pré-escolar), '1' a '4' (ano do 1.º ciclo).
  ano             text CHECK (ano IN ('pre','1','2','3','4')),
  -- Escalão da ação social escolar (A = abono 1.º escalão, B = 2.º).
  escalao         text NOT NULL DEFAULT 'sem' CHECK (escalao IN ('A','B','sem')),
  -- Saúde: só para a escola e a cozinha (painel). Nunca no resultado do agente.
  alergias        text,
  -- Carregamentos da conta de refeições (valores de demonstração).
  saldo_cent      integer NOT NULL DEFAULT 0,
  demonstracao    boolean NOT NULL DEFAULT false,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX escolas_alunos_nome_uq
  ON escolas_alunos (encarregado_id, lower(nome));
CREATE INDEX escolas_alunos_escola_idx ON escolas_alunos (escola_id);

CREATE TABLE escolas_atividades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  codigo        text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('aec','ferias')),
  nome          text NOT NULL,
  descricao     text,
  -- Sem escola: aberta a todos os alunos do concelho (ex.: férias desportivas).
  escola_id     uuid REFERENCES escolas(id),
  anos          text[] NOT NULL DEFAULT '{1,2,3,4}',
  horario       text,
  inicio        date,
  fim           date,
  vagas         integer NOT NULL CHECK (vagas >= 0),
  preco_cent    integer NOT NULL DEFAULT 0 CHECK (preco_cent >= 0),
  demonstracao  boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, codigo)
);

-- Inscrições: cantina, atividade ou pré-escolar (pré-inscrição: quem decide
-- a colocação é o agrupamento).
CREATE TABLE escolas_inscricoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  aluno_id      uuid NOT NULL REFERENCES escolas_alunos(id),
  tipo          text NOT NULL CHECK (tipo IN ('cantina','atividade','pre_escolar')),
  atividade_id  uuid REFERENCES escolas_atividades(id),
  estado        text NOT NULL DEFAULT 'ativa'
                CHECK (estado IN ('ativa','pendente','cancelada','colocada','nao_colocada')),
  codigo        text NOT NULL UNIQUE,
  desde         date NOT NULL DEFAULT current_date,
  -- pré-escolar: {escolas_preferidas: [...], ano_letivo}; outros: notas.
  dados         jsonb NOT NULL DEFAULT '{}',
  conversa_id   uuid REFERENCES conversas(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'atividade') = (atividade_id IS NOT NULL))
);
CREATE UNIQUE INDEX escolas_inscricoes_uq
  ON escolas_inscricoes (aluno_id, tipo, coalesce(atividade_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE estado <> 'cancelada';
CREATE INDEX escolas_inscricoes_mun_idx ON escolas_inscricoes (municipio_id, tipo, criado_em DESC);

-- As refeições contam todos os dias úteis para quem está inscrito na
-- cantina; aqui ficam só as exceções (desmarcada, ou marcada sem inscrição).
CREATE TABLE escolas_refeicoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id      uuid NOT NULL REFERENCES escolas_alunos(id),
  dia           date NOT NULL,
  marcada       boolean NOT NULL,
  alterada_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluno_id, dia)
);
CREATE INDEX escolas_refeicoes_dia_idx ON escolas_refeicoes (dia);

CREATE TABLE escolas_transporte (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  aluno_id       uuid NOT NULL REFERENCES escolas_alunos(id),
  escola_id      uuid NOT NULL REFERENCES escolas(id),
  morada         text NOT NULL,
  distancia_km   numeric(5,1),
  -- O que as regras propõem: 'cumpre', 'nao_cumpre' ou 'por_medir'.
  proposta       text NOT NULL CHECK (proposta IN ('cumpre','nao_cumpre','por_medir')),
  estado         text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovado','recusado')),
  motivo         text,
  codigo         text NOT NULL UNIQUE,
  decidido_por   uuid REFERENCES utilizadores(id),
  decidido_em    timestamptz,
  conversa_id    uuid REFERENCES conversas(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX escolas_transporte_aberto_uq
  ON escolas_transporte (aluno_id) WHERE estado = 'pendente';
CREATE INDEX escolas_transporte_mun_idx ON escolas_transporte (municipio_id, estado, criado_em DESC);
