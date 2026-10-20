-- Avisos por zona: "Corte de água na Rua X amanhã das 9h às 13h" só para
-- quem é afetado (munícipes com uma morada na zona), e avisos de emergência
-- (incêndios, cheias) em massa. SMS com um link para a página pública do
-- aviso, onde a pessoa pode deixar de receber avisos.

-- Opt-out dos avisos por zona (a ferramenta `nao_quero_avisos` ou o "sair"
-- da página do aviso). Os de emergência ignoram-no, por segurança.
ALTER TABLE municipes ADD COLUMN aceita_avisos boolean NOT NULL DEFAULT true;

-- Motivo novo das mensagens: 'aviso' (a lista completa da 0019 + 'aviso').
ALTER TABLE mensagens_saida DROP CONSTRAINT mensagens_saida_motivo_check;
ALTER TABLE mensagens_saida ADD CONSTRAINT mensagens_saida_motivo_check
  CHECK (motivo IN ('fim_chamada','requerimento','ocorrencia','processo','prazo',
    'marcacao','lembrete','recolha','pagamento','reclamacao','relatorio',
    'passagem','identificacao','aviso'));

-- Links curtos para a página do aviso: um por destinatário (o "sair" sabe
-- quem é sem pôr dados pessoais na URL). A lista da 0001 + 'aviso'.
ALTER TABLE links_curtos DROP CONSTRAINT links_curtos_destino_tipo_check;
ALTER TABLE links_curtos ADD CONSTRAINT links_curtos_destino_tipo_check
  CHECK (destino_tipo IN ('resumo','requerimento','ocorrencia','processo','marcacao',
    'pagamento','aviso'));

CREATE TABLE avisos_zona (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id            uuid NOT NULL REFERENCES municipios(id),
  titulo                  text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 120),
  mensagem                text NOT NULL CHECK (length(mensagem) BETWEEN 3 AND 480),
  tipo                    text NOT NULL
                            CHECK (tipo IN ('obras','agua','residuos','transito','emergencia','outro')),
  zona                    jsonb NOT NULL,               -- a pedida: {tipo:'ruas'|'ponto'|'poligono', ...}
  geometria               jsonb NOT NULL,               -- a resolvida: {circulos, poligono, ruas}
  zona_descricao          text NOT NULL,                -- em palavras, para a página pública
  desde                   timestamptz NOT NULL,         -- moradas a partir de quando (12 meses por omissão)
  estado                  text NOT NULL DEFAULT 'rascunho'
                            CHECK (estado IN ('rascunho','agendado','a_enviar','enviado','cancelado')),
  destinatarios_previstos integer NOT NULL DEFAULT 0,   -- na criação (a confirmação recalcula)
  enviar_em               timestamptz,                  -- o pedido; NULL = assim que possível
  agendado_para           timestamptz,                  -- depois da janela horária (9h-21h)
  criado_por              uuid REFERENCES utilizadores(id),
  criado_em               timestamptz NOT NULL DEFAULT now(),
  confirmado_por          uuid REFERENCES utilizadores(id),
  confirmado_em           timestamptz,
  terminado_em            timestamptz,
  cancelado_por           uuid REFERENCES utilizadores(id),
  cancelado_em            timestamptz
);
CREATE INDEX avisos_zona_lista_idx ON avisos_zona (municipio_id, criado_em DESC, id DESC);
CREATE INDEX avisos_zona_por_enviar_idx ON avisos_zona (agendado_para)
  WHERE estado IN ('agendado','a_enviar');

-- Quem recebe: a lista fica fixa na confirmação (o número confirmado).
CREATE TABLE avisos_zona_destinatarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aviso_id       uuid NOT NULL REFERENCES avisos_zona(id) ON DELETE CASCADE,
  municipe_id    uuid NOT NULL REFERENCES municipes(id),
  telefone_e164  text NOT NULL,
  origens        text[] NOT NULL,                     -- {'processo','ocorrencia',...}
  estado         text NOT NULL DEFAULT 'por_enviar'
                   CHECK (estado IN ('por_enviar','enviado','excluido','cancelado')),
  mensagem_id    uuid REFERENCES mensagens_saida(id),
  link_codigo    text REFERENCES links_curtos(codigo),
  UNIQUE (aviso_id, municipe_id)
);
CREATE INDEX avisos_zona_destinatarios_por_enviar_idx ON avisos_zona_destinatarios (aviso_id)
  WHERE estado = 'por_enviar';
CREATE INDEX avisos_zona_destinatarios_mensagem_idx ON avisos_zona_destinatarios (mensagem_id);
