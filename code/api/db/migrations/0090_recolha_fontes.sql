-- Recolha das fontes (scrapers): hora diária por município, próxima leitura
-- por fonte, pedido condicional, seletor CSS, robots.txt, sites com descoberta
-- de páginas e o histórico de cada leitura.

-- A que horas (no fuso do município) se leem as fontes diárias ou mais espaçadas.
ALTER TABLE municipios ADD COLUMN hora_recolha time NOT NULL DEFAULT '03:00';

-- Sites: a partir de um endereço (e do sitemap, se houver) descobrem-se as
-- páginas e cada uma passa a ser uma fonte.
CREATE TABLE fonte_sites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id          uuid NOT NULL REFERENCES municipios(id),
  entidade_id           uuid NOT NULL REFERENCES entidades(id),
  titulo                text NOT NULL,
  url_inicial           text NOT NULL,
  sitemap_url           text,                         -- vazio: tenta /sitemap.xml e depois segue links
  incluir               text[] NOT NULL DEFAULT '{}', -- prefixos de caminho; vazio = a pasta do endereço inicial
  excluir               text[] NOT NULL DEFAULT '{}',
  profundidade          integer NOT NULL DEFAULT 2 CHECK (profundidade BETWEEN 0 AND 5),
  max_paginas           integer NOT NULL DEFAULT 100 CHECK (max_paginas BETWEEN 1 AND 2000),
  tipo_fontes           text NOT NULL DEFAULT 'pagina'
                          CHECK (tipo_fontes IN ('lei','regulamento','tabela','pagina','formulario','plano','contactos','turismo')),
  ler_a_cada            interval NOT NULL DEFAULT '1 day',   -- das fontes que cria
  descobrir_a_cada      interval NOT NULL DEFAULT '7 days',
  ativo                 boolean NOT NULL DEFAULT true,
  ultima_descoberta_em  timestamptz,
  proxima_descoberta_em timestamptz,
  paginas_encontradas   integer,
  erro                  text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, url_inicial)
);

ALTER TABLE fontes
  ADD COLUMN proxima_leitura_em timestamptz,
  ADD COLUMN etag text,
  ADD COLUMN ultima_modificacao text,           -- Last-Modified, tal como veio
  ADD COLUMN seletor text,                      -- CSS: só esta parte da página
  ADD COLUMN ignorar_robots boolean NOT NULL DEFAULT false,
  ADD COLUMN falhas_seguidas integer NOT NULL DEFAULT 0,
  ADD COLUMN arquivada_em timestamptz,          -- deixa de ser lida; as versões ficam
  ADD COLUMN site_id uuid REFERENCES fonte_sites(id) ON DELETE SET NULL,
  ADD COLUMN titulo_automatico boolean NOT NULL DEFAULT false;  -- da descoberta: troca-se pelo <title>

-- Até aqui a próxima leitura era ultima_leitura_em + ler_a_cada: mantém-se.
UPDATE fontes SET proxima_leitura_em = ultima_leitura_em + ler_a_cada
WHERE ultima_leitura_em IS NOT NULL;

CREATE INDEX fontes_vencidas_idx ON fontes (proxima_leitura_em)
  WHERE leitura_automatica AND arquivada_em IS NULL;

-- Cada leitura de cada fonte (o painel mostra as últimas; 90 dias).
CREATE TABLE fonte_leituras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id     uuid NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  iniciada_em  timestamptz NOT NULL DEFAULT now(),
  duracao_ms   integer NOT NULL,
  http_estado  integer,
  bytes        integer,
  resultado    text NOT NULL CHECK (resultado IN ('mudou','igual','nao_modificado','erro')),
  codigo_erro  text,
  erro         text,
  aviso        text                             -- ex.: o texto encolheu para menos de metade
);
CREATE INDEX fonte_leituras_fonte_idx ON fonte_leituras (fonte_id, iniciada_em DESC);
CREATE INDEX fonte_leituras_data_idx ON fonte_leituras (iniciada_em);
