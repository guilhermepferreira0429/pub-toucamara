-- SMS de entrada (V1 · "estado do processo por telefone, chat ou SMS"): a
-- pessoa manda o número do processo e recebe o estado; PARAR desliga os
-- avisos por zona. O número que recebe pode ser outro que não a linha de voz.
ALTER TABLE municipios ADD COLUMN telefone_sms text;

CREATE TABLE sms_recebidos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  de            text NOT NULL,                        -- E.164
  municipe_id   uuid REFERENCES municipes(id),
  corpo         text NOT NULL,
  intencao      text NOT NULL CHECK (intencao IN ('estado','parar','ajuda','ignorado')),
  resposta_id   uuid REFERENCES mensagens_saida(id),
  provider_id   text UNIQUE,                          -- MessageSid: o Twilio pode repetir o webhook
  recebido_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_recebidos_de_idx ON sms_recebidos (municipio_id, de, recebido_em DESC);

ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao','aviso','familiar','resposta_sms'));
