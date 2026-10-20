-- V2: a câmara edita as respostas curadas e aprova os seus modelos de
-- resposta (ofícios, emails, SMS). Funcionalidades, secção 12; plano 4.3 e 4.5.

-- ---------------------------------------------------------------------------
-- Respostas curadas escritas pela câmara
-- ---------------------------------------------------------------------------

-- Por município, a equipa interna liga a edição pela câmara (desligada = V1:
-- só a equipa escreve e publica).
CREATE TABLE conhecimento_definicoes (
  municipio_id            uuid PRIMARY KEY REFERENCES municipios(id),
  camara_edita_respostas  boolean NOT NULL DEFAULT false,
  atualizado_por          uuid REFERENCES utilizadores(id),
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);

-- Quem escreveu cada versão e o que mudou nos factos (números, prazos,
-- telefones, emails) face à base: a versão no ar quando foi escrita, ou a
-- anterior. Versões da câmara que mudam factos precisam de revisão interna
-- (ou de uma avaliação posterior) antes de ir para o ar.
ALTER TABLE resposta_versoes
  ADD COLUMN origem          text NOT NULL DEFAULT 'equipa' CHECK (origem IN ('equipa','camara')),
  ADD COLUMN base_versao_id  uuid REFERENCES resposta_versoes(id) ON DELETE SET NULL,
  ADD COLUMN factos          jsonb,              -- {adicionados:{numeros,telefones,emails}, removidos:{...}}
  ADD COLUMN muda_factos     boolean NOT NULL DEFAULT false,
  ADD COLUMN reverte_de      uuid REFERENCES resposta_versoes(id) ON DELETE SET NULL,
  ADD COLUMN revisao         text CHECK (revisao IN ('aprovada','rejeitada')),
  ADD COLUMN revista_por     uuid REFERENCES utilizadores(id),
  ADD COLUMN revista_em      timestamptz,
  ADD COLUMN revisao_nota    text;

-- Fila da equipa interna: versões da câmara por publicar.
CREATE INDEX resposta_versoes_camara_idx ON resposta_versoes (resposta_id, numero DESC)
  WHERE origem = 'camara' AND publicada_em IS NULL;
CREATE INDEX psr_resposta_idx ON perguntas_sem_resposta (resposta_id) WHERE resposta_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Modelos de resposta aprovados pela câmara
-- ---------------------------------------------------------------------------

-- Cada versão é uma linha; as versões do mesmo modelo partilham `familia_id`
-- (o id da primeira). Editar um modelo aprovado cria a versão seguinte em
-- rascunho e a aprovada continua em uso (os rascunhos do técnico leem
-- `estado = 'aprovado'`) até a nova ser aprovada: aí passa a 'substituido'.
ALTER TABLE modelos_resposta
  ADD COLUMN familia_id      uuid REFERENCES modelos_resposta(id),
  ADD COLUMN criado_por      uuid REFERENCES utilizadores(id),
  ADD COLUMN criado_em       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN atualizado_por  uuid REFERENCES utilizadores(id),
  ADD COLUMN atualizado_em   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN substituido_em  timestamptz;

UPDATE modelos_resposta SET familia_id = id WHERE familia_id IS NULL;

-- Sem `familia_id`, a linha começa a sua própria família.
CREATE FUNCTION modelos_resposta_familia() RETURNS trigger AS $$
BEGIN
  NEW.familia_id := coalesce(NEW.familia_id, NEW.id);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER modelos_resposta_familia BEFORE INSERT ON modelos_resposta
  FOR EACH ROW EXECUTE FUNCTION modelos_resposta_familia();
ALTER TABLE modelos_resposta ALTER COLUMN familia_id SET NOT NULL;

ALTER TABLE modelos_resposta DROP CONSTRAINT IF EXISTS modelos_resposta_estado_check;
ALTER TABLE modelos_resposta ADD CONSTRAINT modelos_resposta_estado_check
  CHECK (estado IN ('rascunho','a_rever','aprovado','substituido'));

-- Uma versão por número em cada família e, no máximo, uma em curso.
CREATE UNIQUE INDEX modelos_resposta_versao_uidx ON modelos_resposta (familia_id, versao);
CREATE UNIQUE INDEX modelos_resposta_em_curso_uidx ON modelos_resposta (familia_id)
  WHERE estado IN ('rascunho','a_rever');
CREATE INDEX modelos_resposta_lista_idx ON modelos_resposta (municipio_id, canal, estado);
