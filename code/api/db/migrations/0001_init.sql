-- Tou, Câmara? · esquema inicial (docs/PLANS/api-e-modelo-de-dados.md, secções 4.0 a 4.11).
-- Os comentários "-- V2" marcam o que não é preciso na semana mas já fica no esquema.
-- RLS (4.12) e vistas materializadas (4.13) entram em migrações seguintes.

-- ======================================================================
-- 4.0 Extensões e tipos
-- ======================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid, cifra do NIF
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- pesquisa aproximada de moradas e nomes
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- impedir marcações sobrepostas

CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;

CREATE TYPE canal            AS ENUM ('telefone','chat','sms','email','balcao','whatsapp');
CREATE TYPE perfil           AS ENUM ('atendimento','tecnico','chefe_divisao','vereador','equipa_toucamara','admin');
CREATE TYPE papel_turno      AS ENUM ('agente','municipe','funcionario','sistema');
CREATE TYPE resultado_conv   AS ENUM ('em_curso','resolvida','passada_funcionario','sem_resposta','marcacao','emergencia','caiu');
CREATE TYPE fase_processo    AS ENUM ('entrada','documentos','apreciacao','pareceres_externos','decisao','notificado','arquivado');
CREATE TYPE estado_ocorr     AS ENUM ('nova','com_equipa','resolvida','duplicada','rejeitada');
CREATE TYPE estado_req       AS ENUM ('a_preencher','pronto','assinado','entregue','cancelado');
CREATE TYPE assinatura_tipo  AS ENUM ('cmd','cartao_cidadao','simulada');
CREATE TYPE estado_pag       AS ENUM ('pendente','pago','expirado','cancelado');
CREATE TYPE metodo_pag       AS ENUM ('multibanco','mbway','cartao');
CREATE TYPE estado_msg       AS ENUM ('agendada','pendente','enviada','entregue','falhou');
CREATE TYPE ator_tipo        AS ENUM ('sistema','agente','utilizador','municipe');

-- ======================================================================
-- 4.1 Câmara, entidades e pessoas
-- ======================================================================
CREATE TABLE municipios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,                 -- 'guimaraes'
  nome          text NOT NULL,
  fuso          text NOT NULL DEFAULT 'Europe/Lisbon',
  telefone_linha text,                                -- número da linha Tou, Câmara?
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- O concelho inteiro: Câmara, Vimágua, Vitrus, Tempo Livre, CASFIG, juntas, nacionais (só encaminhar), 112
CREATE TABLE entidades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('camara','empresa_municipal','junta','nacional','emergencia','outra')),
  descricao     text,                                 -- 'Água e saneamento de Guimarães e Vizela'
  site_url      text,
  ativo         boolean NOT NULL DEFAULT true,
  UNIQUE (municipio_id, nome)
);

CREATE TABLE entidade_contactos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade_id   uuid NOT NULL REFERENCES entidades(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('telefone','avarias','email','morada','balcao','site')),
  rotulo        text,                                 -- 'Avarias, 24 horas'
  valor         text NOT NULL,                        -- '800 910 410'
  horario       jsonb,                                -- {"seg-sex":"9:00-16:00"} ou {"sempre":true}
  fonte_versao_id uuid                                -- de onde veio (FK em 4.3)
);

CREATE TABLE servicos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  entidade_id   uuid NOT NULL REFERENCES entidades(id),
  nome          text NOT NULL,                        -- 'Obras particulares', 'Equipa de vias'
  email         citext,
  telefone      text
);

CREATE TABLE utilizadores (                           -- funcionários da câmara e equipa Tou, Câmara?
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid REFERENCES municipios(id),       -- NULL = equipa interna, vê vários municípios
  email         citext UNIQUE NOT NULL,
  nome          text NOT NULL,
  perfil        perfil NOT NULL,
  servico_id    uuid REFERENCES servicos(id),
  foto_url      text,
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_acesso_em timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE municipes (                              -- nunca têm foto (decisão de design + RGPD)
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  telefone_e164    text,
  nome             text,
  email            citext,
  nif_cifrado      bytea,                             -- pgp_sym_encrypt(nif, chave da app)
  nif_hash         bytea,                             -- hmac(nif, pepper) para procurar
  idioma           text NOT NULL DEFAULT 'pt-PT',
  canal_preferido  text CHECK (canal_preferido IN ('sms','email','telefone')),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  anonimizado_em   timestamptz
);
CREATE UNIQUE INDEX municipes_tel_uq ON municipes (municipio_id, telefone_e164) WHERE anonimizado_em IS NULL;
CREATE INDEX municipes_nif_idx ON municipes (municipio_id, nif_hash);

CREATE TABLE feriados (                              -- para contar dias úteis nos prazos
  id            serial PRIMARY KEY,
  municipio_id  uuid REFERENCES municipios(id),       -- NULL = feriado nacional
  data          date NOT NULL,
  nome          text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (municipio_id, data)
);

-- ======================================================================
-- 4.2 Conversas
-- ======================================================================
CREATE TABLE temas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id uuid NOT NULL REFERENCES municipios(id),
  nome         text NOT NULL,                         -- 'Obras dentro de casa'
  pai_id       uuid REFERENCES temas(id),
  UNIQUE (municipio_id, nome)
);

