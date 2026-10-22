-- "Os humanos só tratam das exceções" e "Regras públicas e verificáveis".
--
-- 1) Cada licença guarda como foi decidida: 'automatica' (cumpre as regras e
--    a câmara deixou o tipo decidir sozinho), 'excecao' (falhou uma regra ou
--    falta um dado: vai a uma pessoa, com o motivo concreto em `excecao`) ou
--    'funcionario' (cumpre as regras, mas a câmara pediu que alguém confirme
--    todos os pedidos deste tipo). E a versão das regras em vigor nesse dia,
--    para a página "porque foi aprovada".
--
-- 2) O histórico das regras: cada vez que a câmara muda as regras de um tipo
--    de licença ou de uma zona do PDM fica uma versão nova (o que mudou,
--    quando e o cargo de quem mudou: o nome não é público). A página pública
--    das regras e o export JSON leem daqui.

ALTER TABLE licencas
  ADD COLUMN decisao text CHECK (decisao IN ('automatica','excecao','funcionario')),
  ADD COLUMN excecao jsonb,            -- [{tipo: 'regra'|'dado_em_falta', id, rotulo, texto}]
  ADD COLUMN regras_versao integer;    -- a versão de regras_versoes em vigor no pedido

-- As licenças que já existem: fora das regras = exceção (com as regras que
-- falharam); dentro, conforme a aprovação que estava nas regras usadas.
UPDATE licencas l SET
  decisao = CASE
    WHEN l.proposta = 'tecnico' THEN 'excecao'
    WHEN l.config_usada->>'aprovacao' = 'automatica' THEN 'automatica'
    ELSE 'funcionario' END,
  excecao = CASE WHEN l.proposta = 'tecnico' THEN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'tipo', 'regra', 'id', r->>'id', 'rotulo', r->>'id', 'texto', r->>'texto')), '[]'::jsonb)
    FROM jsonb_array_elements(l.avaliacao->'regras') r
    WHERE (r->>'ok')::boolean IS NOT TRUE) END
WHERE l.decisao IS NULL;

CREATE INDEX licencas_decisao_idx ON licencas (municipio_id, criada_em DESC, tipo, decisao);

CREATE TABLE regras_versoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  ambito         text NOT NULL CHECK (ambito IN ('licenca','zona')),
  chave          text NOT NULL,                 -- o tipo de licença ou o código da zona
  versao         integer NOT NULL CHECK (versao >= 1),
  config         jsonb NOT NULL,                -- as regras completas desta versão
  vigor_desde    timestamptz NOT NULL DEFAULT now(),
  alterado_por   uuid REFERENCES utilizadores(id),
  cargo          text,                          -- o cargo de quem mudou (público); null = valores iniciais
  alteracoes     jsonb NOT NULL DEFAULT '[]',   -- [{campo, rotulo, antes, depois}]
  nota           text,
  UNIQUE (municipio_id, ambito, chave, versao)
);
CREATE INDEX regras_versoes_vigor_idx
  ON regras_versoes (municipio_id, ambito, chave, vigor_desde DESC);

-- As regras que já estão gravadas passam a ser a versão 1.
INSERT INTO regras_versoes (municipio_id, ambito, chave, versao, config, vigor_desde, nota)
SELECT r.municipio_id, 'licenca', r.tipo, 1, r.config, r.atualizado_em, 'Regras em vigor quando o histórico começou.'
FROM licenca_regras r
ON CONFLICT DO NOTHING;

INSERT INTO regras_versoes (municipio_id, ambito, chave, versao, config, vigor_desde, nota)
SELECT z.municipio_id, 'zona', z.codigo, 1,
       jsonb_build_object('nome', z.nome, 'descricao', z.descricao, 'regras', z.regras,
                          'fonte', z.fonte, 'demonstracao', z.demonstracao),
       z.criada_em, 'Regras em vigor quando o histórico começou.'
FROM zonas_pdm z
ON CONFLICT DO NOTHING;

UPDATE licencas l SET regras_versao = 1
WHERE l.regras_versao IS NULL
  AND EXISTS (SELECT 1 FROM regras_versoes v
              WHERE v.municipio_id = l.municipio_id AND v.ambito = 'licenca' AND v.chave = l.tipo
                AND v.vigor_desde <= l.criada_em);
