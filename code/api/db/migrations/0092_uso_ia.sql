-- Registo do uso da IA: cada pedido à Claude (fora e dentro do chat), com
-- tokens, custo estimado e a que diz respeito (conversa, processo, email...).
-- Serve o custo por atendimento no painel, o teto mensal e a transparência
-- ("onde e como a IA foi usada neste processo"). Nunca guarda o texto.

CREATE TABLE uso_ia (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid REFERENCES municipios(id),   -- null: tarefas da plataforma
  em                 timestamptz NOT NULL DEFAULT now(),
  tarefa             text NOT NULL,                     -- 'chat', 'resumo_conversa', 'classificar_email'...
  modelo             text NOT NULL,
  resultado          text NOT NULL CHECK (resultado IN ('ok','erro','recusa','limite')),
  tokens_entrada     integer NOT NULL DEFAULT 0,
  tokens_saida       integer NOT NULL DEFAULT 0,
  tokens_cache_lidos integer NOT NULL DEFAULT 0,
  tokens_cache_escritos integer NOT NULL DEFAULT 0,
  custo_microdolares bigint NOT NULL DEFAULT 0,
  duracao_ms         integer,
  alvo_tipo          text,                              -- 'conversa', 'processo', 'email', 'fonte'...
  alvo_id            uuid,
  dados_minimizados  boolean NOT NULL DEFAULT false,    -- telefones, NIF, emails trocados por etiquetas
  instrucoes_detetadas integer NOT NULL DEFAULT 0       -- passagens externas que pareciam ordens à IA
);

CREATE INDEX uso_ia_municipio_em_idx ON uso_ia (municipio_id, em DESC);
CREATE INDEX uso_ia_alvo_idx ON uso_ia (alvo_tipo, alvo_id) WHERE alvo_id IS NOT NULL;
