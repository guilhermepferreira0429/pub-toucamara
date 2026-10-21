-- WhatsApp (visão base, FUN): a pessoa escreve para o número da câmara no
-- WhatsApp e fala com o mesmo agente do chat. As respostas só podem ser
-- livres dentro das 24 h depois da última mensagem da pessoa (regra da Meta);
-- os avisos que a câmara inicia continuam por SMS.
ALTER TABLE municipios ADD COLUMN telefone_whatsapp text;

ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_canal_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_canal_check
  CHECK (canal IN ('sms','email','whatsapp'));

-- As ferramentas gravam o canal da conversa.
ALTER TABLE consulta_participacoes DROP CONSTRAINT consulta_participacoes_canal_check;
ALTER TABLE consulta_participacoes ADD CONSTRAINT consulta_participacoes_canal_check
  CHECK (canal IN ('telefone','chat','ia','pagina','sms','whatsapp'));
ALTER TABLE consultas_apoios DROP CONSTRAINT consultas_apoios_canal_check;
ALTER TABLE consultas_apoios ADD CONSTRAINT consultas_apoios_canal_check
  CHECK (canal IN ('telefone','chat','ia','sms','whatsapp'));

-- Mensagens recebidas: o webhook grava e responde já; um job responde
-- (juntando as mensagens seguidas da mesma pessoa num só turno).
CREATE TABLE whatsapp_recebidas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  conversa_id   uuid NOT NULL REFERENCES conversas(id),
  de            text NOT NULL,                        -- E.164
  texto         text NOT NULL,
  provider_id   text UNIQUE,                          -- MessageSid
  estado        text NOT NULL DEFAULT 'pendente'
                  CHECK (estado IN ('pendente','respondida','ignorada')),
  recebida_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_pendentes_idx ON whatsapp_recebidas (conversa_id, recebida_em)
  WHERE estado = 'pendente';
CREATE INDEX whatsapp_de_idx ON whatsapp_recebidas (municipio_id, de, recebida_em DESC);
