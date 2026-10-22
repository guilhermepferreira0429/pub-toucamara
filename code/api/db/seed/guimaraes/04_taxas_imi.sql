-- Seed de Guimarães · taxas e IMI. Estes documentos só existem em PDF, que a
-- leitura automática não lê: o texto dos trechos foi tirado dos PDFs oficiais a
-- 22 out. 2026 e fica como fonte de leitura manual (leitura_automatica = false),
-- igual a colar o texto no painel. Os vetores calculam-se no ler-fontes.sh.
--
-- PDFs:
--  Tabela de Taxas e Encargos nas Operações Urbanísticas (Anexo I, em vigor desde
--   1/1/2025, Edital 162/2025): .../file/22257/tabela_de_taxas_e_encargos_urbanisticos.pdf
--  Tabela de Taxas e Outras Receitas Municipais 2025/2026 (Edital 597/2025):
--   .../file/22422/rttl_2025___05_02_2025.pdf
--  IMI de 2025, a liquidar e cobrar em 2026: .../file/23624/impostos_2025.pdf
-- Notas: a tabela urbanística não fala de IVA; na RTTL estas taxas não estão sujeitas a IVA.
BEGIN;

INSERT INTO fontes (id, municipio_id, entidade_id, titulo, tipo, url, ler_a_cada,
                    leitura_automatica, ultima_leitura_em, estado) VALUES
 ('f2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Tabela de Taxas e Encargos nas Operações Urbanísticas (2025)','tabela',
  'https://www.cm-guimaraes.pt/cmguimaraes/uploads/document/file/22257/tabela_de_taxas_e_encargos_urbanisticos.pdf',
  '30 days', false, now(), 'em_dia'),
 ('f2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Tabela de Taxas e Outras Receitas Municipais 2025/2026','tabela',
  'https://www.cm-guimaraes.pt/cmguimaraes/uploads/document/file/22422/rttl_2025___05_02_2025.pdf',
  '30 days', false, now(), 'em_dia'),
 ('f2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'IMI de 2025, a liquidar e cobrar em 2026 (taxas aprovadas pelo município)','regulamento',
  'https://www.cm-guimaraes.pt/cmguimaraes/uploads/document/file/23624/impostos_2025.pdf',
  '30 days', false, now(), 'em_dia')
ON CONFLICT (id) DO UPDATE SET
  titulo = EXCLUDED.titulo, tipo = EXCLUDED.tipo, url = EXCLUDED.url,
  leitura_automatica = false, estado = 'em_dia', erro = NULL;

-- Uma versão por fonte. O hash é fixo: mudar o texto aqui = mudar também o hash.
INSERT INTO fonte_versoes (id, fonte_id, hash, texto, vigor_desde) VALUES
 ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','seed-urbanisticas-2025-v1',
  'Tabela de Taxas e Encargos nas Operações Urbanísticas (excertos: comunicação prévia).','2025-01-01'),
 ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002','seed-rttl-2025-v1',
  'Tabela de Taxas e Outras Receitas Municipais 2025/2026 (excertos: ocupação da via pública por obras, esplanadas, cartão de residente).','2025-03-06'),
 ('f3000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000003','seed-imi-2025-v1',
  'IMI de 2025, a liquidar e cobrar em 2026.','2026-01-01')
ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash, texto = EXCLUDED.texto, vigor_desde = EXCLUDED.vigor_desde;

-- Trechos: apagam-se e voltam a pôr-se (os vetores recalculam-se a seguir).
-- Os trechos citados em conversas já guardadas não se apagam.
DELETE FROM trechos t
WHERE t.fonte_versao_id IN ('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000003')
  AND NOT EXISTS (SELECT 1 FROM citacoes c WHERE c.trecho_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM resposta_fontes r WHERE r.trecho_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM tipos_processo tp WHERE tp.base_legal_trecho = t.id)
  AND NOT EXISTS (SELECT 1 FROM contradicoes x WHERE x.trecho_a_id = t.id OR x.trecho_b_id = t.id);

