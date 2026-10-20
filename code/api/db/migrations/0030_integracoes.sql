-- V2 · Integrações: o sistema de gestão documental que a câmara já usa e a
-- planta de localização gerada pelo sistema (ver modules/integracoes).

-- ----------------------------------------------------------------------
-- Gestão documental
-- ----------------------------------------------------------------------

-- Configuração por município. Sem linha = 'nenhum'. Só a equipa interna
-- escreve (PUT /v1/painel/integracoes/gestao-documental).
CREATE TABLE gestao_documental_config (
  municipio_id    uuid PRIMARY KEY REFERENCES municipios(id),
  adaptador       text NOT NULL DEFAULT 'nenhum' CHECK (adaptador IN ('nenhum','simulado')),
  -- Só no simulado: fração dos envios que falham de propósito (reintentos).
  taxa_falha      numeric(3,2) NOT NULL DEFAULT 0 CHECK (taxa_falha >= 0 AND taxa_falha <= 1),
  atualizado_por  uuid REFERENCES utilizadores(id),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

-- O que não cabe nas colunas gd_* de processos: quando volta a tentar
-- (backoff), o último erro e quando sincronizou. A linha também serve de
-- trinco (SELECT ... FOR UPDATE SKIP LOCKED): o job e o "sincronizar já"
-- nunca enviam o mesmo processo ao mesmo tempo.
CREATE TABLE gd_sincronizacoes (
  processo_id          uuid PRIMARY KEY REFERENCES processos(id) ON DELETE CASCADE,
  proxima_tentativa_em timestamptz,
  ultima_tentativa_em  timestamptz,
  ultimo_erro          text,
  ultimo_erro_em       timestamptz,
  sincronizado_em      timestamptz
);

-- O que já foi enviado, seja qual for o adaptador: o registo do processo
-- (com a fase desse momento), cada documento (pela chave do ficheiro: um
-- ficheiro substituído volta a ir) e cada mudança de fase.
CREATE TABLE gd_envios (
  id            bigserial PRIMARY KEY,
  processo_id   uuid NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('processo','documento','fase')),
  gd_id         text NOT NULL,                        -- '2026/E/012345'
  documento_id  uuid REFERENCES documentos(id) ON DELETE SET NULL,
  ficheiro_key  text,
  fase          fase_processo,
  referencia    text,                                 -- o que o sistema devolveu (n.º do anexo)
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'documento' OR ficheiro_key IS NOT NULL),
  CHECK (tipo = 'documento' OR fase IS NOT NULL)
);
CREATE INDEX gd_envios_processo_idx ON gd_envios (processo_id, tipo, id);
CREATE INDEX gd_envios_documento_idx ON gd_envios (documento_id);

-- O adaptador simulado: o "sistema da câmara" é esta tabela. Fica o que foi
-- enviado, tal como iria, com números no formato típico ('2026/E/012345').
-- Sem FK para processos: o sistema da câmara não conhece as nossas chaves.
CREATE TABLE gd_simulado_registos (
  id            bigserial PRIMARY KEY,
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  gd_id         text NOT NULL,
  operacao      text NOT NULL CHECK (operacao IN ('registar','anexar','estado')),
  conteudo      jsonb NOT NULL,
  recebido_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gd_simulado_registos_idx ON gd_simulado_registos (municipio_id, gd_id, id);

CREATE TABLE gd_simulado_contadores (
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  ano           integer NOT NULL,
  ultimo        integer NOT NULL,
  PRIMARY KEY (municipio_id, ano)
);

-- Processos novos num município com adaptador: 'por_sincronizar' logo à
-- entrada, seja quem for que os cria (requerimento, email, painel). Assim o
-- módulo de processos não precisa de saber que a integração existe.
CREATE FUNCTION gd_processo_novo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gd_estado = 'nao_aplicavel' AND EXISTS (
       SELECT 1 FROM gestao_documental_config c
       WHERE c.municipio_id = NEW.municipio_id AND c.adaptador <> 'nenhum') THEN
    NEW.gd_estado := 'por_sincronizar';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER processos_gd_novo BEFORE INSERT ON processos
  FOR EACH ROW EXECUTE FUNCTION gd_processo_novo();

-- Mudança de fase num processo já sincronizado: volta a 'por_sincronizar'.
CREATE FUNCTION gd_processo_fase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fase IS DISTINCT FROM OLD.fase AND NEW.gd_estado = 'sincronizado' THEN
    NEW.gd_estado := 'por_sincronizar';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER processos_gd_fase BEFORE UPDATE OF fase ON processos
  FOR EACH ROW EXECUTE FUNCTION gd_processo_fase();

-- Documento novo (ou que passou para o processo, ou com outro ficheiro) num
-- processo já sincronizado: volta a 'por_sincronizar'. O job também varre os
-- sincronizados com diferenças, para o que um trigger deixe escapar.
CREATE FUNCTION gd_documento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.processo_id IS NOT NULL THEN
    UPDATE processos SET gd_estado = 'por_sincronizar'
    WHERE id = NEW.processo_id AND gd_estado = 'sincronizado';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER documentos_gd AFTER INSERT OR UPDATE OF processo_id, ficheiro_key ON documentos
  FOR EACH ROW EXECUTE FUNCTION gd_documento();

CREATE INDEX processos_gd_idx ON processos (municipio_id, gd_estado)
  WHERE gd_estado IN ('por_sincronizar','erro');

-- ----------------------------------------------------------------------
-- Planta de localização
-- ----------------------------------------------------------------------

-- Tentativas da geração automática (o job das plantas): sem isto, um
-- processo com uma morada que o Nominatim não encontra pedia-a a cada
-- 15 minutos, contra a política de uso do OpenStreetMap.
CREATE TABLE planta_tentativas (
  processo_id  uuid PRIMARY KEY REFERENCES processos(id) ON DELETE CASCADE,
  tentativas   integer NOT NULL DEFAULT 0,
  ultima_em    timestamptz NOT NULL DEFAULT now(),
  erro         text
);
