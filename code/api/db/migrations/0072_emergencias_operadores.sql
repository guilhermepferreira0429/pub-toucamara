-- Avisos de emergência: a fonte com os números de TODAS as pessoas na zona
-- (operadores móveis, via ANEPC / proteção civil municipal) e o cell
-- broadcast. Por omissão as duas são SIMULADAS: geram números falsos e uma
-- difusão de demonstração (code/api/src/modules/emergencias/operadores*.ts).
--
-- REGRA DE SEGURANÇA: os números simulados podem coincidir com números reais
-- de pessoas. Nunca saem para o Twilio, o ElevenLabs ou outro fornecedor, em
-- nenhum ambiente: cada mensagem e chamada com origem simulada fica marcada
-- (`simulado = true`), é gravada e aparece como "enviado (simulado)", mas o
-- envio (MensagensService.enviarAgora, ChamadasSaidaService.despachar) nunca
-- chama o fornecedor. Os CHECK abaixo garantem que uma linha simulada nunca
-- fica com a referência de um fornecedor.

-- 1. A marca no ponto de envio.
ALTER TABLE mensagens_saida ADD COLUMN simulado boolean NOT NULL DEFAULT false;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_simulado_sem_fornecedor
  CHECK (NOT simulado OR provider_id IS NULL OR provider_id = 'simulado');

ALTER TABLE chamadas_saida ADD COLUMN simulado boolean NOT NULL DEFAULT false;
ALTER TABLE chamadas_saida ADD CONSTRAINT chamadas_saida_simulado_sem_fornecedor
  CHECK (NOT simulado OR (provider_ref IS NULL AND provider_conversa_ref IS NULL));

-- 2. Os destinatários da emergência: de onde veio e se é simulado.
ALTER TABLE emergencia_destinatarios
  ADD COLUMN simulado          boolean NOT NULL DEFAULT false,
  ADD COLUMN zona_aproximada   text CHECK (length(zona_aproximada) <= 200),
  -- A chamada do agente a um número simulado: só registada, nunca feita.
  ADD COLUMN chamada_simulada  boolean NOT NULL DEFAULT false;
-- Um número simulado nunca fica ligado a um munícipe nem a uma campanha.
ALTER TABLE emergencia_destinatarios ADD CONSTRAINT emergencia_destinatarios_simulado_isolado
  CHECK (NOT simulado OR (municipe_id IS NULL AND campanha_destinatario_id IS NULL));

-- A fonte 'externa' passou a chamar-se 'operadores'.
UPDATE emergencias SET fontes = array_replace(fontes, 'externa', 'operadores')
WHERE 'externa' = ANY (fontes);

-- 3. Cell broadcast: área + texto + estado da difusão (não há números).
ALTER TABLE emergencias ADD COLUMN cell_broadcast boolean NOT NULL DEFAULT false;

CREATE TABLE emergencia_difusoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  emergencia_id       uuid NOT NULL UNIQUE REFERENCES emergencias(id),
  modo                text NOT NULL CHECK (modo IN ('simulada','cell_broadcast')),
  simulado            boolean NOT NULL,
  estado              text NOT NULL DEFAULT 'por_pedir'
                        CHECK (estado IN ('por_pedir','pedida','em_difusao','concluida','recusada','erro','cancelada')),
  area                jsonb NOT NULL,                    -- a geometria da emergência
  zona_descricao      text NOT NULL,
  texto               text NOT NULL,
  pessoas_estimadas   integer CHECK (pessoas_estimadas >= 0),
  referencia_externa  text,                              -- CB-DEMO-... na simulação
  pedida_em           timestamptz,
  iniciada_em         timestamptz,
  concluida_em        timestamptz,
  erro                text,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT simulado OR modo = 'simulada')
);
CREATE INDEX emergencia_difusoes_municipio_idx ON emergencia_difusoes (municipio_id, criada_em DESC);