CREATE TABLE conversas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id           uuid NOT NULL REFERENCES municipios(id),
  municipe_id            uuid REFERENCES municipes(id),
  canal                  canal NOT NULL,
  provider_id            text UNIQUE,                 -- id da conversa no ElevenLabs / sessão de chat
  iniciada_em            timestamptz NOT NULL DEFAULT now(),
  terminada_em           timestamptz,
  duracao_s              integer,
  idioma                 text NOT NULL DEFAULT 'pt-PT',
  consentimento_em       timestamptz,                 -- aviso de gravação aceite; sem isto não se grava
  gravacao_key           text,                        -- S3; apagada aos 30 dias
  resultado              resultado_conv NOT NULL DEFAULT 'em_curso',
  tema_id                uuid REFERENCES temas(id),
  resumo                 text,                        -- gerado por Sonnet
  continuacao_de         uuid REFERENCES conversas(id),  -- "retomar a conversa"
  agente_versao          text,                        -- para ligar a evals
  revisao                text CHECK (revisao IN ('certa','errada')),   -- "O agente respondeu bem?"
  revisao_nota           text,
  revista_por            uuid REFERENCES utilizadores(id),
  revista_em             timestamptz,
  fora_de_horas          boolean                      -- preenchido no webhook: horário do balcão + feriados
);
CREATE INDEX conversas_painel_idx ON conversas (municipio_id, iniciada_em DESC);
CREATE INDEX conversas_municipe_idx ON conversas (municipe_id, iniciada_em DESC);

CREATE TABLE conversa_turnos (
  id           bigserial PRIMARY KEY,
  conversa_id  uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  ordem        integer NOT NULL,
  papel        papel_turno NOT NULL,
  texto        text NOT NULL,
  inicio_ms    integer,                               -- posição na gravação (leitor com marcadores)
  fim_ms       integer,
  UNIQUE (conversa_id, ordem)
);

CREATE TABLE conversa_momentos (                      -- marcadores do leitor de áudio e da linha do tempo
  id           bigserial PRIMARY KEY,
  conversa_id  uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('consentimento','pergunta_de_volta','resposta_com_fonte','requerimento',
                 'ocorrencia','marcacao','recolha','pagamento','sms','passagem','emergencia','idioma')),
  em_ms        integer,
  turno_id     bigint REFERENCES conversa_turnos(id),
  dados        jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE passagens_humano (                       -- "passa a um funcionário com o caso resumido"
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id          uuid NOT NULL REFERENCES conversas(id),
  motivo               text NOT NULL CHECK (motivo IN ('pedido','sem_fonte','juridico','politica','processo','outro')),
  resumo               text NOT NULL,                 -- "O que o funcionário já sabe"
  fora_de_horas        boolean NOT NULL,
  preferencia_resposta text CHECK (preferencia_resposta IN ('chat','telefone','sms','email')),
  responder_ate        timestamptz,                   -- "Resposta até amanhã, 12h"
  atribuida_a          uuid REFERENCES utilizadores(id),
  estado               text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','em_curso','respondida','fechada')),
  criada_em            timestamptz NOT NULL DEFAULT now(),
  respondida_em        timestamptz
);

-- ======================================================================
-- 4.3 Conhecimento (o concelho inteiro, com fonte e data)
-- ======================================================================
CREATE TABLE fontes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id      uuid NOT NULL REFERENCES municipios(id),
  entidade_id       uuid NOT NULL REFERENCES entidades(id),
  titulo            text NOT NULL,                    -- 'RJUE', 'Tabela de Taxas Municipais'
  tipo              text NOT NULL CHECK (tipo IN ('lei','regulamento','tabela','pagina','formulario','plano','contactos')),
  url               text NOT NULL,
  ler_a_cada        interval NOT NULL DEFAULT '1 day',
  ultima_leitura_em timestamptz,
  ultimo_hash       text,
  estado            text NOT NULL DEFAULT 'em_dia' CHECK (estado IN ('em_dia','mudou','erro')),
  erro              text,
  UNIQUE (municipio_id, url)
);

