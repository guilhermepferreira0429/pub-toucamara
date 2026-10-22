-- "Pergunte ao concelho": o que os munícipes sentem, lido nas conversas.
--
-- conversas.freguesia: a freguesia de que a conversa fala, quando se sabe
-- (dita pela pessoa, da morada de uma ocorrência, da demonstração). Não é a
-- morada da pessoa: só a freguesia. A análise usa também a freguesia da
-- morada preferida do munícipe e a da lista de contactos da ação social.
--
-- concelho_analises: cada pergunta feita (auditoria e histórico), com os
-- filtros, quantas conversas havia e quantas foram lidas, e a resposta já
-- sem dados pessoais. "Guardar" dá-lhe um título e põe-na na lista que a
-- chefia partilha (o link abre a mesma análise, sem a voltar a calcular).

ALTER TABLE conversas ADD COLUMN freguesia text
  CHECK (freguesia IS NULL OR length(trim(freguesia)) BETWEEN 2 AND 120);
CREATE INDEX conversas_freguesia_idx ON conversas (municipio_id, freguesia)
  WHERE freguesia IS NOT NULL;

CREATE TABLE concelho_analises (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  utilizador_id    uuid REFERENCES utilizadores(id) ON DELETE SET NULL,
  pergunta         text NOT NULL CHECK (length(pergunta) BETWEEN 3 AND 500),
  filtros          jsonb NOT NULL,
  resultado        jsonb NOT NULL,
  ia               boolean NOT NULL,
  conversas_total  integer NOT NULL CHECK (conversas_total >= 0),
  conversas_lidas  integer NOT NULL CHECK (conversas_lidas >= 0),
  ms               integer,
  titulo           text CHECK (titulo IS NULL OR length(titulo) BETWEEN 3 AND 140),
  guardada_em      timestamptz,
  guardada_por     uuid REFERENCES utilizadores(id) ON DELETE SET NULL,
  criada_em        timestamptz NOT NULL DEFAULT now(),
  CHECK ((guardada_em IS NULL) = (titulo IS NULL))
);
CREATE INDEX concelho_analises_utilizador_idx
  ON concelho_analises (municipio_id, utilizador_id, criada_em DESC, id DESC);
CREATE INDEX concelho_analises_guardadas_idx
  ON concelho_analises (municipio_id, guardada_em DESC, id DESC)
  WHERE guardada_em IS NOT NULL;
