-- Chamadas de saída: o agente de voz liga ao munícipe quando o processo
-- avança, quando falta um documento ou quando o prazo está a acabar. Se
-- ninguém atender (2 tentativas, 2 h de intervalo), vai o SMS que iria de
-- qualquer forma (o "recurso").

-- O que cada câmara deixa o agente fazer. Por omissão DESLIGADO: a câmara
-- ativa no painel, por motivo, e indica o número de saída do ElevenLabs
-- (agent_phone_number_id) e por onde sai ('twilio' ou 'sip_trunk').
ALTER TABLE agente_config
  ADD COLUMN chamadas_saida jsonb NOT NULL
    DEFAULT '{"ativo": false, "motivos": [], "numero_id": null, "via": "twilio"}';

-- Opt-out: a pessoa diz ao agente (ou ao balcão) que não quer ser ligada.
ALTER TABLE municipes ADD COLUMN aceita_chamadas boolean NOT NULL DEFAULT true;

CREATE TABLE chamadas_saida (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id          uuid NOT NULL REFERENCES municipios(id),
  municipe_id           uuid NOT NULL REFERENCES municipes(id),
  telefone_e164         text NOT NULL,
  motivo                text NOT NULL
                          CHECK (motivo IN ('processo_fase','pedido_documento','lembrete_prazo','manual')),
  processo_id           uuid REFERENCES processos(id),
  pedido_id             uuid REFERENCES processo_pedidos(id),
  contexto              jsonb NOT NULL DEFAULT '{}',  -- o que o agente tem de dizer (variáveis dinâmicas)
  recurso               jsonb,                        -- o SMS se não atender: {corpo, chave, motivo, relacionado}
  estado                text NOT NULL DEFAULT 'agendada'
                          CHECK (estado IN ('agendada','a_ligar','atendida','nao_atendida','falhou','cancelada')),
  tentativas            integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  agendada_para         timestamptz NOT NULL DEFAULT now(),
  forcar_horario        boolean NOT NULL DEFAULT false, -- só a equipa interna (demonstrações)
  iniciada_em           timestamptz,                  -- a última tentativa
  terminada_em          timestamptz,
  provider_ref          text,                         -- callSid (Twilio) ou sip_call_id
  provider_conversa_ref text UNIQUE,                  -- conversation_id do ElevenLabs
  conversa_id           uuid REFERENCES conversas(id),-- quando chega o webhook do fim da chamada
  recurso_sms_id        uuid REFERENCES mensagens_saida(id),
  erro                  text,
  chave                 text UNIQUE,                  -- a do aviso: o mesmo aviso não agenda duas chamadas
  criada_por            uuid REFERENCES utilizadores(id), -- NULL = automática
  criada_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chamadas_saida_agendadas_idx ON chamadas_saida (agendada_para) WHERE estado = 'agendada';
CREATE INDEX chamadas_saida_lista_idx ON chamadas_saida (municipio_id, criada_em DESC, id DESC);
CREATE INDEX chamadas_saida_municipe_idx ON chamadas_saida (municipe_id, iniciada_em);
CREATE INDEX chamadas_saida_processo_idx ON chamadas_saida (processo_id);
