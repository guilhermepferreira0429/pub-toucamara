-- Mais duas licenças simples decididas na chamada (publicidade e recinto
-- improvisado) e o "calendário de obrigações": avisar antes de uma licença
-- expirar e renovar pelo agente com os mesmos dados.

ALTER TABLE licenca_regras DROP CONSTRAINT licenca_regras_tipo_check;
ALTER TABLE licenca_regras ADD CONSTRAINT licenca_regras_tipo_check
  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente',
    'publicidade','recinto_improvisado'));

ALTER TABLE licencas DROP CONSTRAINT licencas_tipo_check;
ALTER TABLE licencas ADD CONSTRAINT licencas_tipo_check
  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente',
    'publicidade','recinto_improvisado'));

ALTER TABLE licenca_historico DROP CONSTRAINT licenca_historico_tipo_check;
ALTER TABLE licenca_historico ADD CONSTRAINT licenca_historico_tipo_check
  CHECK (tipo IN ('ruido','ocupacao_via','esplanada','distico_residente',
    'publicidade','recinto_improvisado'));

-- Até que dia vale (preenchida ao emitir; as já emitidas preenche-as o job
-- dos avisos, com as mesmas contas da página da licença).
ALTER TABLE licencas ADD COLUMN valida_ate date;
-- O pedido de renovação aponta para a licença que renova.
ALTER TABLE licencas ADD COLUMN renova_licenca_id uuid REFERENCES licencas(id);
CREATE INDEX licencas_valida_ate_idx ON licencas (municipio_id, valida_ate)
  WHERE estado = 'emitida';
CREATE INDEX licencas_renova_idx ON licencas (renova_licenca_id)
  WHERE renova_licenca_id IS NOT NULL;

-- Os avisos enviados: um por licença e por aviso (ex.: 30 e 7 dias antes).
CREATE TABLE licenca_avisos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  licenca_id    uuid NOT NULL REFERENCES licencas(id),
  dias          integer NOT NULL CHECK (dias BETWEEN 1 AND 365),
  valida_ate    date NOT NULL,
  canal         text NOT NULL CHECK (canal IN ('sms','chamada','sem_contacto')),
  mensagem_id   uuid REFERENCES mensagens_saida(id),
  chamada_id    uuid REFERENCES chamadas_saida(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licenca_id, dias)
);
CREATE INDEX licenca_avisos_municipio_idx ON licenca_avisos (municipio_id, criado_em DESC);

-- A chamada do agente a lembrar a renovação (a quem prefere telefone).
-- Lista completa dos motivos de chamadas-saida/regras.ts mais o novo.
ALTER TABLE chamadas_saida DROP CONSTRAINT chamadas_saida_motivo_check;
ALTER TABLE chamadas_saida ADD CONSTRAINT chamadas_saida_motivo_check
  CHECK (motivo IN ('processo_fase','pedido_documento','lembrete_prazo','manual',
    'campanha','renovacao_licenca'));
