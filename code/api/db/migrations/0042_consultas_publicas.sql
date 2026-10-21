-- Consulta pública por telefone, com resultados por freguesia ("Funcionalidades
-- que nos põem à frente", n.º 3; V4 n.º 11 "Consultas públicas: resumo das
-- participações"). A câmara cria a consulta no painel; o agente explica-a ao
-- telefone e no chat e regista a resposta; a página pública deixa participar
-- com o telemóvel (código por SMS). Uma participação por pessoa e consulta,
-- que a pessoa pode mudar até ao fim do prazo.

CREATE TABLE consultas_publicas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id      uuid NOT NULL REFERENCES municipios(id),
  codigo            text NOT NULL UNIQUE,                -- link da página pública (/consulta/CODIGO)
  titulo            text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 140),
  resumo            text NOT NULL,                       -- o que está em causa, em linguagem simples
  documento_titulo  text,                                -- o documento oficial em consulta
  documento_url     text,
  perguntas         jsonb NOT NULL,                      -- [{id, texto, opcoes: [{id, texto}]}]
  pergunta_aberta   text,                                -- NULL = sem opinião livre
  freguesias        text[],                              -- NULL = todo o concelho
  abre_em           date NOT NULL,
  fecha_em          date NOT NULL,                       -- último dia para participar
  relatorio_em      date NOT NULL,                       -- quando a câmara publica o relatório
  estado            text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','aberta','fechada')),
  resumo_opinioes   jsonb,                               -- último resumo das opiniões livres (IA ou contagens)
  resumo_gerado_em  timestamptz,
  criada_por        uuid REFERENCES utilizadores(id),
  criada_em         timestamptz NOT NULL DEFAULT now(),
  atualizada_em     timestamptz NOT NULL DEFAULT now(),
  aberta_em         timestamptz,
  fechada_em        timestamptz,
  CHECK (fecha_em >= abre_em),
  CHECK (relatorio_em >= fecha_em)
);
CREATE INDEX consultas_publicas_lista_idx ON consultas_publicas (municipio_id, criada_em DESC);
CREATE INDEX consultas_publicas_abertas_idx ON consultas_publicas (municipio_id, fecha_em)
  WHERE estado = 'aberta';

CREATE TABLE consulta_participacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id       uuid NOT NULL REFERENCES consultas_publicas(id),
  municipe_id       uuid NOT NULL REFERENCES municipes(id),
  respostas         jsonb NOT NULL,                      -- {"p1": "concordo"}
  opiniao           text,
  freguesia         text,
  freguesia_origem  text NOT NULL DEFAULT 'dita' CHECK (freguesia_origem IN ('dita','morada','anterior')),
  canal             text NOT NULL CHECK (canal IN ('telefone','chat','ia','pagina')),
  conversa_id       uuid REFERENCES conversas(id),
  alteracoes        integer NOT NULL DEFAULT 0,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  atualizada_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consulta_id, municipe_id)
);
CREATE INDEX consulta_participacoes_consulta_idx ON consulta_participacoes (consulta_id, criada_em);

-- Página pública: o código de 6 dígitos que chega por SMS (só o hash fica).
CREATE TABLE consulta_codigos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id    uuid NOT NULL REFERENCES consultas_publicas(id),
  telefone_e164  text NOT NULL,
  codigo_hash    bytea NOT NULL,
  tentativas     integer NOT NULL DEFAULT 0,
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consulta_codigos_consulta_idx ON consulta_codigos (consulta_id, criado_em DESC);

-- "A linha liga a mil munícipes": as campanhas de chamadas (módulo campanhas)
-- lançadas para uma consulta.
CREATE TABLE consulta_campanhas (
  consulta_id  uuid NOT NULL REFERENCES consultas_publicas(id),
  campanha_id  uuid NOT NULL REFERENCES campanhas(id),
  criada_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consulta_id, campanha_id)
);
CREATE INDEX consulta_campanhas_campanha_idx ON consulta_campanhas (campanha_id);
