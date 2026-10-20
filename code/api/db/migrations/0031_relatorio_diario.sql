-- Resumo diário para o presidente (relatório 'diario').
--
-- Todos os dias às 07:30 (fuso do município), as últimas 24 horas: números,
-- o que mais pediram, o que mais reclamaram, o que pede atenção hoje e
-- algumas frases anónimas de munícipes. Um por (município, 'diario', dia):
-- `periodo` é o dia do envio ('[dia,dia]'); a janela exata (das 07:30 de
-- ontem às 07:30 de hoje) fica em `dados.janela`.

ALTER TABLE relatorios DROP CONSTRAINT relatorios_tipo_check;
ALTER TABLE relatorios ADD CONSTRAINT relatorios_tipo_check
  CHECK (tipo IN ('semanal','mensal','executivo','diario'));

-- Quem recebe o resumo diário, por município. Lista própria e não os
-- perfis: é para o presidente (que pode nem ter conta no painel) e para quem
-- ele escolher, não para todas as chefias. Por omissão DESLIGADO: o job só
-- gera e envia com `ativo` e pelo menos um destinatário.
--   {"ativo": true, "destinatarios": [{"email": "presidente@cm-x.pt", "nome": "Presidente"}]}
ALTER TABLE municipios
  ADD COLUMN resumo_diario jsonb NOT NULL DEFAULT '{"ativo": false, "destinatarios": []}'
    CHECK (jsonb_typeof(resumo_diario -> 'ativo') = 'boolean'
       AND jsonb_typeof(resumo_diario -> 'destinatarios') = 'array');
