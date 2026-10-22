-- "A câmara liga-lhe antes de o problema existir" (antecipações).
--
-- antecipacao_config: a antecedência (em dias úteis), se está ativo e o
-- canal de cada tipo de momento, por município. Sem linha = os valores por
-- omissão (de demonstração) de antecipacoes/regras.ts.
--
-- antecipacoes: cada contacto feito (ou decidido não fazer) por um momento.
-- A `chave` (tipo:objeto:data_alvo, mais ':chefia' no alerta interno) é
-- única: um momento só gera um contacto por data alvo, mesmo que o job
-- corra duas vezes. O resultado lê-se da chamada (chamadas_saida) ou da
-- mensagem (mensagens_saida) ligadas.

CREATE TABLE antecipacao_config (
  municipio_id             uuid NOT NULL REFERENCES municipios(id) ON DELETE CASCADE,
  tipo                     text NOT NULL CHECK (tipo IN ('prazo_municipe','audiencia_previa',
                             'prazo_camara','caducidade_alvara','pagamento_a_vencer')),
  ativo                    boolean NOT NULL DEFAULT true,
  antecedencia_dias_uteis  integer NOT NULL CHECK (antecedencia_dias_uteis BETWEEN 0 AND 60),
  canal                    text NOT NULL DEFAULT 'auto' CHECK (canal IN ('auto','chamada','notificacao')),
  atualizado_por           uuid REFERENCES utilizadores(id) ON DELETE SET NULL,
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipio_id, tipo)
);

CREATE TABLE antecipacoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id) ON DELETE CASCADE,
  chave               text NOT NULL UNIQUE,
  tipo                text NOT NULL CHECK (tipo IN ('prazo_municipe','audiencia_previa',
                        'prazo_camara','caducidade_alvara','pagamento_a_vencer','licenca_expira')),
  destinatario        text NOT NULL DEFAULT 'municipe' CHECK (destinatario IN ('municipe','chefia')),
  gravidade           text NOT NULL CHECK (gravidade IN ('alta','media','baixa')),
  data_alvo           date NOT NULL,
  antecedencia_dias_uteis integer NOT NULL,
  processo_id         uuid REFERENCES processos(id),
  municipe_id         uuid REFERENCES municipes(id),
  pedido_id           uuid REFERENCES processo_pedidos(id),
  pagamento_id        uuid REFERENCES pagamentos(id),
  -- O que se queria (chamada do agente ou push/SMS) e o que aconteceu.
  canal_previsto      text NOT NULL CHECK (canal_previsto IN ('chamada','notificacao','interno')),
  canal               text NOT NULL CHECK (canal IN ('chamada','push','sms','interno',
                        'ja_avisado','sem_contacto')),
  motivo_sem_chamada  text,
  chamada_id          uuid REFERENCES chamadas_saida(id),
  mensagem_id         uuid REFERENCES mensagens_saida(id),
  titulo              text NOT NULL,
  texto               text NOT NULL,             -- o SMS/push (ou o alerta interno)
  dizer               text,                      -- o que o agente diz
  dados               jsonb NOT NULL DEFAULT '{}',
  demonstracao        boolean NOT NULL DEFAULT true,  -- regras/antecedência por omissão
  explicado_em        timestamptz,               -- o agente explicou-o (explicar_momento)
  criado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX antecipacoes_municipio_idx ON antecipacoes (municipio_id, criado_em DESC);
CREATE INDEX antecipacoes_processo_idx ON antecipacoes (processo_id) WHERE processo_id IS NOT NULL;
CREATE INDEX antecipacoes_municipe_idx ON antecipacoes (municipe_id, criado_em DESC) WHERE municipe_id IS NOT NULL;

-- A chamada do agente a antecipar um momento. Lista completa dos motivos de
-- chamadas-saida/regras.ts mais o novo.
ALTER TABLE chamadas_saida DROP CONSTRAINT chamadas_saida_motivo_check;
ALTER TABLE chamadas_saida ADD CONSTRAINT chamadas_saida_motivo_check
  CHECK (motivo IN ('processo_fase','pedido_documento','lembrete_prazo','manual',
    'campanha','renovacao_licenca','antecipacao'));
