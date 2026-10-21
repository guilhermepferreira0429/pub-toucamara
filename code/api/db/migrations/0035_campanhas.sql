-- Campanhas de contacto (ação social): em ondas de calor, frio ou cortes de
-- água, o agente liga a todas as pessoas inscritas e pergunta se estão bem.
-- Quem precisa de ajuda ou não atende aparece logo no painel.
--
-- Só se liga a quem se inscreveu e deu autorização (RGPD): a lista é
-- `contactos_cuidado`, com a data e a origem do consentimento.

ALTER TABLE chamadas_saida DROP CONSTRAINT chamadas_saida_motivo_check;
ALTER TABLE chamadas_saida ADD CONSTRAINT chamadas_saida_motivo_check
  CHECK (motivo IN ('processo_fase','pedido_documento','lembrete_prazo','manual','campanha'));

CREATE TABLE contactos_cuidado (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id          uuid NOT NULL REFERENCES municipios(id),
  municipe_id           uuid NOT NULL REFERENCES municipes(id),
  nome                  text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  morada                text,
  freguesia             text,
  notas                 text,                          -- "vive sozinha", "usa cadeira de rodas"
  consentimento_em      timestamptz NOT NULL,
  consentimento_origem  text NOT NULL CHECK (consentimento_origem IN ('balcao','telefone','formulario','acao_social')),
  ativo                 boolean NOT NULL DEFAULT true,
  criado_por            uuid REFERENCES utilizadores(id),
  criado_em             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, municipe_id)
);
CREATE INDEX contactos_cuidado_lista_idx ON contactos_cuidado (municipio_id, nome) WHERE ativo;

CREATE TABLE campanhas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  tipo             text NOT NULL CHECK (tipo IN ('onda_calor','frio','corte_agua','outro')),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 120),
  mensagem         text NOT NULL,                      -- o que o agente diz primeiro
  perguntas        jsonb NOT NULL DEFAULT '[]',         -- ["Está tudo bem?", ...]
  sms_recurso      text NOT NULL,                      -- vai a quem não atender
  freguesias       text[],                             -- NULL = todas
  ignorar_horario  boolean NOT NULL DEFAULT false,
  estado           text NOT NULL DEFAULT 'a_ligar' CHECK (estado IN ('a_ligar','terminada','cancelada')),
  criada_por       uuid REFERENCES utilizadores(id),
  criada_em        timestamptz NOT NULL DEFAULT now(),
  terminada_em     timestamptz
);
CREATE INDEX campanhas_lista_idx ON campanhas (municipio_id, criada_em DESC, id DESC);

CREATE TABLE campanha_destinatarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id       uuid NOT NULL REFERENCES campanhas(id),
  contacto_id       uuid NOT NULL REFERENCES contactos_cuidado(id),
  municipe_id       uuid NOT NULL REFERENCES municipes(id),
  estado            text NOT NULL DEFAULT 'por_ligar'
                      CHECK (estado IN ('por_ligar','a_ligar','bem','precisa_ajuda','atendeu',
                                        'nao_atendeu','sem_ligacao','recusou','cancelado')),
  necessidades      text[] NOT NULL DEFAULT '{}',      -- agua, transporte, medicamentos, companhia, saude, outro
  nota              text,                              -- o que a pessoa disse
  chamada_saida_id  uuid REFERENCES chamadas_saida(id),
  respondido_em     timestamptz,
  tratado_em        timestamptz,                       -- a ação social já tratou
  tratado_por       uuid REFERENCES utilizadores(id),
  tratado_nota      text,
  UNIQUE (campanha_id, contacto_id)
);
CREATE INDEX campanha_destinatarios_chamada_idx ON campanha_destinatarios (chamada_saida_id);
CREATE INDEX campanha_destinatarios_estado_idx ON campanha_destinatarios (campanha_id, estado);