CREATE TABLE fonte_versoes (                          -- "que regra valia em cada data"
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id      uuid NOT NULL REFERENCES fontes(id),
  hash          text NOT NULL,
  conteudo_key  text,                                 -- original em S3 (PDF/HTML)
  texto         text NOT NULL,                        -- texto limpo
  lida_em       timestamptz NOT NULL DEFAULT now(),
  vigor_desde   date,
  vigor_ate     date,                                 -- NULL = em vigor
  UNIQUE (fonte_id, hash)
);
ALTER TABLE entidade_contactos ADD FOREIGN KEY (fonte_versao_id) REFERENCES fonte_versoes(id);

CREATE TABLE trechos (                                -- o que o agente cita
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_versao_id  uuid NOT NULL REFERENCES fonte_versoes(id) ON DELETE CASCADE,
  ordem            integer NOT NULL,
  referencia       text,                              -- 'art. 6.º, n.º 1'
  texto            text NOT NULL,
  embedding        vector(1024),
  tsv              tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent', coalesce(referencia,'') || ' ' || texto)) STORED,
  vigor_desde      date,
  vigor_ate        date
);
CREATE INDEX trechos_vec_idx ON trechos USING hnsw (embedding vector_cosine_ops);
CREATE INDEX trechos_tsv_idx ON trechos USING gin (tsv);

CREATE TABLE citacoes (                               -- cada resposta guarda o trecho e a versão citados
  turno_id   bigint NOT NULL REFERENCES conversa_turnos(id) ON DELETE CASCADE,
  trecho_id  uuid NOT NULL REFERENCES trechos(id),
  PRIMARY KEY (turno_id, trecho_id)
);

-- Respostas curadas (perguntas frequentes): na v1 editadas pela nossa equipa; na V2 pela câmara
CREATE TABLE respostas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  pergunta_tipo    text NOT NULL,                     -- 'Preciso de licença para obras na cozinha?'
  tema_id          uuid REFERENCES temas(id),
  estado           text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','em_teste','no_ar','arquivada')),
  versao_no_ar_id  uuid,
  usos_30d         integer NOT NULL DEFAULT 0
);

CREATE TABLE resposta_versoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resposta_id        uuid NOT NULL REFERENCES respostas(id) ON DELETE CASCADE,
  numero             integer NOT NULL,
  texto_voz          text NOT NULL,                   -- "ao telefone e no chat"
  texto_sms          text,                            -- versão curta; ver segmentos em 4.9
  passa_a_pessoa_quando text[] NOT NULL DEFAULT '{}', -- 'perguntam por prazos'
  criada_por         uuid REFERENCES utilizadores(id),
  criada_em          timestamptz NOT NULL DEFAULT now(),
  publicada_em       timestamptz,
  eval_execucao_id   uuid,                            -- teste que a deixou ir para o ar (FK em 4.4)
  UNIQUE (resposta_id, numero)
);
ALTER TABLE respostas ADD FOREIGN KEY (versao_no_ar_id) REFERENCES resposta_versoes(id);

CREATE TABLE resposta_fontes (
  resposta_versao_id uuid NOT NULL REFERENCES resposta_versoes(id) ON DELETE CASCADE,
  trecho_id          uuid NOT NULL REFERENCES trechos(id),
  PRIMARY KEY (resposta_versao_id, trecho_id)
);

CREATE TABLE resposta_frases (                        -- "as pessoas perguntam assim"
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resposta_id  uuid NOT NULL REFERENCES respostas(id) ON DELETE CASCADE,
  frase        text NOT NULL,
  embedding    vector(1024)
);
CREATE INDEX resposta_frases_vec_idx ON resposta_frases USING hnsw (embedding vector_cosine_ops);

CREATE TABLE perguntas_sem_resposta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id    uuid NOT NULL REFERENCES municipios(id),
  texto           text NOT NULL,                      -- forma canónica do agrupamento
  embedding       vector(1024),
  vezes           integer NOT NULL DEFAULT 1,
  primeira_em     timestamptz NOT NULL DEFAULT now(),
  ultima_em       timestamptz NOT NULL DEFAULT now(),
  estado          text NOT NULL DEFAULT 'nova' CHECK (estado IN ('nova','com_equipa','espera_camara','resolvida','fora_ambito')),
  o_que_falta     text,                               -- 'Uma regra escrita do Património...'
  resposta_id     uuid REFERENCES respostas(id)
);
CREATE TABLE pergunta_sem_resposta_ocorrencias (
  psr_id     uuid NOT NULL REFERENCES perguntas_sem_resposta(id) ON DELETE CASCADE,
  turno_id   bigint NOT NULL REFERENCES conversa_turnos(id),
  PRIMARY KEY (psr_id, turno_id)
);

