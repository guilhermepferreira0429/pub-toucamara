-- Ocorrências: índices para os duplicados e para o "como está a minha?".

-- Contagem de duplicados por original (pins do mapa, detalhe, SMS de resolvida).
CREATE INDEX ocorrencias_duplicada_de_idx ON ocorrencias (duplicada_de)
  WHERE duplicada_de IS NOT NULL;

-- estado_ocorrencia sem número: as últimas reportadas por este munícipe.
CREATE INDEX ocorrencias_municipe_idx ON ocorrencias (municipe_id, criada_em DESC)
  WHERE municipe_id IS NOT NULL;

-- Deteção de duplicados: mesma categoria, recentes.
CREATE INDEX ocorrencias_categoria_recentes_idx ON ocorrencias (municipio_id, categoria_id, criada_em DESC)
  WHERE duplicada_de IS NULL;

CREATE INDEX ocorrencia_fotos_ocorrencia_idx ON ocorrencia_fotos (ocorrencia_id);
CREATE INDEX ocorrencia_eventos_ocorrencia_idx ON ocorrencia_eventos (ocorrencia_id, em);
