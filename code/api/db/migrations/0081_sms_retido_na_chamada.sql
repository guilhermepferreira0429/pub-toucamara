-- Um só SMS por chamada: as confirmações que são só confirmações (recolha de
-- monos, marcação) ficam retidas enquanto a chamada decorre, porque o SMS do
-- fim já as resume e a página do resumo as mostra. Se o SMS do fim sair, a
-- retida fica 'cancelada'; se não sair (a chamada caiu, emergência), sai ela.
-- E se nada disso correr, sai sozinha à hora de enviar_em (rede de segurança).
ALTER TYPE estado_msg ADD VALUE IF NOT EXISTS 'cancelada';

ALTER TABLE mensagens_saida
  ADD COLUMN retida_fim_chamada boolean NOT NULL DEFAULT false;
