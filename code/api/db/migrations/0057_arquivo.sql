-- Arquivo antigo digitalizado e pesquisável (V3 · FUN §13, ponto 5; PT 14).
--
-- Os processos em papel são digitalizados em lotes (PDF ou imagens, em S3).
-- De cada documento guarda-se o texto (camada de texto do PDF, OCR com IA ou
-- transcrição à mão; NULL = por transcrever) e os metadados lidos (número
-- antigo, ano, tipo, requerente, morada, freguesia, artigo matricial), que um
-- funcionário confirma (estado 'revisto'). O munícipe pede para consultar
-- pelo agente; o pedido segue a LADA (Lei 26/2016) e o arquivo marca a
-- consulta ou prepara a cópia certificada. Prazos e taxas em
-- municipios.arquivo_config (sem config: valores de demonstração no código).

ALTER TABLE municipios ADD COLUMN IF NOT EXISTS arquivo_config jsonb;

CREATE TABLE arquivo_lotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,                        -- 'Caixa 12 · Obras 1985'
  criado_por    uuid REFERENCES utilizadores(id),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX arquivo_lotes_idx ON arquivo_lotes (municipio_id, criado_em DESC);

CREATE TABLE arquivo_documentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  lote_id            uuid REFERENCES arquivo_lotes(id) ON DELETE SET NULL,
  nome_ficheiro      text NOT NULL,
  mime               text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png','image/webp','image/tiff')),
  ficheiro_key       text NOT NULL,                     -- a digitalização fica sempre guardada
  paginas            integer,
  estado             text NOT NULL DEFAULT 'por_processar'
                     CHECK (estado IN ('por_processar','processado','revisto')),
  texto              text,                              -- NULL = por transcrever
  texto_origem       text CHECK (texto_origem IN ('camada_texto','ocr_ia','manual')),
  metadados_origem   text CHECK (metadados_origem IN ('ia','regras','manual')),
  numero_antigo      text,                              -- '123/1987'
  ano                integer CHECK (ano BETWEEN 1800 AND 2100),
  tipo               text CHECK (tipo IN ('obras','loteamento','utilizacao','demolicao','ocupacao_via','publicidade','outro')),
  requerente         text,
  morada             text,
  freguesia          text,
  artigo_matricial   text,
  -- Chave da morada (sem acentos, abreviaturas por extenso): "mesma morada".
  morada_rua         text,
  morada_porta       text,
  -- Texto + metadados sem acentos, para a pesquisa por termos (pg_trgm).
  pesquisa           text NOT NULL DEFAULT '',
  tsv                tsvector GENERATED ALWAYS AS (
                       to_tsvector('pt_unaccent',
                         coalesce(numero_antigo,'') || ' ' || coalesce(requerente,'') || ' ' ||
                         coalesce(morada,'') || ' ' || coalesce(freguesia,'') || ' ' ||
                         coalesce(artigo_matricial,'') || ' ' || coalesce(texto,''))) STORED,
  embedding          vector(1024),
  erro               text,                              -- a última falha a processar
  municipe_id        uuid REFERENCES municipes(id),     -- ligação opcional a um munícipe atual
  processado_em      timestamptz,
  revisto_em         timestamptz,
  revisto_por        uuid REFERENCES utilizadores(id),
  criado_por         uuid REFERENCES utilizadores(id),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX arquivo_documentos_lista_idx ON arquivo_documentos (municipio_id, estado, criado_em DESC);
CREATE INDEX arquivo_documentos_ano_idx ON arquivo_documentos (municipio_id, ano);
CREATE INDEX arquivo_documentos_morada_idx ON arquivo_documentos (municipio_id, morada_rua);
CREATE INDEX arquivo_documentos_lote_idx ON arquivo_documentos (lote_id);
CREATE INDEX arquivo_documentos_tsv_idx ON arquivo_documentos USING gin (tsv);
CREATE INDEX arquivo_documentos_pesquisa_idx ON arquivo_documentos USING gin (pesquisa gin_trgm_ops);
CREATE INDEX arquivo_documentos_vec_idx ON arquivo_documentos USING hnsw (embedding vector_cosine_ops);

-- Ligação a processos atuais (a mesma obra, a mesma morada).
CREATE TABLE arquivo_documento_processos (
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  documento_id  uuid NOT NULL REFERENCES arquivo_documentos(id) ON DELETE CASCADE,
  processo_id   uuid NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  criado_por    uuid REFERENCES utilizadores(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id, processo_id)
);
CREATE INDEX arquivo_documento_processos_proc_idx ON arquivo_documento_processos (processo_id);

-- Pedidos de consulta (agente ou balcão), com a qualidade de quem pede (LADA).
CREATE TABLE arquivo_pedidos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  numero               text NOT NULL,                   -- 'ARQ 3/2026'
  municipe_id          uuid REFERENCES municipes(id),
  conversa_id          uuid REFERENCES conversas(id),
  canal                text NOT NULL CHECK (canal IN ('telefone','chat','sms','whatsapp','ia','balcao')),
  nome                 text,
  telefone             text,                            -- E.164
  procura              jsonb NOT NULL,                  -- { morada, ano, requerente, numero_antigo, descricao }
  qualidade            text NOT NULL CHECK (qualidade IN ('titular','interesse_legitimo')),
  interesse            text,                            -- o interesse legítimo, nas palavras da pessoa
  modalidade           text NOT NULL CHECK (modalidade IN ('presencial','copia_certificada')),
  documentos_provaveis integer NOT NULL DEFAULT 0,
  estado               text NOT NULL DEFAULT 'recebido'
                       CHECK (estado IN ('recebido','agendado','em_preparacao','pronto','encerrado')),
  responder_ate        date NOT NULL,
  config_usada         jsonb NOT NULL,
  marcado_para         timestamptz,
  local                text,
  paginas              integer CHECK (paginas > 0),
  taxa_cents           integer CHECK (taxa_cents >= 0),
  resultado            text CHECK (resultado IN ('consultado','entregue','recusado','sem_documentos','desistiu')),
  nota                 text,
  tratado_por          uuid REFERENCES utilizadores(id),
  encerrado_em         timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX arquivo_pedidos_lista_idx ON arquivo_pedidos (municipio_id, estado, responder_ate);
CREATE INDEX arquivo_pedidos_municipe_idx ON arquivo_pedidos (municipe_id);

-- Os documentos prováveis que o agente encontrou (o munícipe só soube quantos).
CREATE TABLE arquivo_pedido_documentos (
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  pedido_id     uuid NOT NULL REFERENCES arquivo_pedidos(id) ON DELETE CASCADE,
  documento_id  uuid NOT NULL REFERENCES arquivo_documentos(id) ON DELETE CASCADE,
  PRIMARY KEY (pedido_id, documento_id)
);
