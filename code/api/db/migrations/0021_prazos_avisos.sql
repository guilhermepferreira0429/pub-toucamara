-- Prazos de resposta do munícipe e avisos do processo (19 out.).
--
-- Cada pedido do técnico ao munícipe ("precisamos da certidão") passa a ter
-- uma linha própria com a data limite: as consultas (o que falta, o filtro
-- "aguarda munícipe", o job dos lembretes) ficam um SELECT simples em vez de
-- ler o jsonb dos eventos. O evento 'documento_pedido' continua a ser a
-- entrada visível na linha do tempo; o pedido aponta para ele.
CREATE TABLE processo_pedidos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id         uuid NOT NULL REFERENCES processos(id),
  evento_id           bigint NOT NULL UNIQUE REFERENCES processo_eventos(id),
  descricao           text NOT NULL,                  -- 'Certidão do registo predial'
  tipo_documento_id   uuid REFERENCES tipo_processo_documentos(id),  -- NULL = pedido livre
  nota                text,
  pedido_em           timestamptz NOT NULL DEFAULT now(),
  prazo               date NOT NULL,                  -- último dia para o munícipe responder
  lembrete_enviado_em timestamptz,
  criado_por          uuid REFERENCES utilizadores(id)
);
CREATE INDEX processo_pedidos_processo_idx ON processo_pedidos (processo_id, pedido_em);
CREATE INDEX processo_pedidos_lembrete_idx ON processo_pedidos (prazo) WHERE lembrete_enviado_em IS NULL;

-- Quando o pedido foi respondido: o primeiro documento do processo recebido
-- depois do pedido, do tipo pedido (num pedido livre, qualquer um), que não
-- foi rejeitado na verificação. Calculado e não guardado: um documento
-- rejeitado mais tarde volta a deixar o pedido por responder.
CREATE VIEW processo_pedidos_estado AS
SELECT pp.*, r.respondido_em
FROM processo_pedidos pp
LEFT JOIN LATERAL (
  SELECT min(x.recebido_em) AS respondido_em
  FROM documentos x
  WHERE x.processo_id = pp.processo_id
    AND x.recebido_em > pp.pedido_em
    AND x.verificacao_estado NOT IN ('documento_errado', 'ilegivel', 'fora_de_prazo')
    AND (pp.tipo_documento_id IS NULL OR x.tipo_documento_id = pp.tipo_documento_id)
) r ON true;

-- Os pedidos que já existiam: prazo habitual de 10 dias úteis a contar do
-- dia do pedido (sem fins de semana nem feriados). O SMS deles não dizia
-- prazo, por isso não levam lembrete.
INSERT INTO processo_pedidos (processo_id, evento_id, descricao, tipo_documento_id, nota,
  pedido_em, prazo, lembrete_enviado_em, criado_por)
SELECT e.processo_id, e.id, coalesce(e.dados->>'nome', e.descricao),
       (e.dados->>'tipo_documento_id')::uuid, e.dados->>'nota', e.em,
       (SELECT d::date
        FROM generate_series((e.em AT TIME ZONE m.fuso)::date + 1,
                             (e.em AT TIME ZONE m.fuso)::date + 60, interval '1 day') d
        WHERE extract(isodow FROM d) < 6
          AND NOT EXISTS (SELECT 1 FROM feriados f
                          WHERE f.data = d::date
                            AND (f.municipio_id IS NULL OR f.municipio_id = p.municipio_id))
        ORDER BY d OFFSET 9 LIMIT 1),
       now(),
       CASE WHEN e.ator_tipo = 'utilizador' THEN e.ator_id END
FROM processo_eventos e
JOIN processos p ON p.id = e.processo_id
JOIN municipios m ON m.id = p.municipio_id
WHERE e.tipo = 'documento_pedido';
