-- "O que se passa no concelho, perto de mim": um feed com o que acontece numa
-- zona (ruas cortadas, incidentes, avisos, eventos, consultas públicas), para
-- a app do munícipe, para o agente (ferramenta o_que_se_passa) e por SMS
-- (OBRAS, AVISOS, EVENTOS, INCIDENTES). O feed lê o que já existe (licenças,
-- avisos por zona, emergências, ocorrências, consultas públicas); esta
-- migração junta o que a câmara publica à mão (comunicados, notícias e
-- eventos), a morada preferida do munícipe e as subscrições "avise-me".

-- Comunicados e notícias publicados pela câmara.
CREATE TABLE comunicados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  tipo          text NOT NULL CHECK (tipo IN ('comunicado','noticia')),
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 140),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 3 AND 5000),
  imagem_url    text CHECK (imagem_url ~ '^https?://'),
  freguesias    text[],                               -- NULL = todo o concelho
  estado        text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','publicado')),
  publicado_em  timestamptz,
  criado_por    uuid REFERENCES utilizadores(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (estado = 'rascunho' OR publicado_em IS NOT NULL)
);
CREATE INDEX comunicados_lista_idx ON comunicados (municipio_id, criado_em DESC, id DESC);
CREATE INDEX comunicados_publicados_idx ON comunicados (municipio_id, publicado_em DESC)
  WHERE estado = 'publicado';

-- Eventos publicados pela câmara (feiras, concertos, festas do concelho).
CREATE TABLE eventos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 140),
  descricao     text NOT NULL CHECK (length(descricao) BETWEEN 3 AND 3000),
  local         text NOT NULL CHECK (length(local) BETWEEN 2 AND 200),
  lat           double precision CHECK (lat BETWEEN -90 AND 90),
  lng           double precision CHECK (lng BETWEEN -180 AND 180),
  inicio        timestamptz NOT NULL,
  fim           timestamptz,
  freguesia     text,                                 -- NULL = do concelho todo
  link          text CHECK (link ~ '^https?://'),
  estado        text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','publicado')),
  publicado_em  timestamptz,
  criado_por    uuid REFERENCES utilizadores(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim IS NULL OR fim >= inicio),
  CHECK ((lat IS NULL) = (lng IS NULL)),
  CHECK (estado = 'rascunho' OR publicado_em IS NOT NULL)
);
CREATE INDEX eventos_lista_idx ON eventos (municipio_id, inicio DESC, id DESC);
CREATE INDEX eventos_publicados_idx ON eventos (municipio_id, inicio)
  WHERE estado = 'publicado';

-- Onde fica cada licença e ocorrência sem coordenadas: o job geocodifica a
-- RUA (nunca o número de porta) e guarda aqui, para o feed não chamar o
-- Nominatim em cada pedido. Sem resultado fica lat/lng NULL e tenta-se de
-- novo passados uns dias.
CREATE TABLE agora_locais (
  fonte         text NOT NULL CHECK (fonte IN ('licenca','ocorrencia')),
  fonte_id      uuid NOT NULL,
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  lat           double precision,
  lng           double precision,
  freguesia     text,
  tentado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fonte, fonte_id)
);

-- A morada preferida do munícipe (para o feed perto de si, por SMS ou pelo
-- agente): só a rua, sem número de porta, e/ou a freguesia. `sms_espera`: o
-- que pediu por SMS enquanto esperamos que diga a rua ou a freguesia
-- ('obras', 'avisar:obras,eventos'...).
ALTER TABLE municipes
  ADD COLUMN morada_rua           text,
  ADD COLUMN morada_freguesia     text,
  ADD COLUMN morada_lat           double precision,
  ADD COLUMN morada_lng           double precision,
  ADD COLUMN morada_atualizada_em timestamptz,
  ADD COLUMN sms_espera           text,
  ADD COLUMN sms_espera_em        timestamptz;

-- Subscrições "avise-me": uma zona (rua com raio, ou freguesia) e os tipos.
CREATE TABLE agora_subscricoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  municipe_id   uuid NOT NULL REFERENCES municipes(id),
  tipos         text[] NOT NULL CHECK (cardinality(tipos) > 0
                  AND tipos <@ ARRAY['obras','incidentes','eventos','avisos']::text[]),
  rua           text,                                 -- descrição (só a rua)
  lat           double precision,
  lng           double precision,
  raio_m        integer CHECK (raio_m BETWEEN 50 AND 5000),
  freguesia     text,
  canal         text NOT NULL CHECK (canal IN ('telefone','chat','ia','sms','whatsapp','app')),
  ativa         boolean NOT NULL DEFAULT true,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  cancelada_em  timestamptz,
  CHECK ((lat IS NOT NULL AND lng IS NOT NULL AND raio_m IS NOT NULL) OR freguesia IS NOT NULL)
);
CREATE INDEX agora_subscricoes_ativas_idx ON agora_subscricoes (municipio_id) WHERE ativa;
CREATE INDEX agora_subscricoes_municipe_idx ON agora_subscricoes (municipe_id);

-- Os avisos já dados: um por item e subscrição, e um por item e pessoa (duas
-- subscrições da mesma pessoa que batem no mesmo item dão um SMS só).
CREATE TABLE agora_avisos_enviados (
  subscricao_id  uuid NOT NULL REFERENCES agora_subscricoes(id),
  municipe_id    uuid NOT NULL REFERENCES municipes(id),
  item           text NOT NULL,                       -- '<fonte>:<id>'
  canal          text,                                -- 'sms', 'push' ou NULL (sem contacto)
  mensagem_id    uuid REFERENCES mensagens_saida(id),
  enviado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscricao_id, item),
  UNIQUE (municipe_id, item)
);

-- O que a pessoa pediu por SMS (as palavras novas e a resposta com a rua).
ALTER TABLE sms_recebidos DROP CONSTRAINT sms_recebidos_intencao_check;
ALTER TABLE sms_recebidos ADD CONSTRAINT sms_recebidos_intencao_check
  CHECK (intencao IN ('estado','parar','ajuda','ignorado',
    'obras','avisos','eventos','incidentes','avisar','morada'));

-- RGPD: anonimizar o munícipe apaga a morada preferida e desliga as
-- subscrições (sem mexer no serviço do RGPD).
CREATE FUNCTION agora_anonimizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anonimizado_em IS NOT NULL AND OLD.anonimizado_em IS NULL THEN
    NEW.morada_rua := NULL;
    NEW.morada_freguesia := NULL;
    NEW.morada_lat := NULL;
    NEW.morada_lng := NULL;
    NEW.sms_espera := NULL;
    NEW.sms_espera_em := NULL;
    -- A freguesia fica (não identifica ninguém) para a linha cumprir o CHECK.
    UPDATE agora_subscricoes SET ativa = false,
      cancelada_em = coalesce(cancelada_em, now()),
      rua = NULL, lat = NULL, lng = NULL, raio_m = NULL,
      freguesia = coalesce(freguesia, '(anonimizado)')
    WHERE municipe_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER municipes_agora_anonimizar BEFORE UPDATE OF anonimizado_em ON municipes
  FOR EACH ROW EXECUTE FUNCTION agora_anonimizar();
