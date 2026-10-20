-- Seed dos testes ponta a ponta: município 'teste' com o mínimo para todas as
-- superfícies (encaminhamento, conhecimento, requerimentos, taxas, agendas,
-- ocorrências, recolhas, painel). Carregado uma vez por execução (ver app.ts).
BEGIN;
INSERT INTO municipios (id, slug, nome, telefone_linha, email_geral) VALUES
 ('00000000-0000-0000-0000-000000000001','teste','Teste','+351253000000','geral@cm-teste.pt');
INSERT INTO agente_config (municipio_id, saudacao, versao, elevenlabs_agent_id) VALUES
 ('00000000-0000-0000-0000-000000000001','Olá, fala com o Tou, Câmara?','v1','agente-e2e');
INSERT INTO entidades (id, municipio_id, nome, tipo, descricao) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','Câmara Municipal','camara','Câmara'),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000001','Águas do Concelho','empresa_municipal','Água e saneamento'),
 ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-000000000001','Emergência 112','emergencia','Emergências'),
 ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-000000000001','Resíduos do Concelho','empresa_municipal','Recolha de lixo e monos');
INSERT INTO entidade_contactos (id, entidade_id, tipo, rotulo, valor, horario) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','balcao','Balcão Único','Largo X','{"seg-sex":"9:00-17:00"}'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000e2','avarias','Avarias, 24 horas','800 000 000','{"sempre":true}'),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000e3','telefone','Emergência','112','{"sempre":true}');
INSERT INTO regras_encaminhamento (municipio_id, assunto, entidade_id, contacto_id, prioridade) VALUES
 ('00000000-0000-0000-0000-000000000001','Falta de água, roturas, contadores','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000c2',100),
 ('00000000-0000-0000-0000-000000000001','Incêndio, acidente, pessoa ferida','00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000c3',0);
INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','Obras particulares');
INSERT INTO fontes (id, municipio_id, entidade_id, titulo, tipo, url) VALUES
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','RJUE','lei','https://exemplo.pt/rjue');
INSERT INTO fonte_versoes (id, fonte_id, hash, texto) VALUES ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f1','h','x');
INSERT INTO trechos (fonte_versao_id, ordem, referencia, texto) VALUES
 ('00000000-0000-0000-0000-0000000000f2',1,'art. 6.º, n.º 1','Estão isentas de controlo prévio as obras de alteração no interior de edifícios que não impliquem modificações na estrutura de estabilidade, das cérceas, das fachadas e da forma dos telhados.'),
 ('00000000-0000-0000-0000-0000000000f2',2,'art. 4.º, n.º 4','Estão sujeitas a comunicação prévia as obras de alteração exterior, como abrir uma porta ou janela na fachada.');
INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario, frase_do_agente) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','CP','Comunicação prévia · obras de alteração',20,'00000000-0000-0000-0000-0000000000a1',
  '[{"chave":"morada_obra","rotulo":"Morada da obra","tipo":"morada","obrigatorio":true,"pergunta_do_agente":"Qual é a morada da obra?"},
    {"chave":"descricao","rotulo":"Descrição da obra","tipo":"texto","obrigatorio":true,"pergunta_do_agente":"O que vai fazer?"},
    {"chave":"nif","rotulo":"NIF do requerente","tipo":"nif","obrigatorio":true,"pergunta_do_agente":"Qual é o seu NIF?"}]',
  'Vou preencher a comunicação prévia consigo.');
INSERT INTO tipo_processo_documentos (id, tipo_processo_id, nome, ordem) VALUES
 ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000b1','Certidão do registo predial',1),
 ('00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-0000000000b1','Termo de responsabilidade',2);
INSERT INTO categorias_ocorrencia (municipio_id, nome, icone, servico_id) VALUES
 ('00000000-0000-0000-0000-000000000001','Buraco na via','construction','00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-000000000001','Iluminação pública','lamp','00000000-0000-0000-0000-0000000000a1');
INSERT INTO tabelas_taxas (id, municipio_id, ano, vigor_desde, fonte_versao_id) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001',2026,'2026-01-01','00000000-0000-0000-0000-0000000000f2');
INSERT INTO taxas (tabela_id, codigo, descricao, unidade, valor_cent, tipo_processo_id) VALUES
 ('00000000-0000-0000-0000-0000000000d1','CP1','Apreciação do pedido','fixo',4500,'00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-0000000000d1','CP2','Obra, por m²','m2',120,'00000000-0000-0000-0000-0000000000b1');
INSERT INTO agendas (id, municipio_id, servico_id, nome, local, horario) VALUES
 ('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Balcão Único · Licenciamento','Largo X',
  '{"seg":["09:00-16:00"],"ter":["09:00-16:00"],"qua":["09:00-16:00"],"qui":["09:00-16:00"],"sex":["09:00-16:00"]}');
INSERT INTO utilizadores (id, municipio_id, email, nome, perfil) VALUES
 ('00000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-000000000001','chefe@teste.pt','Chefe Teste','chefe_divisao');
COMMIT;
