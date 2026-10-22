-- Balcão para empresas (FUN §4): a lista personalizada do que uma empresa
-- precisa (registo da atividade, obras, publicidade, esplanada, eventos,
-- ocupação da via pública...) e o calendário de obrigações (renovações,
-- taxas e prazos).
--
-- O catálogo por omissão está no código (empresas/catalogo.ts, valores de
-- demonstração com o regime legal citado). A câmara afina-o no painel: cada
-- requisito alterado (ou novo) fica aqui e substitui o do código com a
-- mesma chave. Apagar a linha repõe o do código.

CREATE TABLE empresa_requisitos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  chave          text NOT NULL CHECK (chave ~ '^[a-z0-9_]{2,60}$'),
  requisito      jsonb NOT NULL,          -- ver empresas/balcao-empresas.regras.ts (esquemaRequisito)
  atualizado_por uuid REFERENCES utilizadores(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, chave)
);

-- As listas geradas (página partilhável /empresas/{codigo}). Só o perfil da
-- atividade (sem nome, NIF, morada nem telefone) e o resultado. As do agente
-- ficam ligadas à conversa (o perfil junta-se de chamada em chamada); as do
-- calendário de uma empresa identificada (tipo 'obrigacoes') têm o munícipe
-- e expiram, porque mostram os números das licenças dele.
CREATE TABLE empresa_listas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  tipo          text NOT NULL DEFAULT 'lista' CHECK (tipo IN ('lista','obrigacoes')),
  codigo        text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9]{8}$'),
  canal         text NOT NULL CHECK (canal IN ('web','telefone','chat','ia','sms','whatsapp','painel')),
  conversa_id   uuid REFERENCES conversas(id),
  municipe_id   uuid REFERENCES municipes(id),
  perfil        jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado     jsonb NOT NULL,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz,
  CHECK (tipo = 'lista' OR municipe_id IS NOT NULL)
);
CREATE INDEX empresa_listas_municipio_idx ON empresa_listas (municipio_id, criada_em DESC);
CREATE INDEX empresa_listas_conversa_idx ON empresa_listas (conversa_id, tipo)
  WHERE conversa_id IS NOT NULL;

-- RGPD: anonimizar o munícipe desliga-o das listas e apaga os calendários
-- dele (têm os números das licenças).
CREATE FUNCTION empresa_listas_anonimizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anonimizado_em IS NOT NULL AND OLD.anonimizado_em IS NULL THEN
    DELETE FROM empresa_listas WHERE municipe_id = NEW.id AND tipo = 'obrigacoes';
    UPDATE empresa_listas SET municipe_id = NULL WHERE municipe_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER municipes_empresa_listas_anonimizar BEFORE UPDATE OF anonimizado_em ON municipes
  FOR EACH ROW EXECUTE FUNCTION empresa_listas_anonimizar();
