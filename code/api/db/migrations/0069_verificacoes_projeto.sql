-- Verificações automáticas no apoio ao técnico (V2 · Apoio ao técnico, 22 out.):
-- PDM no local, instrução do processo, termo de responsabilidade, inscrição
-- do técnico na Ordem (simulada) e a leitura do projeto pela IA.
--
-- Cada vez que se verifica fica uma linha (não se reescreve): o que foi
-- verificado, quando, por quem e com que versão dos documentos e das regras.
-- A última linha com os mesmos hashes serve de cache; a leitura da IA
-- reaproveita-se enquanto os documentos forem os mesmos.
CREATE TABLE processo_verificacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  processo_id      uuid NOT NULL REFERENCES processos(id),
  versao_motor     text NOT NULL,                      -- muda quando as regras do código mudam
  documentos_hash  text NOT NULL,                      -- ids, ficheiros e estado da verificação dos documentos
  regras_hash      text NOT NULL,                      -- zonas do PDM, documentos exigidos, morada e tipo
  resultado        jsonb NOT NULL,                     -- [{codigo, estado, titulo, detalhe, evidencias, origem, a_confirmar, ...}]
  leitura_ia       jsonb,                              -- a leitura do projeto validada (null = não houve)
  leitura_ia_em    timestamptz,                        -- quando a IA leu (pode vir de uma linha anterior)
  gerado_por       uuid REFERENCES utilizadores(id),
  gerado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processo_verificacoes_idx ON processo_verificacoes (processo_id, gerado_em DESC);

-- Nome livre do documento quando não é de um tipo exigido ('Projeto de
-- arquitetura'), e marca dos dados de demonstração.
ALTER TABLE documentos ADD COLUMN descricao text;
ALTER TABLE processos ADD COLUMN demonstracao boolean NOT NULL DEFAULT false;

-- O parecer técnico passa a ser um rascunho como os outros (o tipo já existia
-- em documentos_gerados desde a 0001).
