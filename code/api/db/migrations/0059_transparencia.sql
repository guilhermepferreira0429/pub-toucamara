-- Transparência: dados abertos e indicadores no portal (V3 · FUN §13, ponto 10).
--
-- Os conjuntos de dados estão definidos em código (transparencia/conjuntos.ts):
-- só números agregados, com as contagens pequenas (< 5) escondidas. Aqui
-- fica o que a câmara ligou e o histórico do que foi publicado (cada
-- publicação guarda as linhas e o CSV tal como saíram, para se poder
-- descarregar mais tarde exatamente o mesmo ficheiro).

-- A câmara liga ou desliga cada conjunto. Sem linha = desligado (publicar
-- dados é sempre uma decisão da câmara).
CREATE TABLE dados_abertos_conjuntos (
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  conjunto      text NOT NULL,                       -- id do conjunto em código ('ocorrencias', ...)
  ativo         boolean NOT NULL DEFAULT false,
  alterado_por  uuid REFERENCES utilizadores(id),
  alterado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipio_id, conjunto)
);

-- Cada publicação (snapshot). O trabalho diário só grava uma nova quando o
-- conteúdo mudou; senão atualiza `confirmado_em` da última.
CREATE TABLE dados_abertos_publicacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  conjunto       text NOT NULL,
  versao         integer NOT NULL,                   -- versão da definição em código
  periodo_de     date NOT NULL,
  periodo_ate    date NOT NULL,
  colunas        jsonb NOT NULL,                     -- [{nome, tipo, descricao}]
  linhas         jsonb NOT NULL,                     -- já com as contagens pequenas escondidas
  resumo         jsonb NOT NULL DEFAULT '{}',        -- totais por mês (para os indicadores)
  n_linhas       integer NOT NULL CHECK (n_linhas >= 0),
  csv            text NOT NULL,
  hash           text NOT NULL,                      -- sha256 do CSV
  bytes_csv      integer NOT NULL,
  bytes_json     integer NOT NULL,
  csv_key        text,                               -- S3, se houver armazenamento
  json_key       text,
  origem         text NOT NULL CHECK (origem IN ('automatica','manual')),
  gerado_por     uuid REFERENCES utilizadores(id),
  gerado_em      timestamptz NOT NULL DEFAULT now(),
  confirmado_em  timestamptz NOT NULL DEFAULT now(), -- última vez que o trabalho viu o mesmo conteúdo
  CHECK (periodo_ate >= periodo_de)
);
CREATE INDEX dados_abertos_publicacoes_idx
  ON dados_abertos_publicacoes (municipio_id, conjunto, gerado_em DESC, id DESC);