CREATE TABLE ingestoes (                              -- leitura noturna das 03:00
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  iniciada_em   timestamptz NOT NULL DEFAULT now(),
  terminada_em  timestamptz,
  fontes_lidas  integer, mudancas integer, erros integer
);

CREATE TABLE alteracoes (                             -- Conhecimento · Alterações
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id            uuid NOT NULL REFERENCES fontes(id),
  versao_anterior_id  uuid REFERENCES fonte_versoes(id),
  versao_nova_id      uuid NOT NULL REFERENCES fonte_versoes(id),
  resumo              text,                           -- '2026 → 2027 · 14 valores mudaram'
  diff                jsonb,                          -- linhas antes/depois
  detetada_em         timestamptz NOT NULL DEFAULT now(),
  estado              text NOT NULL DEFAULT 'por_rever' CHECK (estado IN ('por_rever','aprovada','ignorada')),
  aprovada_por        uuid REFERENCES utilizadores(id)
);
CREATE TABLE alteracao_respostas (                    -- respostas afetadas + correção proposta
  alteracao_id        uuid NOT NULL REFERENCES alteracoes(id) ON DELETE CASCADE,
  resposta_id         uuid NOT NULL REFERENCES respostas(id),
  proposta_versao_id  uuid REFERENCES resposta_versoes(id),
  estado              text NOT NULL DEFAULT 'proposta' CHECK (estado IN ('proposta','aprovada','rejeitada')),
  PRIMARY KEY (alteracao_id, resposta_id)
);

CREATE TABLE contradicoes (                           -- "Encontrámos informação contraditória"
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  assunto        text NOT NULL,                       -- 'Falta de água · contacto'
  trecho_a_id    uuid NOT NULL REFERENCES trechos(id),
  valor_a        text NOT NULL,
  trecho_b_id    uuid NOT NULL REFERENCES trechos(id),
  valor_b        text NOT NULL,
  usar           text NOT NULL CHECK (usar IN ('a','b')),  -- o agente usa a entidade responsável
  estado         text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','avisada','resolvida')),
  detetada_em    timestamptz NOT NULL DEFAULT now()
);

-- ======================================================================
-- 4.4 Qualidade (evals)
-- ======================================================================
CREATE TABLE eval_perguntas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid REFERENCES municipios(id),       -- NULL = lista base de 180; preenchido = "as perguntas da câmara"
  categoria     text NOT NULL,                        -- 'Obras e urbanismo', 'Perguntas difíceis'
  texto         text NOT NULL,
  esperado      text NOT NULL CHECK (esperado IN ('responder','encaminhar','perguntar','passar_humano','emergencia','fora_ambito','outra_lingua')),
  entidade_esperada_id uuid REFERENCES entidades(id),
  referencia    text,                                 -- resposta certa resumida, para o avaliador
  ativa         boolean NOT NULL DEFAULT true
);

CREATE TABLE eval_execucoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  agente_versao  text NOT NULL,
  motivo         text NOT NULL CHECK (motivo IN ('agendada','publicacao','manual')),
  iniciada_em    timestamptz NOT NULL DEFAULT now(),
  terminada_em   timestamptz,
  total          integer, certas integer, passadas_bem integer, erradas integer,
  limiar         numeric(5,2) NOT NULL DEFAULT 80.00,
  taxa           numeric(5,2) GENERATED ALWAYS AS
                   (CASE WHEN total > 0 THEN round(100.0 * (certas + passadas_bem) / total, 2) END) STORED,
  passou         boolean GENERATED ALWAYS AS
                   (CASE WHEN total > 0 THEN (100.0 * (certas + passadas_bem) / total) >= limiar END) STORED
);
ALTER TABLE resposta_versoes ADD FOREIGN KEY (eval_execucao_id) REFERENCES eval_execucoes(id);

CREATE TABLE eval_resultados (
  execucao_id   uuid NOT NULL REFERENCES eval_execucoes(id) ON DELETE CASCADE,
  pergunta_id   uuid NOT NULL REFERENCES eval_perguntas(id),
  resposta      text NOT NULL,
  avaliacao     text NOT NULL CHECK (avaliacao IN ('certa','passada_bem','errada')),
  motivo        text,
  latencia_ms   integer,
  origem        text NOT NULL DEFAULT 'teste' CHECK (origem IN ('teste','funcionario')),  -- "marcada por um funcionário"
  PRIMARY KEY (execucao_id, pergunta_id)
);

