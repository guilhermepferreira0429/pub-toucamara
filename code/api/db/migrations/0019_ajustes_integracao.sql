-- Ajustes da integração dos módulos (19 out.).

-- Motivos de mensagem que faltavam: resposta de um funcionário a uma
-- passagem e código de identificação no chat.
ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao'));
