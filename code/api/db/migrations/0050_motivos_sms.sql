-- Os motivos dos SMS foram acrescentados por várias migrações (0040 familiar,
-- 0041 apoio, 0048 resposta_sms), cada uma com a lista inteira. Como podem
-- correr por outra ordem numa base que já tinha umas e não outras, esta
-- repõe a lista completa. Ao acrescentar um motivo, criar a seguinte com a
-- lista inteira outra vez.
ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao','aviso','familiar','apoio','resposta_sms'));