-- ======================================================================
-- 4.5 Requerimentos e processos (back-office próprio)
-- ======================================================================
CREATE TABLE tipos_processo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  codigo             text NOT NULL,                   -- 'CP', 'LO', 'LU', 'OV'
  nome               text NOT NULL,                   -- 'Comunicação prévia · obras de alteração'
  prazo_dias_uteis   integer NOT NULL,
  servico_id         uuid REFERENCES servicos(id),
  base_legal_trecho  uuid REFERENCES trechos(id),
  formulario         jsonb NOT NULL,                  -- campos do requerimento: [{chave, rotulo, tipo, obrigatorio, pergunta_do_agente}]
  frase_do_agente    text,                            -- "O que o agente diz ao munícipe"
  ativo              boolean NOT NULL DEFAULT true,
  UNIQUE (municipio_id, codigo)
);

CREATE TABLE tipo_processo_documentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_processo_id   uuid NOT NULL REFERENCES tipos_processo(id) ON DELETE CASCADE,
  nome               text NOT NULL,                   -- 'Certidão do registo predial'
  obrigatorio        boolean NOT NULL DEFAULT true,
  ordem              integer NOT NULL,
  verificacoes       jsonb NOT NULL DEFAULT '[]',     -- [{"tipo":"validade","meses":6},{"tipo":"assinatura"},{"tipo":"nif_requerente"}]
  gerado_pelo_sistema boolean NOT NULL DEFAULT false  -- planta de localização
);

CREATE TABLE numeracao (                              -- 'CP 412/2026', 'OC-0381'
  municipio_id uuid NOT NULL REFERENCES municipios(id),
  prefixo      text NOT NULL,
  ano          integer NOT NULL,
  ultimo       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (municipio_id, prefixo, ano)
);
-- Próximo número (atómico):
-- INSERT INTO numeracao VALUES ($1,$2,$3,1) ON CONFLICT (municipio_id,prefixo,ano)
--   DO UPDATE SET ultimo = numeracao.ultimo + 1 RETURNING ultimo;

CREATE TABLE requerimentos (                          -- preenchido durante a chamada (momento uau)
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id       uuid NOT NULL REFERENCES municipios(id),
  municipe_id        uuid REFERENCES municipes(id),
  conversa_id        uuid REFERENCES conversas(id),
  tipo_processo_id   uuid NOT NULL REFERENCES tipos_processo(id),
  dados              jsonb NOT NULL DEFAULT '{}',     -- valores por chave do formulário
  campos_em_falta    text[] NOT NULL DEFAULT '{}',
  idioma_conversa    text NOT NULL DEFAULT 'pt-PT',   -- o documento sai sempre em português
  estado             estado_req NOT NULL DEFAULT 'a_preencher',
  assinatura         assinatura_tipo,                 -- 'simulada' no hackathon
  assinado_em        timestamptz,
  pdf_key            text,
  token_publico      text UNIQUE NOT NULL DEFAULT translate(encode(gen_random_bytes(18),'base64'),'+/','-_'),
  processo_id        uuid,                            -- FK abaixo; criado quando é entregue
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  numero              text NOT NULL,                  -- 'CP 412/2026'
  tipo_processo_id    uuid NOT NULL REFERENCES tipos_processo(id),
  municipe_id         uuid REFERENCES municipes(id),
  conversa_origem_id  uuid REFERENCES conversas(id),
  assunto             text NOT NULL,                  -- 'Porta na cozinha'
  morada              text, freguesia text,
  lat double precision, lng double precision,
  fase                fase_processo NOT NULL DEFAULT 'entrada',
  tecnico_id          uuid REFERENCES utilizadores(id),
  prazo_inicio        date,                           -- só conta com o processo completo
  prazo_fim           date,
  decisao             text CHECK (decisao IN ('admitido','indeferido')),
  decidido_em         timestamptz,
  gd_id               text,                           -- V2: n.º na gestão documental
  gd_estado           text NOT NULL DEFAULT 'nao_aplicavel'
                        CHECK (gd_estado IN ('nao_aplicavel','por_sincronizar','sincronizado','erro')),
  gd_tentativas       integer NOT NULL DEFAULT 0,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
ALTER TABLE requerimentos ADD FOREIGN KEY (processo_id) REFERENCES processos(id);
CREATE INDEX processos_lista_idx ON processos (municipio_id, fase, prazo_fim);
CREATE INDEX processos_municipe_idx ON processos (municipe_id);

CREATE TABLE processo_eventos (                       -- linha do tempo; só se acrescenta
  id           bigserial PRIMARY KEY,
  processo_id  uuid NOT NULL REFERENCES processos(id),
  tipo         text NOT NULL,                         -- 'criado','documento_recebido','documento_pedido','fase','nota_interna','sync_erro',...
  descricao    text NOT NULL,
  ator_tipo    ator_tipo NOT NULL,
  ator_id      uuid,
  interno      boolean NOT NULL DEFAULT false,        -- nota interna: o munícipe não vê
  dados        jsonb NOT NULL DEFAULT '{}',
  em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processo_eventos_idx ON processo_eventos (processo_id, em);

CREATE TABLE documentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  processo_id         uuid REFERENCES processos(id),
  requerimento_id     uuid REFERENCES requerimentos(id),
  tipo_documento_id   uuid REFERENCES tipo_processo_documentos(id),
  ficheiro_key        text NOT NULL,
  mime                text NOT NULL,
  tamanho             integer,
  origem              text NOT NULL CHECK (origem IN ('foto','upload','email','tecnico','gerado')),
  verificacao_estado  text NOT NULL DEFAULT 'por_verificar'
                        CHECK (verificacao_estado IN ('por_verificar','valido','fora_de_prazo','documento_errado','ilegivel')),
  verificacao         jsonb,                          -- [{"regra":"validade","ok":false,"detalhe":"emitida há 8 meses"}]
  emitido_em          date,
  recebido_em         timestamptz NOT NULL DEFAULT now(),
  CHECK (processo_id IS NOT NULL OR requerimento_id IS NOT NULL)
);

-- V2: pareceres, ofícios e notificações gerados para o técnico aprovar
CREATE TABLE modelos_resposta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  canal         text NOT NULL CHECK (canal IN ('oficio','email','sms')),
  nome          text NOT NULL,
  corpo         text NOT NULL,                        -- com {nome}, {n.º do processo}, ...
  estado        text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','a_rever','aprovado')),
  aprovado_por  uuid REFERENCES utilizadores(id),
  aprovado_em   timestamptz,
  versao        integer NOT NULL DEFAULT 1
);

