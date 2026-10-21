-- "Liga de volta e junta o filho à chamada" (funcionalidades que nos põem à
-- frente, n.º 4): a pessoa pede "fale com o meu filho" e o agente junta-o.
-- Com Twilio: o munícipe passa para uma conferência, o agente volta a entrar
-- (liga para a própria linha) e o familiar é chamado. Sem Twilio, ou fora do
-- telefone: SMS ao familiar para ligar para a linha.
CREATE TABLE juncoes_familiar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  conversa_id        uuid REFERENCES conversas(id),
  municipe_id        uuid REFERENCES municipes(id),
  telefone_familiar  text NOT NULL,
  nome_familiar      text,
  relacao            text,
  resumo             text NOT NULL,                     -- o que o agente explica aos dois
  call_sid_municipe  text,
  sala               text UNIQUE NOT NULL,              -- FriendlyName da conferência
  modo               text NOT NULL CHECK (modo IN ('conferencia','sms')),
  estado             text NOT NULL DEFAULT 'pedida' CHECK (estado IN (
                       'pedida','a_juntar','agente_ligado','familiar_atendeu',
                       'familiar_nao_atendeu','terminada','falhou','sms_enviado')),
  erro               text,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  atualizada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX juncoes_familiar_conversa_idx ON juncoes_familiar (conversa_id);
CREATE INDEX juncoes_familiar_espera_idx ON juncoes_familiar (municipio_id, criada_em DESC)
  WHERE estado = 'a_juntar';

ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao','aviso','familiar'));
