-- Conhecimento (secções 4.3, 6.2 e 6.3): ingestão das fontes, pesquisa
-- híbrida, alterações e contradições.
--
-- Versão atual de uma fonte = a lida mais recentemente entre as que estão em
-- vigor hoje (vigor_desde/vigor_ate são a vigência legal; não se fecham ao
-- ler uma versão nova). Se uma fonte voltar a um texto que já teve, a versão
-- antiga volta a ser a atual (lida_em = now()), porque (fonte_id, hash) é único.

-- Fontes que bloqueiam leitura automática (ou só existem em papel/PDF):
-- o texto é colado pelo painel e a leitura noturna salta-as.
ALTER TABLE fontes ADD COLUMN leitura_automatica boolean NOT NULL DEFAULT true;
-- sha256 do ficheiro descarregado. Nos PDF (não há leitor) diz se o ficheiro
-- mudou desde que alguém colou o texto, sem ter de o ler.
ALTER TABLE fontes ADD COLUMN hash_original text;

CREATE INDEX fontes_leitura_idx ON fontes (municipio_id, ultima_leitura_em);
CREATE INDEX fonte_versoes_atual_idx ON fonte_versoes (fonte_id, lida_em DESC);
CREATE INDEX trechos_versao_idx ON trechos (fonte_versao_id, ordem);
-- Reindexar: só os que faltam.
CREATE INDEX trechos_sem_vetor_idx ON trechos (id) WHERE embedding IS NULL;
CREATE INDEX resposta_frases_resposta_idx ON resposta_frases (resposta_id);
-- Respostas afetadas por uma versão nova de uma fonte.
CREATE INDEX resposta_fontes_trecho_idx ON resposta_fontes (trecho_id);
CREATE INDEX respostas_municipio_idx ON respostas (municipio_id, estado);
CREATE INDEX psr_painel_idx ON perguntas_sem_resposta (municipio_id, vezes DESC, id DESC);
CREATE INDEX alteracoes_fonte_idx ON alteracoes (fonte_id, detetada_em DESC);
CREATE INDEX contradicoes_painel_idx ON contradicoes (municipio_id, detetada_em DESC);
-- "Usos" de uma resposta curada: momentos 'resposta_com_fonte' que a citam.
CREATE INDEX conversa_momentos_respostas_idx ON conversa_momentos
  USING gin ((dados -> 'respostas')) WHERE tipo = 'resposta_com_fonte';

-- O que correu mal em cada fonte numa leitura: [{fonte_id, titulo, erro}].
ALTER TABLE ingestoes ADD COLUMN detalhes jsonb NOT NULL DEFAULT '[]';
CREATE INDEX ingestoes_municipio_idx ON ingestoes (municipio_id, iniciada_em DESC);

-- O mesmo par de trechos só gera uma contradição.
CREATE UNIQUE INDEX contradicoes_par_uq ON contradicoes
  (least(trecho_a_id, trecho_b_id), greatest(trecho_a_id, trecho_b_id));

-- Pares já vistos pela IA (com ou sem contradição): não se voltam a pagar.
CREATE TABLE contradicoes_verificadas (
  trecho_a_id    uuid NOT NULL REFERENCES trechos(id) ON DELETE CASCADE,
  trecho_b_id    uuid NOT NULL REFERENCES trechos(id) ON DELETE CASCADE,
  verificada_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trecho_a_id, trecho_b_id),
  CHECK (trecho_a_id < trecho_b_id)
);
