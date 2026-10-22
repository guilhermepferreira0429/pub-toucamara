-- Entregar o pedido em nome da pessoa (FUN · "Funcionalidades que tiram
-- trabalho"): depois de a pessoa confirmar o resumo ao agente, vai um SMS com
-- um link para se autenticar com a Chave Móvel Digital e autorizar a entrega
-- no balcão online da câmara; autorizado, o pedido é submetido e chega o
-- comprovativo com o número de entrada.
--
-- Enquanto não houver credenciação na AMA (autenticacao.gov) nem acesso de
-- submissão ao balcão real, a autenticação e a submissão são SIMULADAS:
-- `simulado = true` em cada linha, o número de entrada começa por DEMO e o
-- comprovativo leva a marca "SIMULAÇÃO — SEM VALIDADE LEGAL".
--
-- Estados: preparado → a_espera_autorizacao → autorizado → entregue
-- (ou falhou / expirado / cancelado). Uma entrega viva por requerimento.

CREATE TABLE entregas_em_nome (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  requerimento_id         uuid NOT NULL REFERENCES requerimentos(id),
  processo_id             uuid REFERENCES processos(id),
  municipe_id             uuid REFERENCES municipes(id),
  conversa_id             uuid REFERENCES conversas(id),
  estado                  text NOT NULL DEFAULT 'preparado'
                            CHECK (estado IN ('preparado','a_espera_autorizacao','autorizado',
                                              'entregue','falhou','expirado','cancelado')),
  -- O que a pessoa confirmou ao agente (tipo, campos, documentos) e a marca
  -- dessa versão: se o pedido mudar depois, a autorização é recusada.
  resumo                  jsonb NOT NULL,
  resumo_hash             text NOT NULL,
  confirmacao             text NOT NULL CHECK (length(confirmacao) BETWEEN 1 AND 500),
  confirmado_em           timestamptz NOT NULL DEFAULT now(),
  canal                   text NOT NULL,
  token_publico           text UNIQUE NOT NULL
                            DEFAULT translate(encode(gen_random_bytes(18),'base64'),'+/','-_'),
  expira_em               timestamptz NOT NULL,
  autenticacao_modo       text NOT NULL CHECK (autenticacao_modo IN ('simulada','cmd')),
  submissao_modo          text NOT NULL CHECK (submissao_modo IN ('simulada','balcao')),
  simulado                boolean NOT NULL,
  -- Pedido de autenticação em curso (state guardado só em hash, como no OIDC).
  auth_state_hash         bytea,
  auth_verificador        text,
  auth_nonce              text,
  auth_iniciada_em        timestamptz,
  tentativas_autenticacao integer NOT NULL DEFAULT 0,
  consentimento_em        timestamptz,
  -- Quem autorizou: {nome, nif_mascarado, nivel_garantia, fornecedor, simulada}. Nunca o NIF em claro.
  identidade              jsonb,
  autorizado_em           timestamptz,
  numero_entrada          text,
  -- {numero_entrada, recebido_em, documentos, campos, simulado, ...}
  comprovativo            jsonb,
  entregue_em             timestamptz,
  tentativas              integer NOT NULL DEFAULT 0,
  erro                    text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);

-- Idempotência: não há duas entregas vivas do mesmo requerimento.
CREATE UNIQUE INDEX entregas_em_nome_viva_uidx ON entregas_em_nome (requerimento_id)
  WHERE estado IN ('preparado','a_espera_autorizacao','autorizado','entregue','falhou');
CREATE UNIQUE INDEX entregas_em_nome_numero_uidx ON entregas_em_nome (municipio_id, numero_entrada)
  WHERE numero_entrada IS NOT NULL;
CREATE INDEX entregas_em_nome_lista_idx ON entregas_em_nome (municipio_id, criado_em DESC);
CREATE INDEX entregas_em_nome_processo_idx ON entregas_em_nome (processo_id) WHERE processo_id IS NOT NULL;
CREATE INDEX entregas_em_nome_state_idx ON entregas_em_nome (auth_state_hash) WHERE auth_state_hash IS NOT NULL;
