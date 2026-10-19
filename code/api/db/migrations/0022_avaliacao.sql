-- Avaliador (docs/superpowers/specs/2026-10-19-avaliador-design.md).
-- As mesmas perguntas, o mesmo gabarito e o mesmo juiz para o nosso agente e
-- para sistemas de outros. Substitui as tabelas eval_* da 0001 (vazias).

ALTER TABLE resposta_versoes DROP CONSTRAINT IF EXISTS resposta_versoes_eval_execucao_id_fkey;
DROP TABLE eval_resultados;
DROP TABLE eval_execucoes;
DROP TABLE eval_perguntas;

CREATE SCHEMA avaliacao;

CREATE TABLE avaliacao.conjuntos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,                        -- 'Perguntas base'
  versao        integer NOT NULL DEFAULT 1,
  municipio_id  uuid REFERENCES municipios(id),       -- NULL = genérico
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (nome, versao, municipio_id)
);

CREATE TABLE avaliacao.perguntas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conjunto_id        uuid NOT NULL REFERENCES avaliacao.conjuntos(id) ON DELETE CASCADE,
  ordem              integer NOT NULL,
  categoria          text NOT NULL,
  texto              text NOT NULL,
  idioma             text NOT NULL DEFAULT 'pt-PT',
  comportamento      text NOT NULL CHECK (comportamento IN ('responder','encaminhar','ocorrencia',
                       'perguntar','passar_humano','emergencia','fora_ambito','outra_lingua')),
  entidade_esperada  text,
  nota               text,
  UNIQUE (conjunto_id, ordem)
);

CREATE TABLE avaliacao.gabarito (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta_id          uuid NOT NULL REFERENCES avaliacao.perguntas(id) ON DELETE CASCADE,
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  versao               integer NOT NULL DEFAULT 1,
  resposta             text NOT NULL,
  factos_obrigatorios  text[] NOT NULL DEFAULT '{}',
  factos_proibidos     text[] NOT NULL DEFAULT '{}',
  fontes               jsonb NOT NULL DEFAULT '[]',   -- [{titulo, url}]
  estado               text NOT NULL DEFAULT 'proposto' CHECK (estado IN ('proposto','aprovado','rejeitado')),
  proposto_por         text NOT NULL DEFAULT 'ia',     -- 'ia' ou nome de quem escreveu
  aprovado_por         text,
  aprovado_em          timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pergunta_id, municipio_id, versao)
);
-- No máximo um aprovado por pergunta e município (o mais recente substitui).
CREATE UNIQUE INDEX gabarito_aprovado_uq ON avaliacao.gabarito (pergunta_id, municipio_id)
  WHERE estado = 'aprovado';

CREATE TABLE avaliacao.sistemas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text UNIQUE NOT NULL,                 -- 'Assistente do site · Guimarães'
  municipio_id  uuid REFERENCES municipios(id),
  adaptador     text NOT NULL CHECK (adaptador IN ('tou-chat','tou-voz','externo','manual')),
  url           text,
  config        jsonb NOT NULL DEFAULT '{}',          -- seletores, agent_id, slug...
  nosso         boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE avaliacao.execucoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema_id     uuid NOT NULL REFERENCES avaliacao.sistemas(id),
  conjunto_id    uuid NOT NULL REFERENCES avaliacao.conjuntos(id),
  agente_versao  text,                                -- só no nosso (agente_config.versao)
  motivo         text NOT NULL DEFAULT 'manual' CHECK (motivo IN ('manual','publicacao','pitch','auditoria')),
  amostra        boolean NOT NULL DEFAULT false,
  estado         text NOT NULL DEFAULT 'a_correr' CHECK (estado IN ('a_correr','terminada','interrompida')),
  erro           text,
  iniciada_em    timestamptz NOT NULL DEFAULT now(),
  terminada_em   timestamptz
);
CREATE INDEX execucoes_sistema_idx ON avaliacao.execucoes (sistema_id, iniciada_em DESC);

CREATE TABLE avaliacao.respostas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id   uuid NOT NULL REFERENCES avaliacao.execucoes(id) ON DELETE CASCADE,
  pergunta_id   uuid NOT NULL REFERENCES avaliacao.perguntas(id),
  texto         text,
  latencia_ms   integer,
  captura_key   text,                                 -- caminho relativo a PASTA_SAIDA
  ferramentas   text[] NOT NULL DEFAULT '{}',
  fontes        jsonb NOT NULL DEFAULT '[]',
  bruto         jsonb,
  erro          text,                                 -- erro_adaptador: a pergunta pode ser repetida
  respondida_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execucao_id, pergunta_id)
);

