-- Linguagem simples nos editais e regulamentos (FUN §14) e o tradutor de
-- linguagem administrativa (CONC, ideia 5).
--
-- Um documento simples é a versão em português claro de uma fonte oficial do
-- conhecimento (edital, regulamento, aviso, deliberação). Cada versão simples
-- fica presa à versão EXATA do texto oficial de onde foi feita
-- (fonte_versao_id): quando a fonte muda, a versão simples publicada passa a
-- "desatualizada" (calcula-se: a versão atual da fonte já não é aquela).
-- Nada chega ao munícipe sem revisão humana: só a versão 'publicada' é
-- pública, e publicar regista quem reviu.

CREATE TABLE documentos_simples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  fonte_id      uuid NOT NULL UNIQUE REFERENCES fontes(id),
  codigo        text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9]{6,16}$'), -- página /documento/{codigo}
  tipo          text NOT NULL CHECK (tipo IN ('edital','regulamento','aviso','deliberacao','lei','outro')),
  criado_por    uuid REFERENCES utilizadores(id),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documentos_simples_municipio_idx ON documentos_simples (municipio_id);

CREATE TABLE documento_simples_versoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  documento_id     uuid NOT NULL REFERENCES documentos_simples(id) ON DELETE CASCADE,
  numero           integer NOT NULL CHECK (numero > 0),
  fonte_versao_id  uuid NOT NULL REFERENCES fonte_versoes(id),
  hash_original    text NOT NULL,                     -- fonte_versoes.hash quando se escreveu
  estado           text NOT NULL DEFAULT 'rascunho'
                   CHECK (estado IN ('rascunho','publicada','substituida','descartada','retirada')),
  -- ia: escrita pela IA; extrativo: excertos do original (sem IA), tem de
  -- ser reescrita antes de publicar; manual: escrita por uma pessoa.
  origem           text NOT NULL CHECK (origem IN ('ia','extrativo','manual')),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 200),
  resumo           text NOT NULL CHECK (length(resumo) <= 1000),
  -- [{chave, titulo, texto, seccoes: ['s3'], trechos: [uuid]}]: cada parte
  -- aponta para as secções (artigos) e os trechos do original de onde vem.
  partes           jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(partes) = 'array'),
  criada_por       uuid REFERENCES utilizadores(id),
  criada_em        timestamptz NOT NULL DEFAULT now(),
  editada_por      uuid REFERENCES utilizadores(id),
  editada_em       timestamptz,
  revista_por      uuid REFERENCES utilizadores(id),
  publicada_em     timestamptz,
  retirada_em      timestamptz,
  UNIQUE (documento_id, numero),
  CHECK (estado NOT IN ('publicada','substituida','retirada') OR (revista_por IS NOT NULL AND publicada_em IS NOT NULL))
);
-- Uma publicada e um rascunho de cada vez por documento.
CREATE UNIQUE INDEX documento_simples_publicada_idx
  ON documento_simples_versoes (documento_id) WHERE estado = 'publicada';
CREATE UNIQUE INDEX documento_simples_rascunho_idx
  ON documento_simples_versoes (documento_id) WHERE estado = 'rascunho';
CREATE INDEX documento_simples_versoes_fonte_idx
  ON documento_simples_versoes (fonte_versao_id) WHERE estado = 'publicada';

-- Glossário administrativo: termos com explicação simples, editáveis pela
-- câmara. Os termos iniciais entram pelo painel ("carregar termos de
-- demonstração") com demonstracao = true até alguém da câmara os validar.
CREATE TABLE glossario_termos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  termo          text NOT NULL CHECK (length(termo) BETWEEN 2 AND 80),
  variantes      text[] NOT NULL DEFAULT '{}',        -- plurais, siglas, outras formas
  explicacao     text NOT NULL CHECK (length(explicacao) BETWEEN 10 AND 600),
  exemplo        text CHECK (exemplo IS NULL OR length(exemplo) <= 400),
  fonte_legal    text CHECK (fonte_legal IS NULL OR length(fonte_legal) <= 200),
  demonstracao   boolean NOT NULL DEFAULT false,
  ativo          boolean NOT NULL DEFAULT true,
  criado_por     uuid REFERENCES utilizadores(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES utilizadores(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX glossario_termos_termo_idx ON glossario_termos (municipio_id, lower(termo));
