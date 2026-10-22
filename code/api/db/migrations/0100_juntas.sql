-- Versão para as juntas de freguesia (FUN §14, PRD "Caminho").
--
-- Uma junta é um tenant como uma câmara: uma linha em `municipios` com
-- tipo = 'junta'. Assim reusa tudo o que já tem `municipio_id` (agente,
-- chat, conhecimento, ocorrências, painel, RLS por município, auditoria)
-- sem duplicar tabelas. O que a junta não tem (urbanismo, licenças, PDM…)
-- esconde-se por tipo no código (modules/juntas/funcionalidades.ts).
--
-- concelho_id: a câmara do concelho onde fica a junta (para encaminhar nos
-- dois sentidos). freguesias: os nomes das freguesias que a junta serve
-- (uma união de freguesias tem várias), para reconhecer a freguesia da
-- morada. demonstracao: junta criada pelo "Preparar demo".

ALTER TABLE municipios
  ADD COLUMN tipo text NOT NULL DEFAULT 'camara' CHECK (tipo IN ('camara','junta')),
  ADD COLUMN concelho_id uuid REFERENCES municipios(id),
  ADD COLUMN freguesias text[],
  ADD COLUMN demonstracao boolean NOT NULL DEFAULT false;

ALTER TABLE municipios ADD CONSTRAINT municipios_junta_check CHECK (
  (tipo = 'camara' AND concelho_id IS NULL)
  OR (tipo = 'junta' AND concelho_id IS NOT NULL AND concelho_id <> id
      AND coalesce(array_length(freguesias, 1), 0) > 0)
);

CREATE INDEX municipios_concelho_idx ON municipios (concelho_id) WHERE tipo = 'junta';

-- Pedidos de atestado e de prova de vida. O agente recolhe e confirma os
-- dados; o funcionário da junta emite no painel (PDF com QR) ou recusa, e a
-- pessoa recebe SMS com o link. Quando o pedido vem do agente da câmara
-- (encaminhado pela freguesia da morada) fica a câmara de origem.
CREATE TABLE atestados (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id          uuid NOT NULL REFERENCES municipios(id),   -- a junta
  numero                text NOT NULL,                             -- 'AT 12/2026'
  tipo                  text NOT NULL CHECK (tipo IN
                          ('residencia','agregado_familiar','situacao_economica','prova_vida')),
  estado                text NOT NULL DEFAULT 'pedido' CHECK (estado IN ('pedido','emitido','recusado')),
  municipe_id           uuid REFERENCES municipes(id),
  nome                  text NOT NULL CHECK (length(trim(nome)) BETWEEN 3 AND 160),
  morada                text NOT NULL CHECK (length(trim(morada)) BETWEEN 5 AND 300),
  freguesia             text NOT NULL,
  finalidade            text,
  -- Os dados próprios do tipo: agregado [{nome, parentesco}], rendimento
  -- declarado, entidade da pensão, se pode ir à junta…
  dados                 jsonb NOT NULL DEFAULT '{}',
  canal                 text NOT NULL DEFAULT 'telefone',
  conversa_id           uuid REFERENCES conversas(id),
  origem_municipio_id   uuid REFERENCES municipios(id),            -- a câmara que encaminhou
  confirmado_em         timestamptz NOT NULL DEFAULT now(),       -- dados lidos e confirmados
  codigo_verificacao    text UNIQUE NOT NULL,                      -- QR e link do SMS
  emitido_por           uuid REFERENCES utilizadores(id),
  emitido_em            timestamptz,
  texto_emitido         text,                                      -- o que ficou no PDF
  motivo_recusa         text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero),
  CHECK (estado <> 'emitido' OR emitido_em IS NOT NULL),
  CHECK (estado <> 'recusado' OR motivo_recusa IS NOT NULL)
);
CREATE INDEX atestados_lista_idx ON atestados (municipio_id, estado, criado_em DESC);
CREATE INDEX atestados_municipe_idx ON atestados (municipe_id, criado_em DESC);

-- SMS do atestado (pedido registado, emitido, recusado). Acrescenta à lista
-- em vigor (outras migrações desta semana também mexem nela).
DO $$
DECLARE
  def text;
  valores text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'mensagens_saida_motivo_check'
    AND conrelid = 'mensagens_saida'::regclass;
  IF def IS NULL OR def LIKE '%''atestado''%' THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_literal(m[1]), ',') INTO valores
  FROM regexp_matches(def, '''([a-z_]+)''', 'g') AS m;
  EXECUTE 'ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check';
  EXECUTE format(
    'ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check CHECK (motivo IN (%s,%L))',
    valores, 'atestado');
END $$;