CREATE TABLE documentos_gerados (                     -- V2
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id        uuid NOT NULL REFERENCES processos(id),
  tipo               text NOT NULL CHECK (tipo IN ('parecer','oficio','notificacao_sms')),
  modelo_id          uuid REFERENCES modelos_resposta(id),
  versao             integer NOT NULL DEFAULT 1,
  corpo              text NOT NULL,
  estado             text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','aprovado','assinado','enviado')),
  assinatura         assinatura_tipo,
  assinado_por       uuid REFERENCES utilizadores(id),
  assinado_em        timestamptz,
  pdf_key            text
);

-- ======================================================================
-- 4.6 Ocorrências
-- ======================================================================
CREATE TABLE categorias_ocorrencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  nome          text NOT NULL,                        -- 'Buraco na via'
  icone         text,                                 -- nome lucide, para o painel
  servico_id    uuid REFERENCES servicos(id),         -- 'Equipa de vias e pavimentos' ou Vitrus
  UNIQUE (municipio_id, nome)
);

CREATE TABLE ocorrencias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id   uuid NOT NULL REFERENCES municipios(id),
  numero         text NOT NULL,                       -- 'OC-0381'
  categoria_id   uuid NOT NULL REFERENCES categorias_ocorrencia(id),
  descricao      text NOT NULL,
  morada         text NOT NULL,
  lat double precision, lng double precision,         -- geocodificado e confirmado na chamada
  estado         estado_ocorr NOT NULL DEFAULT 'nova',
  servico_id     uuid REFERENCES servicos(id),
  municipe_id    uuid REFERENCES municipes(id),
  conversa_id    uuid REFERENCES conversas(id),
  duplicada_de   uuid REFERENCES ocorrencias(id),     -- "o mesmo buraco, reportado por cinco pessoas"
  prevista_para  date,
  resolvida_em   timestamptz,
  token_publico  text UNIQUE NOT NULL DEFAULT translate(encode(gen_random_bytes(18),'base64'),'+/','-_'),
  criada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero)
);
CREATE INDEX ocorrencias_mapa_idx ON ocorrencias (municipio_id, estado, lat, lng);

CREATE TABLE ocorrencia_fotos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocorrencia_id  uuid NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  ficheiro_key   text NOT NULL,
  enviada_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ocorrencia_eventos (
  id             bigserial PRIMARY KEY,
  ocorrencia_id  uuid NOT NULL REFERENCES ocorrencias(id),
  tipo           text NOT NULL,                       -- 'registada','foto','atribuida','resolvida','avisado_sms'
  ator_tipo      ator_tipo NOT NULL,
  ator_id        uuid,
  dados          jsonb NOT NULL DEFAULT '{}',
  em             timestamptz NOT NULL DEFAULT now()
);

