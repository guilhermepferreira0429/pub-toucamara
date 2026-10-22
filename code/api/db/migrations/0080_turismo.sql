-- Turistas (V4 #10): conteúdo turístico como fontes oficiais do conhecimento,
-- em várias línguas, com uma entrada própria (/visitar).
--
-- O texto fica nas fontes (versões e trechos, como as outras: editável no
-- painel com "Colar texto" e encontrado pelo procurar_conhecimento). Cada
-- fonte diz a sua língua; as de turismo levam também o tema e, nas de
-- monumentos, os pontos do mapa (coordenadas aproximadas, tempo de visita e
-- acessibilidade, que são valores de demonstração até a câmara confirmar).

ALTER TABLE fontes DROP CONSTRAINT IF EXISTS fontes_tipo_check;
ALTER TABLE fontes ADD CONSTRAINT fontes_tipo_check
  CHECK (tipo IN ('lei','regulamento','tabela','pagina','formulario','plano','contactos','turismo'));

-- Língua do texto da fonte (ISO 639-1). As fontes que já existem são em português.
ALTER TABLE fontes ADD COLUMN lingua text NOT NULL DEFAULT 'pt'
  CHECK (lingua ~ '^[a-z]{2}$');

-- Fonte de demonstração (texto escrito por nós, a confirmar pela câmara).
ALTER TABLE fontes ADD COLUMN demonstracao boolean NOT NULL DEFAULT false;

-- Só nas fontes de turismo: {tema, ordem, pontos: [{chave, nome, categoria,
-- lat, lng, minutos, acessibilidade, interesses}]}.
ALTER TABLE fontes ADD COLUMN turismo jsonb;

CREATE INDEX fontes_turismo_idx ON fontes (municipio_id, lingua) WHERE tipo = 'turismo';
