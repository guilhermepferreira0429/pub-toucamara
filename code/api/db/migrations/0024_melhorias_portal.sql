-- Perguntas sem resposta viram melhorias ao portal (PRD: "perguntas sem
-- resposta que levaram a melhorar o portal").
--
-- O job semanal `propor_melhorias` agrupa as perguntas sem resposta abertas
-- por assunto e propõe, para cada grupo, o texto que falta no site da câmara
-- (ou de outra entidade, ex. a empresa da água). A câmara envia a sugestão ao
-- responsável e marca-a publicada; as perguntas ligadas passam a 'resolvida'.
--
-- Ativa = 'proposta' ou 'enviada': uma pergunta só está numa melhoria ativa.
-- As "vezes" de uma melhoria são a soma das perguntas ligadas (calculadas na
-- leitura, para crescerem com as conversas novas).

CREATE TABLE melhorias_portal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  titulo              text NOT NULL,                    -- 'Horário do ecocentro ao fim de semana'
  o_que_falta         text NOT NULL,                    -- o que os munícipes procuram e o portal não diz
  sugestao            text NOT NULL,                    -- texto proposto, com '[a confirmar pela câmara: …]'
  -- 'nova_informacao': o portal não tem. 'tornar_visivel': as fontes já dizem,
  -- mas as pessoas não encontram (fonte_existente_id diz onde está).
  tipo                text NOT NULL DEFAULT 'nova_informacao'
                        CHECK (tipo IN ('nova_informacao','tornar_visivel')),
  onde                text,                             -- secção/página sugerida (título da página ou texto livre)
  onde_fonte_id       uuid REFERENCES fontes(id) ON DELETE SET NULL,      -- página do portal ('pagina') onde pôr
  fonte_existente_id  uuid REFERENCES fontes(id) ON DELETE SET NULL,      -- onde a resposta já existe
  entidade_id         uuid REFERENCES entidades(id),    -- de quem é a informação (Câmara, Vimágua...)
  servico_id          uuid REFERENCES servicos(id),     -- serviço responsável (email por omissão)
  estado              text NOT NULL DEFAULT 'proposta'
                        CHECK (estado IN ('proposta','enviada','publicada','rejeitada')),
  criada_em           timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  enviada_em          timestamptz,
  enviada_para        citext,
  publicada_em        timestamptz,
  rejeitada_em        timestamptz,
  notas               text
);

CREATE TABLE melhoria_perguntas (
  melhoria_id  uuid NOT NULL REFERENCES melhorias_portal(id) ON DELETE CASCADE,
  psr_id       uuid NOT NULL REFERENCES perguntas_sem_resposta(id) ON DELETE CASCADE,
  PRIMARY KEY (melhoria_id, psr_id)
);
-- "Esta pergunta já está numa melhoria ativa?"
CREATE INDEX melhoria_perguntas_psr_idx ON melhoria_perguntas (psr_id);

CREATE INDEX melhorias_portal_painel_idx ON melhorias_portal (municipio_id, estado, criada_em DESC);
