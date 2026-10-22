-- Contratação pública (V3 · FUN n.º 8): ajuda a preparar procedimentos e a
-- confirmar se cabem no ajuste direto. Só painel (interno).
--
--   * municipios.contratacao_config: os limiares e as regras do motor. Sem
--     config o código usa valores de demonstração (o ajuste direto de
--     serviços até 75 000 € vem do PRD do projeto; o resto é demonstração),
--     sempre marcados como tal e a confirmar pelo jurista.
--   * contratos_publicos: o registo dos contratos do município (importado do
--     portal BASE em CSV, criado à mão ou vindo de um procedimento
--     publicado), para o limite acumulado com a mesma entidade e os alertas
--     de fracionamento.
--   * contratacao_procedimentos: o pedido do serviço requerente, a avaliação
--     do motor e o estado (rascunho → em revisão → aprovado → publicado).
--   * contratacao_pecas: os rascunhos do convite e do caderno de encargos.

ALTER TABLE municipios ADD COLUMN IF NOT EXISTS contratacao_config jsonb;

CREATE TABLE contratos_publicos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  adjudicante             text,
  adjudicatario_nif       text NOT NULL CHECK (adjudicatario_nif ~ '^\d{9}$'),
  adjudicatario_nome      text,
  objeto                  text NOT NULL,
  cpv                     text,
  tipo                    text NOT NULL CHECK (tipo IN ('bens','servicos','empreitada')),
  preco_contratual_cent   bigint NOT NULL CHECK (preco_contratual_cent >= 0),
  data_contrato           date NOT NULL,
  procedimento            text NOT NULL CHECK (procedimento IN
                            ('ajuste_direto_simplificado','ajuste_direto','consulta_previa','concurso_publico','outro')),
  procedimento_original   text,                    -- como vinha no BASE
  origem                  text NOT NULL CHECK (origem IN ('csv','manual','procedimento')),
  importacao_id           uuid,                    -- as linhas do mesmo CSV
  procedimento_id         uuid,                    -- contratacao_procedimentos (origem 'procedimento')
  base_numero             text,
  criado_por              uuid REFERENCES utilizadores(id),
  criado_em               timestamptz NOT NULL DEFAULT now()
);
-- O mesmo contrato importado duas vezes não se soma duas vezes.
CREATE UNIQUE INDEX contratos_publicos_unico_idx
  ON contratos_publicos (municipio_id, adjudicatario_nif, data_contrato, preco_contratual_cent, md5(objeto));
CREATE INDEX contratos_publicos_nif_idx ON contratos_publicos (municipio_id, adjudicatario_nif, data_contrato);
CREATE INDEX contratos_publicos_data_idx ON contratos_publicos (municipio_id, data_contrato DESC, id DESC);

CREATE TABLE contratacao_procedimentos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id           uuid NOT NULL REFERENCES municipios(id),
  numero                 text NOT NULL,                  -- 'PCP 3/2026'
  servico_requerente     text NOT NULL,
  servico_id             uuid REFERENCES servicos(id),
  pedido_por             uuid REFERENCES utilizadores(id),
  tipo                   text NOT NULL CHECK (tipo IN ('bens','servicos','empreitada')),
  objeto                 text NOT NULL,
  cpv                    text,
  fundamentacao          text,
  valor_estimado_cent    bigint NOT NULL CHECK (valor_estimado_cent >= 0),
  prazo_meses            integer NOT NULL CHECK (prazo_meses > 0),
  entidade_nif           text CHECK (entidade_nif ~ '^\d{9}$'),
  entidade_nome          text,
  procedimento           text NOT NULL CHECK (procedimento IN
                           ('ajuste_direto_simplificado','ajuste_direto','consulta_previa','concurso_publico')),
  avaliacao              jsonb NOT NULL,                 -- o resultado do motor no dia
  config_usada           jsonb NOT NULL,
  estado                 text NOT NULL DEFAULT 'rascunho'
                         CHECK (estado IN ('rascunho','em_revisao','aprovado','publicado')),
  nota                   text,                           -- a última nota de revisão
  aprovado_por           uuid REFERENCES utilizadores(id),
  aprovado_em            timestamptz,
  base_numero            text,                           -- n.º no portal BASE (registo manual)
  publicado_por          uuid REFERENCES utilizadores(id),
  publicado_em           timestamptz,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX contratacao_procedimentos_lista_idx
  ON contratacao_procedimentos (municipio_id, criado_em DESC, id DESC);

CREATE TABLE contratacao_pecas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  procedimento_id     uuid NOT NULL REFERENCES contratacao_procedimentos(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('convite','caderno_encargos')),
  titulo              text NOT NULL,
  secoes              jsonb NOT NULL,                    -- [{titulo, texto}]
  campos_a_preencher  jsonb NOT NULL DEFAULT '[]',
  modo                text NOT NULL CHECK (modo IN ('ia','modelo','editada')),
  atualizada_por      uuid REFERENCES utilizadores(id),
  criada_em           timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procedimento_id, tipo)
);
