-- Reuniões de câmara e sessões da assembleia municipal (V3 · FUN §13, ponto 4):
-- atas feitas a partir da gravação e deliberações fáceis de pesquisar.
--
--   * reunioes: órgão, tipo, data, local, ordem do dia (pontos numerados),
--     presenças (membros com cargo e força política), a gravação (S3) e a
--     transcrição (speech-to-text do ElevenLabs ou texto colado).
--   * atas (+ versões): o rascunho (com IA ou montado da ordem do dia), cada
--     gravação fica como versão; aprovada em minuta ou na reunião seguinte;
--     publicada com um código público (o PDF).
--   * deliberacoes: o índice das deliberações das atas publicadas, por texto
--     (pt_unaccent) e, com embeddings, por semelhança.
--
-- O formato da ata segue a Lei n.º 75/2013 (Anexo I, art. 57.º); está
-- marcado como "a confirmar com os serviços" (atas.demonstracao).

CREATE TABLE reunioes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  orgao                text NOT NULL CHECK (orgao IN ('camara','assembleia')),
  tipo                 text NOT NULL CHECK (tipo IN ('ordinaria','extraordinaria')),
  numero               text NOT NULL,                  -- '12/2026' (série por órgão e ano)
  data                 date NOT NULL,
  hora                 time,
  local                text NOT NULL,
  ordem_do_dia         jsonb NOT NULL DEFAULT '[]',    -- [{numero, titulo, descricao}]
  presencas            jsonb NOT NULL DEFAULT '[]',    -- [{nome, cargo, forca_politica, presente, falta_justificada}]
  estado               text NOT NULL DEFAULT 'agendada'
                         CHECK (estado IN ('agendada','realizada','ata_rascunho','ata_aprovada','publicada')),
  gravacao_key         text,                           -- S3 (pasta 'gravacoes')
  gravacao_mime        text,
  gravacao_pedida_em   timestamptz,
  transcricao          text,
  transcricao_origem   text CHECK (transcricao_origem IN ('texto','elevenlabs')),
  transcricao_estado   text NOT NULL DEFAULT 'sem'
                         CHECK (transcricao_estado IN ('sem','a_transcrever','pronta','falhou')),
  transcricao_erro     text,
  transcricao_em       timestamptz,
  criada_por           uuid REFERENCES utilizadores(id),
  criada_em            timestamptz NOT NULL DEFAULT now(),
  atualizada_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, orgao, numero)
);
CREATE INDEX reunioes_lista_idx ON reunioes (municipio_id, data DESC, id DESC);

CREATE TABLE atas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  reuniao_id              uuid NOT NULL UNIQUE REFERENCES reunioes(id) ON DELETE CASCADE,
  versao                  integer NOT NULL DEFAULT 1,
  conteudo                jsonb NOT NULL,              -- reunioes/tipos.ts (esquemaConteudoAta)
  origem                  text NOT NULL CHECK (origem IN ('ia','sem_ia')),
  estado                  text NOT NULL DEFAULT 'rascunho'
                            CHECK (estado IN ('rascunho','aprovada','publicada')),
  aprovacao_modo          text CHECK (aprovacao_modo IN ('minuta','reuniao_seguinte')),
  aprovada_na_reuniao_id  uuid REFERENCES reunioes(id),
  aprovada_em             timestamptz,
  aprovada_por            uuid REFERENCES utilizadores(id),
  publicada_em            timestamptz,
  publicada_por           uuid REFERENCES utilizadores(id),
  codigo_publico          text UNIQUE,                 -- /v1/public/atas/{codigo}
  demonstracao            boolean NOT NULL DEFAULT true,
  criada_em               timestamptz NOT NULL DEFAULT now(),
  atualizada_em           timestamptz NOT NULL DEFAULT now()
);

-- Cada gravação do rascunho fica como versão (o que mudou, quem e quando).
CREATE TABLE ata_versoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  ata_id        uuid NOT NULL REFERENCES atas(id) ON DELETE CASCADE,
  versao        integer NOT NULL,
  origem        text NOT NULL,                         -- 'ia', 'sem_ia', 'edicao'
  conteudo      jsonb NOT NULL,
  alterado_por  uuid REFERENCES utilizadores(id),
  nota          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ata_id, versao)
);

-- O índice das deliberações (só das atas publicadas).
CREATE TABLE deliberacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id      uuid NOT NULL REFERENCES municipios(id),
  reuniao_id        uuid NOT NULL REFERENCES reunioes(id) ON DELETE CASCADE,
  ata_id            uuid NOT NULL REFERENCES atas(id) ON DELETE CASCADE,
  orgao             text NOT NULL,
  data              date NOT NULL,
  ponto_numero      integer NOT NULL,
  titulo            text NOT NULL,
  proposta          text NOT NULL DEFAULT '',
  deliberacao       text NOT NULL,
  resultado         text NOT NULL,
  votacao           jsonb NOT NULL DEFAULT '[]',       -- [{forca_politica, a_favor, contra, abstencoes}]
  votacao_texto     text NOT NULL DEFAULT '',
  declaracoes_voto  jsonb NOT NULL DEFAULT '[]',
  texto_pesquisa    text NOT NULL,                     -- montado na API (reunioes/regras.ts)
  tsv               tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent', texto_pesquisa)) STORED,
  embedding         vector(1024),
  publicada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ata_id, ponto_numero)
);
CREATE INDEX deliberacoes_lista_idx ON deliberacoes (municipio_id, data DESC, id DESC);
CREATE INDEX deliberacoes_tsv_idx ON deliberacoes USING gin (tsv);
CREATE INDEX deliberacoes_vec_idx ON deliberacoes USING hnsw (embedding vector_cosine_ops);
