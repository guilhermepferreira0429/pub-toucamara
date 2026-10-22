-- Estado dos SMS pelo StatusCallback do Twilio: procura pelo MessageSid.
CREATE INDEX mensagens_saida_provider_idx ON mensagens_saida (provider_id)
  WHERE provider_id IS NOT NULL;
