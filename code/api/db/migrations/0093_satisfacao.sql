-- Inquérito de satisfação no fim do atendimento (peça 7). Sem SMS extra: a
-- pergunta "Ficou resolvido?" está na página do resumo, aberta pelo link do
-- SMS do fim da chamada. Uma resposta por conversa; sem login (o código do
-- link chega).
--
-- O comentário é texto livre (pode ter dados pessoais): só aparece no painel
-- e a retenção (transcrições) apaga-o com as transcrições da conversa.

CREATE TABLE satisfacao_respostas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  conversa_id   uuid NOT NULL UNIQUE REFERENCES conversas(id) ON DELETE CASCADE,
  nota          smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario    text CHECK (char_length(comentario) <= 1000),
  respondida_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX satisfacao_respostas_municipio_em
  ON satisfacao_respostas (municipio_id, respondida_em DESC);
