-- "A câmara a ouvir em direto" (chamada web /ligar e chat):
-- 1. a transcrição em direto da chamada web, enviada pelo browser fala a fala
--    (a transcrição oficial continua a ser a do webhook do fim da chamada,
--    em conversa_turnos; esta é só para ver ao vivo);
-- 2. o funcionário a acompanhar e a "assumir a conversa" (mensagem injetada
--    no agente);
-- 3. "Fale com o meu filho" na chamada web: o familiar acompanha por um link
--    e escreve ao agente;
-- 4. os eventos públicos anonimizados do slide "Ao vivo" do pitch.

-- A sessão da chamada web: o token que o browser recebe quando a chamada
-- começa. Sem ele não se escreve nada. Guarda-se só o hash.
CREATE TABLE chamadas_ao_vivo (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  conversa_id          uuid NOT NULL UNIQUE REFERENCES conversas(id) ON DELETE CASCADE,
  token_hash           text NOT NULL UNIQUE,
  -- Chamada de demonstração (botão "simular chamada", só fora de produção):
  -- os SMS ficam gravados como simulados e nunca saem para o fornecedor.
  simulada             boolean NOT NULL DEFAULT false,
  criada_em            timestamptz NOT NULL DEFAULT now(),
  ultima_atividade_em  timestamptz NOT NULL DEFAULT now(),
  terminada_em         timestamptz,
  expira_em            timestamptz NOT NULL
);
CREATE INDEX chamadas_ao_vivo_ativas_idx ON chamadas_ao_vivo (municipio_id, ultima_atividade_em DESC)
  WHERE terminada_em IS NULL;

-- As falas em direto (e as ferramentas que o agente chamou, resumidas).
-- `seq` dá a ordem e serve de cursor ao SSE.
CREATE TABLE conversa_falas_ao_vivo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  conversa_id   uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  quem          text NOT NULL CHECK (quem IN ('municipe','agente','funcionario','familiar','ferramenta')),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
  ferramenta    text CHECK (length(ferramenta) <= 80),
  dados         jsonb NOT NULL DEFAULT '{}',
  autor_id      uuid REFERENCES utilizadores(id),      -- o funcionário que escreveu
  em            timestamptz NOT NULL DEFAULT now(),    -- o instante dito pelo browser
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversa_falas_ao_vivo_idx ON conversa_falas_ao_vivo (conversa_id, seq);

-- "Fale com o meu filho" na chamada web: a junção passa a ter o modo 'web'.
ALTER TABLE juncoes_familiar DROP CONSTRAINT juncoes_familiar_modo_check;
ALTER TABLE juncoes_familiar ADD CONSTRAINT juncoes_familiar_modo_check
  CHECK (modo IN ('conferencia','sms','web'));
ALTER TABLE juncoes_familiar DROP CONSTRAINT juncoes_familiar_estado_check;
ALTER TABLE juncoes_familiar ADD CONSTRAINT juncoes_familiar_estado_check
  CHECK (estado IN ('pedida','a_juntar','agente_ligado','familiar_atendeu',
    'familiar_nao_atendeu','terminada','falhou','sms_enviado',
    'a_acompanhar','retirada'));

-- O link do familiar: curto prazo, uso limitado, só aquela conversa. O
-- munícipe retira ("já não preciso") e o link deixa de funcionar.
CREATE TABLE acompanhamentos_familiar (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  conversa_id    uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  juncao_id      uuid NOT NULL UNIQUE REFERENCES juncoes_familiar(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  nome_familiar  text,
  relacao        text,
  expira_em      timestamptz NOT NULL,
  aberturas      integer NOT NULL DEFAULT 0 CHECK (aberturas >= 0),
  max_aberturas  integer NOT NULL DEFAULT 20 CHECK (max_aberturas > 0),
  mensagens      integer NOT NULL DEFAULT 0 CHECK (mensagens >= 0),
  max_mensagens  integer NOT NULL DEFAULT 10 CHECK (max_mensagens > 0),
  retirado_em    timestamptz,
  retirado_por   text CHECK (retirado_por IN ('municipe','sistema')),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acompanhamentos_familiar_conversa_idx ON acompanhamentos_familiar (conversa_id);

-- O que o slide "Ao vivo" do pitch mostra: só textos fixos, sem nomes,
-- telefones nem moradas completas (a rua, sem número, no máximo).
CREATE TABLE ao_vivo_eventos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  tipo          text NOT NULL CHECK (tipo IN ('chamada','pergunta','licenca','ocorrencia','marcacao',
                  'requerimento','passagem','pagamento','sms','familiar','funcionario','fim','outro')),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 1 AND 120),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ao_vivo_eventos_idx ON ao_vivo_eventos (municipio_id, seq);