CREATE TABLE avaliacao.avaliacoes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resposta_id             uuid NOT NULL REFERENCES avaliacao.respostas(id) ON DELETE CASCADE,
  rubrica_versao          text NOT NULL,
  gabarito_id             uuid REFERENCES avaliacao.gabarito(id),
  veredicto               text NOT NULL CHECK (veredicto IN ('certa','passada_bem','errada','sem_resposta')),
  comportamento_observado text,
  factos_certos           text[] NOT NULL DEFAULT '{}',
  factos_em_falta         text[] NOT NULL DEFAULT '{}',
  factos_errados          text[] NOT NULL DEFAULT '{}',
  justificacao            text,
  avaliador               text NOT NULL DEFAULT 'juiz', -- 'juiz' ou nome da pessoa
  tokens_entrada          integer,
  tokens_saida            integer,
  criada_em               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avaliacoes_resposta_idx ON avaliacao.avaliacoes (resposta_id, criada_em DESC);

-- A avaliação que conta por resposta: a humana ganha à do juiz; depois a mais recente.
CREATE VIEW avaliacao.avaliacao_final AS
SELECT DISTINCT ON (a.resposta_id) a.*
FROM avaliacao.avaliacoes a
ORDER BY a.resposta_id, (a.avaliador <> 'juiz') DESC, a.criada_em DESC;

-- Resultado por execução (e por categoria). Respostas com erro do adaptador
-- não contam no total até serem repetidas. Linha com categoria NULL = total da
-- execução. UNION ALL de subconsultas (sem GROUPING SETS nem CTE) para o
-- filtro por execucao_id descer até às tabelas.
CREATE VIEW avaliacao.resultados AS
SELECT execucao_id, sistema_id, sistema, nosso, municipio_id, conjunto_id, agente_versao,
       motivo, amostra, estado, iniciada_em, terminada_em, categoria,
       count(*) FILTER (WHERE erro IS NULL AND veredicto IS NOT NULL)::int AS total,
       count(*) FILTER (WHERE veredicto = 'certa')::int AS certas,
       count(*) FILTER (WHERE veredicto = 'passada_bem')::int AS passadas_bem,
       count(*) FILTER (WHERE veredicto = 'errada')::int AS erradas,
       count(*) FILTER (WHERE veredicto = 'sem_resposta')::int AS sem_resposta,
       count(*) FILTER (WHERE erro IS NOT NULL)::int AS por_responder,
       count(*) FILTER (WHERE erro IS NULL AND veredicto IS NULL)::int AS por_avaliar,
       round(100.0 * count(*) FILTER (WHERE veredicto IN ('certa','passada_bem'))
             / nullif(count(*) FILTER (WHERE erro IS NULL AND veredicto IS NOT NULL), 0), 2) AS taxa
FROM (
  SELECT e.id AS execucao_id, e.sistema_id, s.nome AS sistema, s.nosso, s.municipio_id, e.conjunto_id, e.agente_versao, e.motivo, e.amostra, e.estado, e.iniciada_em, e.terminada_em, p.categoria, r.erro, f.veredicto
    FROM avaliacao.execucoes e
    JOIN avaliacao.sistemas s ON s.id = e.sistema_id
    JOIN avaliacao.respostas r ON r.execucao_id = e.id
    JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
    LEFT JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
  UNION ALL
  SELECT e.id AS execucao_id, e.sistema_id, s.nome AS sistema, s.nosso, s.municipio_id, e.conjunto_id, e.agente_versao, e.motivo, e.amostra, e.estado, e.iniciada_em, e.terminada_em, NULL::text, r.erro, f.veredicto
    FROM avaliacao.execucoes e
    JOIN avaliacao.sistemas s ON s.id = e.sistema_id
    JOIN avaliacao.respostas r ON r.execucao_id = e.id
    JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
    LEFT JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
) x
GROUP BY execucao_id, sistema_id, sistema, nosso, municipio_id, conjunto_id, agente_versao,
         motivo, amostra, estado, iniciada_em, terminada_em, categoria;

ALTER TABLE resposta_versoes ADD CONSTRAINT resposta_versoes_eval_execucao_id_fkey
  FOREIGN KEY (eval_execucao_id) REFERENCES avaliacao.execucoes(id);
