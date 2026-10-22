-- "Diga-me a morada e eu digo-lhe o que pode fazer": as zonas do plano
-- diretor municipal (PDM) com as regras de cada obra simples (anexo, muro,
-- piscina, ampliação, fachada). O agente encontra a morada no mapa, vê a
-- zona e diz se é isento, comunicação prévia, licença ou não permitido.
--
-- Na semana do hackathon há zonas de DEMONSTRAÇÃO (marcadas): a câmara
-- carrega as do seu PDM. Polígonos em [[lat, lng], ...]; PostGIS na V2.

CREATE TABLE zonas_pdm (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  codigo         text NOT NULL,                       -- 'ERC'
  nome           text NOT NULL,                       -- 'Espaço residencial consolidado'
  categoria      text NOT NULL CHECK (categoria IN ('urbano','protecao','agricola','florestal')),
  descricao      text,
  poligono       jsonb NOT NULL,                      -- [[lat, lng], ...]
  regras         jsonb NOT NULL,                      -- {anexo: {controlo, area_max_m2, altura_max_m, limites[], notas}, ...}
  fonte          jsonb NOT NULL,                      -- {titulo, artigo, url}
  demonstracao   boolean NOT NULL DEFAULT false,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, codigo)
);

-- Cada pergunta feita: o mapa do que as pessoas querem fazer e onde, e a
-- página do link do SMS (planta e passos).
CREATE TABLE consultas_pdm (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  conversa_id    uuid REFERENCES conversas(id),
  municipe_id    uuid REFERENCES municipes(id),
  morada         text NOT NULL,
  lat            double precision,
  lng            double precision,
  zona_id        uuid REFERENCES zonas_pdm(id),
  obra           text NOT NULL,
  resultado      jsonb NOT NULL,                      -- {controlo, limites, passos, dizer}
  codigo         text NOT NULL UNIQUE,                -- /zona/{codigo}
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultas_pdm_lista_idx ON consultas_pdm (municipio_id, criada_em DESC);
