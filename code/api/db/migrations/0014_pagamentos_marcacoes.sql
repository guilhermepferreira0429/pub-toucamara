-- Pagamentos (modo de teste) e marcações/recolhas: o que faltava à 0001.

-- Pagamentos: a conversa que o criou (idempotência do `criar_pagamento`:
-- a mesma conversa + o mesmo requerimento/processo dão o mesmo pagamento).
ALTER TABLE pagamentos ADD COLUMN conversa_id uuid REFERENCES conversas(id);
CREATE UNIQUE INDEX pagamentos_conversa_objeto_uidx
  ON pagamentos (conversa_id, (coalesce(requerimento_id, processo_id)))
  WHERE conversa_id IS NOT NULL AND estado = 'pendente';

-- O webhook encontra o pagamento pela referência MB ou pela do fornecedor.
-- Duas referências pendentes iguais na mesma entidade seriam ambíguas.
CREATE UNIQUE INDEX pagamentos_mb_pendente_uidx
  ON pagamentos (mb_entidade, mb_referencia)
  WHERE estado = 'pendente' AND mb_referencia IS NOT NULL;
CREATE INDEX pagamentos_mb_idx ON pagamentos (mb_referencia);
CREATE INDEX pagamentos_provider_ref_idx ON pagamentos (provider_ref);
CREATE INDEX pagamentos_lista_idx ON pagamentos (municipio_id, criado_em DESC, id DESC);

-- Marcações: quando foram feitas (painel) e índice para a agenda do dia e os lembretes.
ALTER TABLE marcacoes ADD COLUMN criada_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX marcacoes_agenda_idx ON marcacoes (agenda_id, lower(periodo));
CREATE INDEX marcacoes_municipe_idx ON marcacoes (municipe_id, lower(periodo));
CREATE INDEX marcacoes_lembrete_idx ON marcacoes (lower(periodo))
  WHERE estado = 'marcada' AND lembrete_enviado_em IS NULL;

-- Recolhas: o mesmo lembrete de véspera das marcações (coluna em vez de só a
-- chave do SMS, para o job filtrar sem ir a mensagens_saida) e quando foram feitas.
ALTER TABLE recolhas ADD COLUMN lembrete_enviado_em timestamptz;
ALTER TABLE recolhas ADD COLUMN criada_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX recolhas_janela_idx ON recolhas (entidade_id, lower(janela)) WHERE estado = 'marcada';
CREATE INDEX recolhas_lembrete_idx ON recolhas (lower(janela))
  WHERE estado = 'marcada' AND lembrete_enviado_em IS NULL;
