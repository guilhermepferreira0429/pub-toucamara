-- "Não percebi esta carta da câmara" (o requerimento ao contrário).
--
-- O munícipe manda a fotografia (ou o PDF) de um ofício, notificação ou
-- edital que não percebe; a IA lê-o e nós explicamos, calculamos o prazo,
-- ligamos ao processo (se for dele) e preparamos a resposta.
--
-- `codigo` é o segredo da página /carta/{codigo} (10 caracteres sem 0/O/1/I/L,
-- como os links curtos): o SMS da voz leva este link direto.
CREATE TABLE cartas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  codigo              text NOT NULL UNIQUE,
  municipe_id         uuid REFERENCES municipes(id),
  conversa_id         uuid REFERENCES conversas(id),
  canal               text NOT NULL CHECK (canal IN ('chat','telefone','whatsapp','sms','ia','app','web','demo')),
  estado              text NOT NULL DEFAULT 'a_espera'
                        CHECK (estado IN ('a_espera','lida','ilegivel','respondida')),
  -- O ficheiro (só com armazenamento S3; sem ele lê-se e não se guarda).
  ficheiro_key        text,
  mime                text,
  tamanho             integer,
  -- A leitura validada (regras.ts: sem dados pessoais, prazo só com excerto).
  leitura             jsonb,
  da_camara           boolean,
  tipo                text,
  referencia          text,
  processo_id         uuid REFERENCES processos(id),
  -- O modelo de ofício a que a carta corresponde (o último ofício do processo).
  modelo_id           uuid REFERENCES modelos_resposta(id),
  data_rececao_dita   date,                           -- quando a pessoa diz que a recebeu
  leituras            integer NOT NULL DEFAULT 0,     -- pedidos à IA (limite por carta)
  prazo               jsonb,                          -- cálculo (regras.calcularPrazo)
  data_limite         date,
  lembrar             boolean NOT NULL DEFAULT true,  -- lembrete antes do fim do prazo
  lembrete_enviado_em timestamptz,
  demonstracao        boolean NOT NULL DEFAULT false, -- leitura de demonstração (sem IA)
  criado_em           timestamptz NOT NULL DEFAULT now(),
  lida_em             timestamptz,
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cartas_processo_idx ON cartas (processo_id) WHERE processo_id IS NOT NULL;
CREATE INDEX cartas_municipio_idx ON cartas (municipio_id, criado_em DESC);
CREATE INDEX cartas_lembrete_idx ON cartas (data_limite)
  WHERE lembrete_enviado_em IS NULL AND estado = 'lida' AND lembrar;

-- Os rascunhos de resposta: a pessoa revê, confirma e entrega.
CREATE TABLE carta_respostas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  carta_id        uuid NOT NULL REFERENCES cartas(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('pronuncia','prorrogacao','elementos','pagamento')),
  argumentos      text,                               -- o que a pessoa disse, por palavras dela
  texto           text NOT NULL,                      -- o rascunho (editável até entregar)
  estado          text NOT NULL DEFAULT 'rascunho'
                    CHECK (estado IN ('rascunho','entregue','descartada')),
  numero_entrada  text,                               -- 'DEMO-CARTA-…' (entrega simulada)
  pagamento_id    uuid REFERENCES pagamentos(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  entregue_em     timestamptz
);
CREATE INDEX carta_respostas_carta_idx ON carta_respostas (carta_id, criado_em);

-- Motivo de SMS 'carta' (o link para fotografar a carta, na voz). Acrescenta
-- à lista que estiver em vigor em vez de a repor: outras migrações desta
-- semana também mexem nesta lista e podem correr por outra ordem.
DO $$
DECLARE
  def text;
  valores text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'mensagens_saida_motivo_check'
    AND conrelid = 'mensagens_saida'::regclass;
  IF def IS NULL OR def LIKE '%''carta''%' THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_literal(m[1]), ',') INTO valores
  FROM regexp_matches(def, '''([a-z_]+)''', 'g') AS m;
  EXECUTE 'ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check';
  EXECUTE format(
    'ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check CHECK (motivo IN (%s,%L))',
    valores, 'carta');
END $$;
