-- Perguntas da chefia em linguagem normal (painel · "Perguntar").
--
-- O presidente, um vereador ou um chefe de divisão escreve uma pergunta
-- ("Quantos processos de obras estão atrasados?") e o Claude responde só com
-- consultas fixas do servidor (src/modules/perguntas-chefia). Fica aqui o
-- histórico de cada utilizador: a pergunta, a resposta estruturada que o
-- painel mostrou e as consultas que a calcularam ("como foi calculado").
CREATE TABLE perguntas_chefia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  utilizador_id  uuid NOT NULL REFERENCES utilizadores(id),
  pergunta       text NOT NULL,
  -- {resposta, numeros_chave, tabela, sugestoes, sem_dados}
  resposta       jsonb NOT NULL,
  -- [{id, ferramenta, parametros, linhas_devolvidas, fonte, erro}]
  consultas      jsonb NOT NULL DEFAULT '[]',
  -- como acabou: concluido · sem_dados · limite · recusa · cortado · erro
  fim            text NOT NULL,
  tokens         integer,                            -- entrada + saída, todas as voltas
  ms             integer,                            -- tempo total do pedido
  criada_em      timestamptz NOT NULL DEFAULT now()
);

-- Histórico do utilizador, paginado por (criada_em DESC, id DESC).
CREATE INDEX perguntas_chefia_historico_idx
  ON perguntas_chefia (municipio_id, utilizador_id, criada_em DESC, id DESC);