-- ======================================================================
-- 4.7 Taxas e pagamentos (modo de teste no hackathon)
-- ======================================================================
CREATE TABLE tabelas_taxas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  ano              integer NOT NULL,
  vigor_desde      date NOT NULL,
  vigor_ate        date,
  fonte_versao_id  uuid REFERENCES fonte_versoes(id)
);

CREATE TABLE taxas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id   uuid NOT NULL REFERENCES tabelas_taxas(id) ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,                          -- 'Apreciação do pedido', 'Obra, por m²'
  unidade     text NOT NULL CHECK (unidade IN ('fixo','m2','dia','pagina','fogo','mesa')),
  valor_cent  integer NOT NULL CHECK (valor_cent >= 0),
  tipo_processo_id uuid REFERENCES tipos_processo(id),
  UNIQUE (tabela_id, codigo)
);

CREATE TABLE pagamentos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  processo_id      uuid REFERENCES processos(id),
  requerimento_id  uuid REFERENCES requerimentos(id),
  guia_numero      text,                              -- '2026/44120'
  valor_cent       integer NOT NULL CHECK (valor_cent > 0),
  detalhe          jsonb NOT NULL,                    -- linhas da simulação: [{taxa, quantidade, valor_cent}]
  metodo           metodo_pag,
  mb_entidade      text, mb_referencia text,
  pagar_ate        date,
  estado           estado_pag NOT NULL DEFAULT 'pendente',
  modo_teste       boolean NOT NULL DEFAULT true,     -- obrigatório dizer no pitch
  provider         text, provider_ref text,
  pago_em          timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK (processo_id IS NOT NULL OR requerimento_id IS NOT NULL)
);

-- ======================================================================
-- 4.8 Marcações e recolhas
-- ======================================================================
CREATE TABLE agendas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  servico_id    uuid NOT NULL REFERENCES servicos(id),
  nome          text NOT NULL,                        -- 'Balcão Único · Licenciamento'
  local         text,                                 -- 'Largo Cónego José Maria Gomes'
  duracao_slot  interval NOT NULL DEFAULT '30 minutes',
  horario       jsonb NOT NULL                        -- {"seg":["09:00-16:00"], ...}
);

CREATE TABLE marcacoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id           uuid NOT NULL REFERENCES agendas(id),
  municipe_id         uuid NOT NULL REFERENCES municipes(id),
  conversa_id         uuid REFERENCES conversas(id),
  periodo             tstzrange NOT NULL,
  assunto             text,
  levar               text[],                         -- 'Cartão de Cidadão'
  estado              text NOT NULL DEFAULT 'marcada' CHECK (estado IN ('marcada','cancelada','realizada','faltou')),
  lembrete_enviado_em timestamptz,
  token_publico       text UNIQUE NOT NULL DEFAULT translate(encode(gen_random_bytes(18),'base64'),'+/','-_'),
  EXCLUDE USING gist (agenda_id WITH =, periodo WITH &&) WHERE (estado = 'marcada')
);

CREATE TABLE recolhas (                               -- monos, com a Vitrus
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  entidade_id   uuid NOT NULL REFERENCES entidades(id),
  municipe_id   uuid NOT NULL REFERENCES municipes(id),
  conversa_id   uuid REFERENCES conversas(id),
  morada        text NOT NULL,
  itens         jsonb NOT NULL,                       -- [{"item":"sofá","qtd":1}]
  janela        tstzrange NOT NULL,
  estado        text NOT NULL DEFAULT 'marcada' CHECK (estado IN ('marcada','feita','cancelada'))
);

-- ======================================================================
-- 4.9 Comunicação (SMS, email, links curtos, email geral)
-- ======================================================================
CREATE TABLE mensagens_saida (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  municipe_id   uuid REFERENCES municipes(id),
  canal         text NOT NULL CHECK (canal IN ('sms','email')),
  destino       text NOT NULL,
  motivo        text NOT NULL CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
                  'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio')),
  modelo_id     uuid REFERENCES modelos_resposta(id),
  corpo         text NOT NULL,
  codificacao   text CHECK (codificacao IN ('gsm7','ucs2')),
  segmentos     integer,                              -- com acentos (UCS-2) cada SMS leva 70, não 160
  relacionado   jsonb NOT NULL DEFAULT '{}',          -- {"conversa_id":..., "processo_id":...}
  enviar_em     timestamptz NOT NULL DEFAULT now(),   -- lembretes agendados
  estado        estado_msg NOT NULL DEFAULT 'pendente',
  provider_id   text,
  custo_cent    integer,
  enviada_em    timestamptz, entregue_em timestamptz, erro text,
  chave_idempotencia text UNIQUE                      -- evita SMS duplicados se o webhook repetir
);
CREATE INDEX mensagens_fila_idx ON mensagens_saida (estado, enviar_em) WHERE estado IN ('agendada','pendente');

