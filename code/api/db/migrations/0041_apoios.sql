-- "Tem direito a isto e ainda não pediu" (funcionalidades que nos põem à
-- frente, "A câmara que liga primeiro", n.º 1): o agente faz 2 ou 3
-- perguntas, diz a que apoios a pessoa pode ter direito, manda por SMS a
-- lista com o que entregar e trata do pedido logo ali. No painel, a câmara
-- vê quem tinha direito e não pediu e liga-lhes (campanha).
--
-- Os critérios são estruturados (ver apoios/regras.ts). Não há rendimentos
-- na BD: o avaliador usa só o que a pessoa disse, e guarda-se o escalão do
-- rendimento por pessoa, nunca o valor.

CREATE TABLE apoios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  codigo          text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]{2,40}$'),  -- 'cheque_bebe'
  nome            text NOT NULL,
  resumo          text NOT NULL,                       -- o que é, numa frase
  valor           text,                                -- "até 150 € por mês"
  quem_pode       text NOT NULL,                       -- em linguagem simples
  criterios       jsonb NOT NULL,                      -- {idade_min, idade_max, agregado_min, rendimento_per_capita_max, filho_idade, inquilino, residente_concelho}
  documentos      jsonb NOT NULL DEFAULT '[]',         -- ["Contrato de arrendamento", ...]
  como_pedir      text NOT NULL,
  fonte           jsonb NOT NULL,                      -- {titulo, url, ambito: nacional|municipal}
  demonstracao    boolean NOT NULL DEFAULT false,
  ativo           boolean NOT NULL DEFAULT true,
  ordem           integer NOT NULL DEFAULT 0,
  atualizado_por  uuid REFERENCES utilizadores(id),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, codigo)
);

-- Uma consulta por conversa (as perguntas seguintes completam-na). O link
-- do SMS abre /apoios/{codigo}.
CREATE TABLE consultas_apoios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  conversa_id      uuid REFERENCES conversas(id),
  municipe_id      uuid REFERENCES municipes(id),
  canal            text NOT NULL CHECK (canal IN ('telefone','chat','ia')),
  perfil           jsonb NOT NULL,                     -- {idade, pessoas_agregado, rendimento_escalao, filhos_idades, inquilino, residente_concelho}
  resultados       jsonb NOT NULL,                     -- [{apoio_id, codigo, nome, resultado, porque[], falta[]}]
  tem_direito      text[] NOT NULL DEFAULT '{}',       -- códigos (para contar no painel)
  talvez           text[] NOT NULL DEFAULT '{}',
  aceita_contacto  boolean NOT NULL DEFAULT false,     -- autorizou a câmara a voltar a ligar sobre estes apoios
  codigo           text NOT NULL UNIQUE,
  criada_em        timestamptz NOT NULL DEFAULT now(),
  atualizada_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultas_apoios_lista_idx ON consultas_apoios (municipio_id, criada_em DESC);
CREATE UNIQUE INDEX consultas_apoios_conversa_idx ON consultas_apoios (conversa_id) WHERE conversa_id IS NOT NULL;
CREATE INDEX consultas_apoios_municipe_idx ON consultas_apoios (municipe_id);

-- O pedido é um processo (tipo 'APS'): entra na lista dos técnicos, com
-- número, linha do tempo e a página "O seu processo".
CREATE TABLE pedidos_apoio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  apoio_id      uuid NOT NULL REFERENCES apoios(id),
  municipe_id   uuid NOT NULL REFERENCES municipes(id),
  consulta_id   uuid REFERENCES consultas_apoios(id),
  processo_id   uuid NOT NULL UNIQUE REFERENCES processos(id),
  origem        text NOT NULL CHECK (origem IN ('agente','pagina','campanha')),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedidos_apoio_idx ON pedidos_apoio (municipio_id, apoio_id, municipe_id);

-- "Ligar a quem pode ter direito": a campanha (módulo campanhas) e o apoio.
CREATE TABLE apoio_campanhas (
  campanha_id  uuid PRIMARY KEY REFERENCES campanhas(id),
  apoio_id     uuid NOT NULL REFERENCES apoios(id),
  origem       text NOT NULL CHECK (origem IN ('consultas','contactos_cuidado'))
);

-- Nas campanhas dos apoios liga-se a munícipes que não estão na lista de
-- pessoas inscritas da ação social.
ALTER TABLE campanha_destinatarios ALTER COLUMN contacto_id DROP NOT NULL;

ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao','aviso','familiar','apoio'));
