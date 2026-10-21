-- Procedimentos internos: o "como se faz" da câmara, escrito por quem sabe.
-- Só para funcionários (o painel); nunca saem para o munícipe nem entram na
-- pesquisa do agente (isso é o conhecimento público: fontes e respostas).
--
-- Três peças:
--   * procedimentos (+ versões): título, área, passos, onde está cada coisa,
--     contactos internos, exceções, erros comuns; rascunho → publicado.
--   * entrevistas: quem se vai reformar responde a perguntas, uma a uma; no
--     fim fica um rascunho de procedimento para rever.
--   * assistente_perguntas: o que os funcionários novos perguntam ao
--     assistente interno; as que ficam sem resposta são procedimentos em falta.

CREATE TABLE entrevistas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  area             text NOT NULL,                 -- 'Ocupação da via pública'
  servico_id       uuid REFERENCES servicos(id),
  entrevistado_id  uuid NOT NULL REFERENCES utilizadores(id),
  modo             text NOT NULL CHECK (modo IN ('ia','guiao')),
  estado           text NOT NULL DEFAULT 'em_curso'
                     CHECK (estado IN ('em_curso','concluida','cancelada')),
  procedimento_id  uuid,                          -- o rascunho escrito no fim
  criada_em        timestamptz NOT NULL DEFAULT now(),
  concluida_em     timestamptz
);
CREATE INDEX entrevistas_lista_idx ON entrevistas (municipio_id, criada_em DESC, id DESC);

CREATE TABLE entrevista_turnos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrevista_id   uuid NOT NULL REFERENCES entrevistas(id) ON DELETE CASCADE,
  ordem           integer NOT NULL,
  chave           text NOT NULL,                  -- o_que, passos, onde, contactos, excecoes, erros, notas
  pergunta        text NOT NULL,
  resposta        text,
  por_voz         boolean NOT NULL DEFAULT false, -- ditada no browser e transcrita
  respondida_em   timestamptz,
  UNIQUE (entrevista_id, ordem)
);

CREATE TABLE procedimentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  titulo          text NOT NULL,
  area            text NOT NULL,
  servico_id      uuid REFERENCES servicos(id),
  resumo          text NOT NULL DEFAULT '',
  passos          jsonb NOT NULL DEFAULT '[]',    -- ["Receber o pedido no balcão", ...]
  onde_esta       jsonb NOT NULL DEFAULT '[]',    -- [{"o_que": "Minutas", "onde": "Pasta partilhada X"}]
  contactos       jsonb NOT NULL DEFAULT '[]',    -- [{"nome": "D. Rosa", "papel": "Fiscalização", "contacto": "ext. 214"}]
  excecoes        jsonb NOT NULL DEFAULT '[]',    -- ["Quando falta o seguro: ..."]
  erros_comuns    jsonb NOT NULL DEFAULT '[]',
  notas           text NOT NULL DEFAULT '',
  autor_id        uuid REFERENCES utilizadores(id),
  estado          text NOT NULL DEFAULT 'rascunho'
                    CHECK (estado IN ('rascunho','publicado','arquivado')),
  versao          integer NOT NULL DEFAULT 1,
  origem          text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','entrevista','lacuna')),
  entrevista_id   uuid REFERENCES entrevistas(id),
  publicado_em    timestamptz,
  publicado_por   uuid REFERENCES utilizadores(id),
  texto_pesquisa  text NOT NULL DEFAULT '',       -- montado na API (procedimentos/regras.ts)
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent', texto_pesquisa)) STORED,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procedimentos_lista_idx ON procedimentos (municipio_id, atualizado_em DESC, id DESC);
CREATE INDEX procedimentos_tsv_idx ON procedimentos USING gin (tsv);

ALTER TABLE entrevistas
  ADD CONSTRAINT entrevistas_procedimento_fk
  FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);

-- Cada gravação fica como versão (o que mudou, quem e quando).
CREATE TABLE procedimento_versoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedimento_id  uuid NOT NULL REFERENCES procedimentos(id) ON DELETE CASCADE,
  versao           integer NOT NULL,
  estado           text NOT NULL,
  conteudo         jsonb NOT NULL,                -- os campos editáveis nessa versão
  alterado_por     uuid REFERENCES utilizadores(id),
  nota             text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procedimento_id, versao)
);

CREATE TABLE assistente_perguntas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  utilizador_id    uuid REFERENCES utilizadores(id),
  pergunta         text NOT NULL,
  resposta         text,                          -- só com IA
  modo             text NOT NULL CHECK (modo IN ('ia','sem_ia')),
  fontes           jsonb NOT NULL DEFAULT '[]',   -- [{tipo, id, titulo, referencia}]
  estado           text NOT NULL CHECK (estado IN ('respondida','sem_resposta','tratada')),
  perguntar_a      jsonb,                         -- [{utilizador_id, nome, motivo}]
  procedimento_id  uuid REFERENCES procedimentos(id), -- o que se escreveu para a resolver
  tratada_por      uuid REFERENCES utilizadores(id),
  tratada_em       timestamptz,
  criada_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistente_perguntas_lacunas_idx
  ON assistente_perguntas (municipio_id, criada_em DESC) WHERE estado = 'sem_resposta';
