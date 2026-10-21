-- Avisos de emergência em massa (V3 n.º 2 de "Câmara Atende — Funcionalidades":
-- "chamadas e SMS em massa para avisar a população de incêndios, cheias ou
-- cortes de água").
--
-- Os números vêm de FONTES (munícipes conhecidos com morada na zona, contactos
-- de cuidado da ação social, uma lista carregada à mão) e cada destinatário
-- guarda de que fontes veio. A lista NÃO é toda a gente da zona: ter os
-- números de toda a gente há de vir de uma fonte externa (operadores, cell
-- broadcast, Proteção Civil), por implementar.
--
-- O SMS vai a todos (ignora o opt-out dos avisos e o horário). As chamadas do
-- agente são uma campanha do módulo campanhas (motivo 'campanha', sem janela
-- de horário), ligada aqui por `campanha_id`.

-- Por município: para onde vão os alertas de "precisa de ajuda" e o ritmo de
-- envio (para não passar os limites do Twilio). Sem linha = valores por omissão.
CREATE TABLE emergencias_config (
  municipio_id          uuid PRIMARY KEY REFERENCES municipios(id),
  protecao_civil_nome   text CHECK (length(protecao_civil_nome) <= 120),
  protecao_civil_email  text CHECK (protecao_civil_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  sms_por_minuto        integer NOT NULL DEFAULT 60 CHECK (sms_por_minuto BETWEEN 1 AND 6000),
  chamadas_por_minuto   integer NOT NULL DEFAULT 10 CHECK (chamadas_por_minuto BETWEEN 1 AND 600),
  atualizado_por        uuid REFERENCES utilizadores(id),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emergencias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  tipo               text NOT NULL CHECK (tipo IN ('cheia','incendio','corte_agua','calor_extremo','outro')),
  gravidade          text NOT NULL CHECK (gravidade IN ('aviso','alerta','emergencia')),
  titulo             text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 120),
  mensagem_sms       text NOT NULL,                     -- curta: vai por SMS
  guiao              jsonb NOT NULL,                    -- {dizer, perguntas[]}: a chamada do agente
  instrucoes         text NOT NULL,                     -- para onde ir, o que fazer
  numero_emergencia  text NOT NULL DEFAULT '112',
  zona               jsonb NOT NULL,                    -- o pedido (poligono, ponto, freguesias)
  geometria          jsonb NOT NULL,                    -- a zona pronta a testar
  zona_descricao     text NOT NULL,
  valida_ate         timestamptz NOT NULL,
  chamadas           text NOT NULL CHECK (chamadas IN ('nenhuma','vulneraveis','todos')),
  fontes             text[] NOT NULL,                   -- as fontes escolhidas
  lista_manual       jsonb NOT NULL DEFAULT '[]',       -- [{telefone, nome}] (simulação)
  estado             text NOT NULL DEFAULT 'rascunho'
                       CHECK (estado IN ('rascunho','ativa','encerrada','cancelada')),
  destinatarios_previstos integer NOT NULL DEFAULT 0,
  campanha_id        uuid REFERENCES campanhas(id),
  criada_por         uuid REFERENCES utilizadores(id),
  criada_em          timestamptz NOT NULL DEFAULT now(),
  enviada_por        uuid REFERENCES utilizadores(id),
  enviada_em         timestamptz,
  encerrada_por      uuid REFERENCES utilizadores(id),
  encerrada_em       timestamptz,
  encerrada_nota     text
);
CREATE INDEX emergencias_lista_idx ON emergencias (municipio_id, criada_em DESC, id DESC);
CREATE INDEX emergencias_ativas_idx ON emergencias (valida_ate) WHERE estado = 'ativa';

CREATE TABLE emergencia_destinatarios (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergencia_id             uuid NOT NULL REFERENCES emergencias(id),
  telefone_e164             text NOT NULL,
  municipe_id               uuid REFERENCES municipes(id),
  nome                      text,
  fontes                    text[] NOT NULL,           -- de onde veio o número
  vulneravel                boolean NOT NULL DEFAULT false,
  sms_id                    uuid REFERENCES mensagens_saida(id),
  sms_em                    timestamptz,               -- quando sai (ritmo)
  campanha_destinatario_id  uuid REFERENCES campanha_destinatarios(id),
  chamada_em                timestamptz,
  -- O que a pessoa respondeu ao agente (resposta_emergencia ou resposta_campanha).
  resposta                  text CHECK (resposta IN ('em_seguranca','precisa_ajuda')),
  ajuda                     text[] NOT NULL DEFAULT '{}',
  nota                      text,
  respondido_em             timestamptz,
  alertado_em               timestamptz,               -- email às chefias e à proteção civil
  tratado_em                timestamptz,
  tratado_por               uuid REFERENCES utilizadores(id),
  tratado_nota              text,
  UNIQUE (emergencia_id, telefone_e164)
);
CREATE INDEX emergencia_destinatarios_campanha_idx ON emergencia_destinatarios (campanha_destinatario_id);
CREATE INDEX emergencia_destinatarios_municipe_idx ON emergencia_destinatarios (municipe_id);
