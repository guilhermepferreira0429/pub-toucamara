-- Fiscalização (V3 · FUN §13, ponto 3; "Relatório de vistoria ditado por voz").
--
-- Visitas de fiscalização criadas a partir de uma ocorrência, de um processo
-- (vistoria para licença de utilização) ou à mão; planeadas por dia e por
-- fiscal; o fiscal dita o relatório no terreno (texto do ditado do
-- telemóvel ou áudio transcrito) e, ao fechar, a ocorrência ou o processo
-- são atualizados e, havendo infrações, fica marcada uma nova visita para
-- depois do prazo de correção.
--
-- A configuração do planeamento (ponto de partida, velocidade média,
-- duração por tipo, prazo por omissão) fica em municipios.fiscalizacao_config;
-- sem ela o código usa valores de demonstração, marcados como tal.

ALTER TABLE municipios ADD COLUMN IF NOT EXISTS fiscalizacao_config jsonb;

CREATE TABLE fiscalizacao_visitas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id         uuid NOT NULL REFERENCES municipios(id),
  numero               text NOT NULL,                       -- 'FIS 12/2026'
  tipo                 text NOT NULL CHECK (tipo IN ('ocorrencia','vistoria_utilizacao','obra','ocupacao_via','reinspecao','outra')),
  origem               text NOT NULL CHECK (origem IN ('ocorrencia','processo','manual','reinspecao')),
  ocorrencia_id        uuid REFERENCES ocorrencias(id),
  processo_id          uuid REFERENCES processos(id),
  visita_anterior_id   uuid REFERENCES fiscalizacao_visitas(id),  -- nova visita por infração
  estado               text NOT NULL DEFAULT 'por_agendar'
                       CHECK (estado IN ('por_agendar','agendada','feita','cancelada')),
  fiscal_id            uuid REFERENCES utilizadores(id),
  dia                  date,
  janela_inicio        time,                                -- marcada com o requerente
  janela_fim           time,
  morada               text NOT NULL,
  lat double precision, lng double precision,
  motivo               text NOT NULL,
  -- [{chave, rotulo, conforme_se, artigo, resposta, nota}]
  checklist            jsonb NOT NULL DEFAULT '[]',
  prazo_correcao       date,                                -- nova visita: até quando havia para corrigir
  feita_em             timestamptz,
  cancelada_em         timestamptz,
  motivo_cancelamento  text,
  criada_por           uuid REFERENCES utilizadores(id),
  criada_em            timestamptz NOT NULL DEFAULT now(),
  atualizada_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipio_id, numero),
  CHECK (janela_inicio IS NULL OR janela_fim IS NULL OR janela_inicio < janela_fim),
  CHECK (estado <> 'agendada' OR dia IS NOT NULL),
  CHECK (origem <> 'ocorrencia' OR ocorrencia_id IS NOT NULL),
  CHECK (origem <> 'processo' OR processo_id IS NOT NULL),
  CHECK (origem <> 'reinspecao' OR visita_anterior_id IS NOT NULL)
);
CREATE INDEX fiscalizacao_visitas_lista_idx ON fiscalizacao_visitas (municipio_id, estado, criada_em DESC);
CREATE INDEX fiscalizacao_visitas_dia_idx ON fiscalizacao_visitas (municipio_id, dia, fiscal_id)
  WHERE estado = 'agendada';
CREATE INDEX fiscalizacao_visitas_processo_idx ON fiscalizacao_visitas (processo_id)
  WHERE processo_id IS NOT NULL;
-- Uma visita aberta de cada vez por ocorrência.
CREATE UNIQUE INDEX fiscalizacao_visitas_ocorrencia_aberta_uq ON fiscalizacao_visitas (ocorrencia_id)
  WHERE ocorrencia_id IS NOT NULL AND estado IN ('por_agendar','agendada');

-- O relatório da visita (um por visita). Fica em rascunho até o fiscal o
-- fechar; depois de fechado não se altera.
CREATE TABLE fiscalizacao_relatorios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id     uuid NOT NULL REFERENCES municipios(id),
  visita_id        uuid NOT NULL UNIQUE REFERENCES fiscalizacao_visitas(id),
  fonte            text NOT NULL CHECK (fonte IN ('texto','audio')),
  audio_key        text,                                     -- S3
  audio_mime       text,
  transcricao      text,                                     -- o que o fiscal ditou
  transcrito_por   text CHECK (transcrito_por IN ('dispositivo','elevenlabs')),
  -- {resumo, constatacoes[], infracoes[{descricao, artigo}], medidas[],
  --  prazo_dias, prazo_data, fotos_referidas[], conclusao, livre}
  estruturado      jsonb,
  estruturado_por  text CHECK (estruturado_por IN ('ia','manual')),
  conclusao        text CHECK (conclusao IN ('conforme','com_infracoes','inconclusivo')),
  prazo_correcao   date,
  fechado_em       timestamptz,
  autor_id         uuid REFERENCES utilizadores(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CHECK (fonte <> 'audio' OR audio_key IS NOT NULL)
);

CREATE TABLE fiscalizacao_fotos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  uuid NOT NULL REFERENCES municipios(id),
  visita_id     uuid NOT NULL REFERENCES fiscalizacao_visitas(id),
  ficheiro_key  text NOT NULL,
  mime          text NOT NULL,
  legenda       text,
  criada_por    uuid REFERENCES utilizadores(id),
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fiscalizacao_fotos_visita_idx ON fiscalizacao_fotos (visita_id, criada_em);
-- O RLS do painel (municipio_id) aplica-se sozinho depois das migrações (0046).
