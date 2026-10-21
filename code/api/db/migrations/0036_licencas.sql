-- Licenças decididas na chamada: os pedidos simples (começa pela licença
-- especial de ruído para uma festa ou evento) são verificados por regras em
-- código durante a chamada. Dentro das regras: paga-se a taxa (modo de teste)
-- e um funcionário aprova com um clique; a licença chega por SMS com um QR
-- que qualquer pessoa pode verificar. Fora das regras: vai para um técnico,
-- já analisado.
--
-- A licença é um processo (tipo 'LER'): numeração, pagamento, eventos e a
-- ficha do processo vêm de graça.

CREATE TABLE licenca_regras (
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  tipo           text NOT NULL CHECK (tipo IN ('ruido')),
  config         jsonb NOT NULL,           -- ver licencas/regras.ts (horas, antecedência, taxa...)
  atualizado_por uuid REFERENCES utilizadores(id),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipio_id, tipo)
);

CREATE TABLE licencas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  processo_id         uuid NOT NULL UNIQUE REFERENCES processos(id),
  tipo                text NOT NULL CHECK (tipo IN ('ruido')),
  municipe_id         uuid REFERENCES municipes(id),
  conversa_id         uuid REFERENCES conversas(id),
  dados               jsonb NOT NULL,      -- {atividade, descricao, morada, data, hora_inicio, hora_fim, pessoas, musica_amplificada}
  avaliacao           jsonb NOT NULL,      -- {regras: [{id, ok, texto}], proposta, condicoes}
  config_usada        jsonb NOT NULL,      -- as regras em vigor no momento (para auditoria)
  proposta            text NOT NULL CHECK (proposta IN ('aprovar','tecnico')),
  estado              text NOT NULL DEFAULT 'a_pagar'
                        CHECK (estado IN ('a_pagar','por_aprovar','para_tecnico','emitida','recusada')),
  taxa_cent           integer NOT NULL CHECK (taxa_cent >= 0),
  codigo_verificacao  text NOT NULL UNIQUE,  -- o do QR: /licenca/{codigo}
  decidida_por        uuid REFERENCES utilizadores(id),
  decidida_em         timestamptz,
  motivo_recusa       text,
  criada_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licencas_lista_idx ON licencas (municipio_id, criada_em DESC, id DESC);
CREATE INDEX licencas_estado_idx ON licencas (municipio_id, estado);