CREATE TABLE links_curtos (                           -- toucamara.pt/r/8K2F
  codigo        text PRIMARY KEY,
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  destino_tipo  text NOT NULL CHECK (destino_tipo IN ('resumo','requerimento','ocorrencia','processo','marcacao','pagamento')),
  destino_id    uuid NOT NULL,
  expira_em     timestamptz NOT NULL,
  aberturas     integer NOT NULL DEFAULT 0,
  primeira_abertura_em timestamptz
);

CREATE TABLE emails_entrada (                         -- triagem do email geral + rascunho de resposta
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id        uuid NOT NULL REFERENCES municipios(id),
  de                  citext NOT NULL,
  assunto             text,
  corpo               text NOT NULL,
  anexos              jsonb NOT NULL DEFAULT '[]',
  recebido_em         timestamptz NOT NULL,
  servico_id          uuid REFERENCES servicos(id),
  entidade_id         uuid REFERENCES entidades(id),
  tema_id             uuid REFERENCES temas(id),
  confianca           numeric(3,2),
  rascunho_resposta   text,
  estado              text NOT NULL DEFAULT 'nova' CHECK (estado IN ('nova','respondida','encaminhada','virou_processo')),
  respondido_por      uuid REFERENCES utilizadores(id),
  processo_id         uuid REFERENCES processos(id)
);

-- ======================================================================
-- 4.10 Configuração do agente
-- ======================================================================
CREATE TABLE agente_config (                          -- V2 editável pela câmara; v1 pela nossa equipa
  municipio_id  uuid PRIMARY KEY REFERENCES municipios(id),
  nome          text NOT NULL DEFAULT 'Tou, Câmara?', -- nome que o munícipe ouve
  voz_id        text,                                 -- ElevenLabs
  saudacao      text NOT NULL,
  trata_por     text NOT NULL DEFAULT 'você',
  idiomas       text[] NOT NULL DEFAULT '{pt-PT}',
  versao        text NOT NULL                         -- muda a cada publicação; liga a evals e conversas
);

CREATE TABLE regras_encaminhamento (                  -- "Quem trata de quê"
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  assunto       text NOT NULL,                        -- 'Falta de água, roturas'
  entidade_id   uuid NOT NULL REFERENCES entidades(id),
  contacto_id   uuid REFERENCES entidade_contactos(id),
  passa_a_pessoa text,                                -- 'se for na via pública'
  prioridade    integer NOT NULL DEFAULT 100,         -- 112 = 0
  ativo         boolean NOT NULL DEFAULT true
);

CREATE TABLE pronuncias (                             -- 'Gualterianas' → 'gual-te-ri-a-nas'
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  termo         text NOT NULL,
  como_se_diz   text NOT NULL,
  PRIMARY KEY (municipio_id, termo)
);

-- ======================================================================
-- 4.11 Auditoria, relatórios e RGPD
-- ======================================================================
CREATE TABLE audit_log (                              -- "quem viu e alterou"; só se acrescenta
  id            bigserial,
  municipio_id  uuid,
  ator_tipo     ator_tipo NOT NULL,
  ator_id       uuid,
  acao          text NOT NULL,                        -- 'ver','ouvir_gravacao','aprovar','reatribuir','apagar_retencao'
  objeto_tipo   text NOT NULL,
  objeto_id     text NOT NULL,
  dados         jsonb NOT NULL DEFAULT '{}',
  ip            inet,
  em            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, em)
) PARTITION BY RANGE (em);
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- Bloquear UPDATE/DELETE à role da app: REVOKE UPDATE, DELETE ON audit_log FROM app;

CREATE TABLE relatorios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  tipo          text NOT NULL CHECK (tipo IN ('semanal','mensal','executivo')),
  periodo       daterange NOT NULL,
  dados         jsonb NOT NULL,
  pdf_key       text,
  gerado_em     timestamptz NOT NULL DEFAULT now(),
  enviado_em    timestamptz
);

CREATE TABLE politicas_retencao (                     -- mostradas em Equipa e acessos · RGPD
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  objeto        text NOT NULL CHECK (objeto IN ('gravacoes','transcricoes','telefones_sem_processo','fotos_ocorrencias')),
  guardar       interval NOT NULL,                    -- 30 dias, 12 meses...
  acao          text NOT NULL CHECK (acao IN ('apagar','anonimizar')),
  PRIMARY KEY (municipio_id, objeto)
);