INSERT INTO trechos (id, fonte_versao_id, ordem, referencia, texto, vigor_desde)
SELECT v.id::uuid, v.fv::uuid, v.ordem, v.ref, v.texto, v.desde::date FROM (VALUES
 ('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',1,'Apreciação, 6.1','2025-01-01',
  'Taxa pela apreciação do pedido de admissão de comunicação prévia de obras de edificação: 78,60 euros.'),
 ('f4000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001',2,'Apreciação, 4, 8 e 10','2025-01-01',
  'Pedido de prorrogação: 31,56 euros. Pedidos de alteração à licença ou à comunicação prévia: 50,50 euros. Comunicação prévia para muros, vedações, tapumes e andaimes: 24,14 euros.'),
 ('f4000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000001',3,'Admissão de comunicação prévia, 2.6.8 e 2.6.9','2025-01-01',
  'Na admissão da comunicação prévia: obras de alteração e conservação sujeitas a comunicação prévia, 54,23 euros. Abertura, fecho e modificação de vãos de fachadas (por exemplo abrir uma janela ou uma porta para a rua), 81,04 euros por fachada.'),
 ('f4000000-0000-4000-8000-000000000004','f3000000-0000-4000-8000-000000000001',4,'Admissão de comunicação prévia, 2.1.1 e 2.2.1','2025-01-01',
  'Na admissão da comunicação prévia para habitação: em edificações de utilização coletiva, 0,52 euros por metro quadrado ou fração e por piso; em edificações de utilização não coletiva (moradias), 0,38 euros por metro quadrado ou fração e por piso.'),
 ('f4000000-0000-4000-8000-000000000005','f3000000-0000-4000-8000-000000000001',5,'Admissão de comunicação prévia, 3','2025-01-01',
  'Taxas a somar às anteriores, quando devidas: prazo da obra, 8,28 euros por cada mês ou fração; autenticação do livro de obra, 10,22 euros; por cada unidade de ocupação criada, 6,36 euros.'),
 ('f4000000-0000-4000-8000-000000000011','f3000000-0000-4000-8000-000000000002',1,'Art. 22.º','2025-03-06',
  'Ocupação da via pública por motivo de obras: área delimitada por resguardos ou tapume, até 40 metros quadrados, 1,12 euros por metro quadrado e por semana; por cada metro quadrado a mais, 0,13 euros por semana. Área delimitada por andaimes, 0,56 euros por metro quadrado e por semana. Cargas e descargas de materiais, por veículo: 4,33 euros no primeiro dia e 2,50 euros por cada dia a mais. Não sujeito a IVA.'),
 ('f4000000-0000-4000-8000-000000000012','f3000000-0000-4000-8000-000000000002',2,'Art. 23.º e 24.º','2025-03-06',
  'Gruas, guindastes ou semelhantes a ocupar a via pública: 10,00 euros por dia ou fração. Ocupação com gruas móveis: 9,86 euros por grua e por dia.'),
 ('f4000000-0000-4000-8000-000000000013','f3000000-0000-4000-8000-000000000002',3,'Art. 25.º','2025-03-06',
  'Esplanadas: 15,15 euros por metro quadrado e por ano. No Centro Histórico, na Rua de Santo António, no Toural e na Alameda de São Dâmaso: 18,18 euros por metro quadrado e por ano. Uma esplanada nova paga só os meses que faltam até ao fim do ano. Não sujeito a IVA.'),
 ('f4000000-0000-4000-8000-000000000014','f3000000-0000-4000-8000-000000000002',4,'Art. 28.º','2025-03-06',
  'Cartão de residente: no Centro Histórico, veículo único, 20,00 euros por ano. Fora do Centro Histórico, 35,00 euros por ano para o primeiro veículo e 70,00 euros para o segundo. Segunda via do cartão: 5,00 euros.'),
 ('f4000000-0000-4000-8000-000000000021','f3000000-0000-4000-8000-000000000003',1,'IMI 2025','2026-01-01',
  'IMI de 2025, a liquidar e cobrar em 2026, em Guimarães: taxa de 0,31% para os prédios urbanos. Os prédios degradados têm uma majoração de 30%. A cobrança e as notas de liquidação são das Finanças; a câmara só fixa a taxa.'),
 ('f4000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000003',2,'IMI familiar 2025','2026-01-01',
  'IMI familiar em Guimarães (IMI de 2025, pago em 2026): redução de 70 euros para agregados com 2 dependentes e de 140 euros com 3 ou mais dependentes. Com 1 dependente não há redução. Aprovado pela Câmara a 9 de dezembro de 2025 e pela Assembleia Municipal a 22 de dezembro de 2025.')
) AS v(id, fv, ordem, ref, desde, texto)
ON CONFLICT (id) DO UPDATE SET referencia = EXCLUDED.referencia, texto = EXCLUDED.texto, embedding = NULL;

-- Taxas que o agente simula e cobra (modo de teste). Só as fixas e certas para
-- a comunicação prévia de obras de alteração; as por semana/por mês ficam nos
-- trechos, porque a simulação não tem essas unidades.
INSERT INTO tabelas_taxas (id, municipio_id, ano, vigor_desde, fonte_versao_id) VALUES
 ('f5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',2025,'2025-01-01','f3000000-0000-4000-8000-000000000001'),
 ('f5000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',2025,'2025-03-06','f3000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO UPDATE SET ano = EXCLUDED.ano, vigor_desde = EXCLUDED.vigor_desde, fonte_versao_id = EXCLUDED.fonte_versao_id;

INSERT INTO taxas (id, tabela_id, codigo, descricao, unidade, valor_cent, tipo_processo_id) VALUES
 ('f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','AP-6.1',
  'Apreciação do pedido de comunicação prévia de obras de edificação','fixo',7860,'b1000000-0000-4000-8000-000000000001'),
 ('f6000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000001','CP-2.6.9',
  'Admissão: obras de alteração e conservação sujeitas a comunicação prévia','fixo',5423,'b1000000-0000-4000-8000-000000000001'),
 ('f6000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000002','25-3',
  'Esplanada, por m² e por ano','m2',1515,NULL),
 ('f6000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000002','25-3.2',
  'Esplanada no Centro Histórico, Rua de Santo António, Toural ou Alameda de São Dâmaso, por m² e por ano','m2',1818,NULL)
ON CONFLICT (id) DO UPDATE SET
  codigo = EXCLUDED.codigo, descricao = EXCLUDED.descricao, unidade = EXCLUDED.unidade,
  valor_cent = EXCLUDED.valor_cent, tipo_processo_id = EXCLUDED.tipo_processo_id;

COMMIT;
