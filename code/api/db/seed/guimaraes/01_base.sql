-- Seed de Guimarães · base (docs/PLANS/api-e-modelo-de-dados.md, secções 10 e 11).
-- O que é de cada câmara está nos dados: município, entidades do concelho,
-- contactos, "quem trata de quê", serviços, temas, tipos de processo,
-- agendas, categorias de ocorrência, feriados e a configuração do agente.
--
-- Contactos verificados nos sites oficiais a 22 out. 2026 (fonte ao lado de
-- cada um). Sem horário publicado fica horario = NULL: o agente não afirma
-- que está aberto.
--
-- Idempotente: ids fixos e ON CONFLICT ... DO UPDATE. Correr outra vez
-- atualiza os valores sem duplicar nada. Não mexe em dados do dia a dia
-- (conversas, processos, ocorrências...).
--
-- Ids: a1 município · e* entidades · c* contactos · 5* serviços · 7* temas
--      b* tipos de processo · d* documentos · 9* agendas · 8* categorias
--      f* fontes · 6* utilizadores. Tudo hex (uuid).

BEGIN;

-- ======================================================================
-- Município
-- ======================================================================
INSERT INTO municipios (id, slug, nome, fuso, telefone_linha, email_geral)
VALUES ('a1000000-0000-4000-8000-000000000001', 'guimaraes', 'Guimarães',
        'Europe/Lisbon', NULL, 'geral@cm-guimaraes.pt')
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug, nome = EXCLUDED.nome, fuso = EXCLUDED.fuso,
  email_geral = EXCLUDED.email_geral;
-- telefone_linha fica para quando houver o número nacional (Zadarma).

-- ======================================================================
-- Agente (o nome e a saudação do chat; a voz está no ElevenLabs)
-- chamadas_saida NÃO é tocada aqui: liga-se com saida-2-ligar.sh.
-- ======================================================================
-- A saudação serve o chat e a voz (na voz junta-se o aviso de gravação antes do "Em que posso ajudar?").
INSERT INTO agente_config (municipio_id, nome, saudacao, trata_por, idiomas, versao, elevenlabs_agent_id, ritmo)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Patrício Brito',
        'Olá, sou o Patrício Brito, assistente automático da Câmara de Guimarães. Em que posso ajudar?',
        'você', '{pt-PT,en,es,fr}', 'v1', 'agent_3701m5fr6907fjk9qe1v5qpxmnpd', 'rapido')
ON CONFLICT (municipio_id) DO UPDATE SET
  nome = EXCLUDED.nome, saudacao = EXCLUDED.saudacao, trata_por = EXCLUDED.trata_por, ritmo = EXCLUDED.ritmo,
  idiomas = EXCLUDED.idiomas, elevenlabs_agent_id = EXCLUDED.elevenlabs_agent_id;

-- ======================================================================
-- Entidades do concelho
-- ======================================================================
INSERT INTO entidades (id, municipio_id, nome, tipo, descricao, site_url) VALUES
 ('e1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'Câmara Municipal de Guimarães','camara',
  'Câmara Municipal: obras particulares e urbanismo, licenças de atividade e de ocupação do espaço público, taxas municipais, trânsito e Polícia Municipal, Proteção Civil, ação social, educação, cultura e cemitérios.',
  'https://www.cm-guimaraes.pt'),
 ('e1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
  'Vimágua','empresa_municipal',
  'Água e saneamento de Guimarães e Vizela: faltas de água, roturas e fugas, derrames de esgoto, contratos e mudança de titular, faturas, leituras do contador, tarifário social, ligação ao saneamento.',
  'https://www.vimagua.pt'),
 ('e1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001',
  'Vitrus Ambiente','empresa_municipal',
  'Resíduos e limpeza urbana: recolha do lixo, recolha de monstros (monos, móveis e eletrodomésticos velhos), contentores e limpeza das ruas. Também fiscaliza o estacionamento tarifado e gere os parques de estacionamento.',
  'https://vitrusambiente.pt'),
 ('e1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001',
  'Tempo Livre','empresa_municipal',
  'Desporto e lazer: piscinas e pavilhões municipais, atividades desportivas.',
  'https://www.tempolivre.pt'),
 ('e1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001',
  'CASFIG','empresa_municipal',
  'Habitação social municipal: candidaturas a habitação, rendas e manutenção dos bairros municipais.',
  'https://www.casfig.pt'),
 ('e1000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001',
  'Emergência 112','emergencia',
  'Emergências: incêndio, fumo numa casa, acidente, pessoa ferida, inconsciente ou em perigo.',
  NULL),
 ('e1000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000001',
  'Autoridade Tributária (Finanças)','nacional',
  'IMI e outros impostos: a câmara fixa a taxa do IMI, mas a cobrança, as notas de liquidação e as isenções são das Finanças.',
  'https://www.portaldasfinancas.gov.pt'),
 ('e1000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001',
  'SNS 24','nacional',
  'Saúde: dúvidas de saúde, centros de saúde, aconselhamento e encaminhamento clínico.',
  'https://www.sns24.gov.pt'),
 ('e1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001',
  'Espaço Cidadão de Guimarães','nacional',
  'Serviços do Estado no Balcão Único da câmara: renovar o Cartão de Cidadão, alterar a morada, e outros serviços públicos (Segurança Social, Finanças, carta de condução).',
  'https://www.gov.pt/locais-de-atendimento/espaco-cidadao-de-guimaraes'),
 ('e1000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001',
  'Junta de Freguesia','junta',
  'A junta de freguesia da morada: atestados de residência e de composição do agregado familiar, recenseamento eleitoral, pequenos arranjos na freguesia.',
  NULL)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, tipo = EXCLUDED.tipo, descricao = EXCLUDED.descricao,
  site_url = EXCLUDED.site_url, ativo = true;

-- ======================================================================
-- Contactos
-- ======================================================================
INSERT INTO entidade_contactos (id, entidade_id, tipo, rotulo, valor, horario) VALUES
 -- Câmara · https://www.cm-guimaraes.pt/ficha-tecnica/declaracao-de-acessibilidade-e-usabilidade/contactos-da-autarquia
 --         · https://www.cm-guimaraes.pt/balcao-virtual/horarios-de-atendimento/poi-92/balcao-unico-de-atendimento
 ('c1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','balcao',
  'Balcão Único de Atendimento (senhas até às 16h45; marcação pelo 253 421 200 ou geral@cm-guimaraes.pt)',
  'Largo Cónego José Maria Gomes, 4804-534 Guimarães','{"seg-sex":"9:00-17:00"}'),
 ('c1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','telefone',
  'Geral','253 421 200','{"seg-sex":"9:00-17:00"}'),
 ('c1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','email',
  'Geral','geral@cm-guimaraes.pt',NULL),
 ('c1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000001','telefone',
  'Polícia Municipal','253 421 222','{"seg-sex":"9:00-12:30,14:00-17:30"}'),
 ('c1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000001','telefone',
  'Proteção Civil','253 421 212',NULL),
 ('c1000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000001','telefone',
  'Ação Social','253 421 255',NULL),
 ('c1000000-0000-4000-8000-000000000007','e1000000-0000-4000-8000-000000000001','telefone',
  'Serviços Urbanos e Ambiente','253 421 210',NULL),
 ('c1000000-0000-4000-8000-000000000008','e1000000-0000-4000-8000-000000000001','telefone',
  'Divisão de Fiscalização (obras e ocupações sem licença)','253 421 290',NULL),
 ('c1000000-0000-4000-8000-000000000009','e1000000-0000-4000-8000-000000000001','telefone',
  'Obras Municipais (vias e obras da câmara)','253 421 240',NULL),
 ('c1000000-0000-4000-8000-00000000000a','e1000000-0000-4000-8000-000000000001','site',
  'Registar uma ocorrência online','https://www.cm-guimaraes.pt/registar-ocorrencias',NULL),
 -- https://www.cm-guimaraes.pt/balcao-virtual/horarios-de-atendimento/poi-92/atendimento-tecnico-do-urbanismo
 ('c1000000-0000-4000-8000-00000000000b','e1000000-0000-4000-8000-000000000001','email',
  'Urbanismo e obras particulares','urbanismo@cm-guimaraes.pt',NULL),
 ('c1000000-0000-4000-8000-00000000000c','e1000000-0000-4000-8000-000000000001','email',
  'Urbanismo digital: submeter processos de obras online','urbanismodigital@cm-guimaraes.pt',NULL),
 ('c1000000-0000-4000-8000-00000000000d','e1000000-0000-4000-8000-000000000001','telefone',
  'Atendimento telefónico dos gestores de procedimento do urbanismo','253 421 200',
  '{"seg":"14:30-16:00","qua":"14:30-16:30","sex":"10:00-12:00"}'),
 -- https://www.cm-guimaraes.pt/areas-de-intervencao/ambiente-e-sustentabilidade/ambiente/bem-estar-animal/centro-de-recolha-oficial-de-animais-de-companhia
 ('c1000000-0000-4000-8000-00000000000e','e1000000-0000-4000-8000-000000000001','telefone',
  'Centro de Recolha Oficial de Animais (canil e gatil municipal), em Aldão junto ao ecocentro','253 421 232',
  '{"seg-sex":"9:30-12:00,14:00-15:30","sab":"9:30-11:30"}'),
 ('c1000000-0000-4000-8000-00000000000f','e1000000-0000-4000-8000-000000000001','email',
  'Centro de Recolha Oficial de Animais','cro@cm-guimaraes.pt',NULL),
 -- https://www.cm-guimaraes.pt/.../gestao-de-residuos/residuos-volumosos
 ('c1000000-0000-4000-8000-000000000010','e1000000-0000-4000-8000-000000000001','telefone',
  'Recolha de monstros nas zonas da câmara (Serviços Urbanos)','253 421 210',NULL),
 -- Vimágua · https://www.vimagua.pt/s/50
 ('c1000000-0000-4000-8000-000000000021','e1000000-0000-4000-8000-000000000002','avarias',
  'Faltas de água e falta de pressão, 24 horas (escolher a opção 3)','253 439 560','{"sempre":true}'),
 ('c1000000-0000-4000-8000-000000000022','e1000000-0000-4000-8000-000000000002','avarias',
  'Linha Ambiente, grátis: fugas de água e derrames de esgoto','800 910 410',NULL),
 ('c1000000-0000-4000-8000-000000000023','e1000000-0000-4000-8000-000000000002','telefone',
  'Geral: contratos, faturas, ligações e ramais','253 439 560','{"seg-sex":"9:00-16:00"}'),
 ('c1000000-0000-4000-8000-000000000024','e1000000-0000-4000-8000-000000000002','telefone',
  'Comunicação de leituras do contador, grátis','800 500 149',NULL),
 ('c1000000-0000-4000-8000-000000000025','e1000000-0000-4000-8000-000000000002','balcao',
  'Loja da Vimágua em Guimarães','Rua do Rei Pegú, 172, 4810-025 Guimarães','{"seg-sex":"9:00-16:00"}'),
 ('c1000000-0000-4000-8000-000000000026','e1000000-0000-4000-8000-000000000002','email',
  'Geral','vimagua@vimagua.pt',NULL),
 -- Vitrus Ambiente · https://vitrusambiente.pt/monstros
 ('c1000000-0000-4000-8000-000000000031','e1000000-0000-4000-8000-000000000003','telefone',
  'Número verde, grátis: recolha de monstros e do lixo','800 209 565',NULL),
 ('c1000000-0000-4000-8000-000000000032','e1000000-0000-4000-8000-000000000003','email',
  'Geral','geral@vitrusambiente.pt',NULL),
 -- Ecocentros (geridos pela RESINORTE; a câmara publica-os) · https://www.cm-guimaraes.pt/.../gestao-de-residuos/ecocentros
 ('c1000000-0000-4000-8000-000000000033','e1000000-0000-4000-8000-000000000001','morada',
  'Ecocentro de Aldão (RESINORTE)','Atães, 4800-016 Guimarães',
  '{"seg,ter,qui,sex":"9:30-13:00,14:00-18:30","qua":"14:00-18:30","sab":"9:30-13:00","dom":"fechado"}'),
 ('c1000000-0000-4000-8000-000000000034','e1000000-0000-4000-8000-000000000001','morada',
  'Ecocentro de Riba de Ave, em Guardizela (RESINORTE)','4765-403 Guimarães',
  '{"ter-sab":"9:30-13:00,14:00-18:30","dom":"fechado","seg":"fechado"}'),
 ('c1000000-0000-4000-8000-000000000035','e1000000-0000-4000-8000-000000000001','morada',
  'Ecocentro de Ponte (RESINORTE)','Parque Industrial de Ponte, 4805-662 Guimarães',
  '{"seg,ter,qui,sex":"9:30-13:00,14:00-18:30","qua":"14:00-18:30","sab":"9:30-13:00","dom":"fechado"}'),
 ('c1000000-0000-4000-8000-000000000036','e1000000-0000-4000-8000-000000000003','morada',
  'Sede','Av. Cónego Gaspar Estaço, 606, Oliveira do Castelo, 4810-266 Guimarães',NULL),
 ('c1000000-0000-4000-8000-000000000037','e1000000-0000-4000-8000-000000000003','telefone',
  'Pagamento de avisos de estacionamento, presencial na sede','800 209 565','{"seg-sex":"9:00-17:30"}'),
 -- Tempo Livre · https://tempolivre.pt/contactos/
 ('c1000000-0000-4000-8000-000000000041','e1000000-0000-4000-8000-000000000004','telefone',
  'Geral (Multiusos de Guimarães)','253 520 300','{"seg-sex":"9:00-20:00"}'),
 ('c1000000-0000-4000-8000-000000000042','e1000000-0000-4000-8000-000000000004','telefone',
  'Complexo Municipal de Piscinas','253 423 200','{"seg-sex":"7:30-22:00","sab":"7:30-18:00","dom":"8:00-13:00"}'),
 ('c1000000-0000-4000-8000-000000000043','e1000000-0000-4000-8000-000000000004','email',
  'Geral','geral@tempolivre.pt',NULL),
 -- CASFIG · https://www.casfig.pt/contactos/
 ('c1000000-0000-4000-8000-000000000051','e1000000-0000-4000-8000-000000000005','telefone',
  'Geral','253 519 881',NULL),
 ('c1000000-0000-4000-8000-000000000052','e1000000-0000-4000-8000-000000000005','email',
  'Geral','geral@casfig.pt',NULL),
 ('c1000000-0000-4000-8000-000000000053','e1000000-0000-4000-8000-000000000005','morada',
  'Sede','Rua Capitão Alfredo Guimarães, 354, 4810-019 Guimarães',NULL),
 -- Espaço Cidadão · https://www.gov.pt/locais-de-atendimento/espaco-cidadao-de-guimaraes
 ('c1000000-0000-4000-8000-000000000091','e1000000-0000-4000-8000-000000000009','balcao',
  'Espaço Cidadão no Balcão Único da câmara (senhas até às 16h45; marcação pelo 253 421 200)',
  'Largo Cónego José Maria Gomes, 4804-534 Guimarães','{"seg-sex":"9:00-17:00"}'),
 ('c1000000-0000-4000-8000-000000000092','e1000000-0000-4000-8000-000000000009','telefone',
  'Linha dos Espaços Cidadão','300 003 990',NULL),
 -- 112
 ('c1000000-0000-4000-8000-000000000061','e1000000-0000-4000-8000-000000000006','telefone',
  'Emergência','112','{"sempre":true}'),
 -- SNS 24
 ('c1000000-0000-4000-8000-000000000081','e1000000-0000-4000-8000-000000000008','telefone',
  'Linha SNS 24','808 24 24 24','{"sempre":true}')
ON CONFLICT (id) DO UPDATE SET
  entidade_id = EXCLUDED.entidade_id, tipo = EXCLUDED.tipo, rotulo = EXCLUDED.rotulo,
  valor = EXCLUDED.valor, horario = EXCLUDED.horario;

-- ======================================================================
-- Quem trata de quê (a menor prioridade ganha; 112 = 0)
-- ======================================================================
INSERT INTO regras_encaminhamento (id, municipio_id, assunto, entidade_id, contacto_id, passa_a_pessoa, prioridade) VALUES
 ('4e000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'Incêndio, fumo numa casa, acidente, pessoa ferida, inconsciente ou em perigo',
  'e1000000-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000061',NULL,0),
 ('4e000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
  'Falta de água em casa, falta de pressão',
  'e1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000021',NULL,10),
 ('4e000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001',
  'Rotura ou fuga de água na rua, derrame de esgoto, tampa de saneamento',
  'e1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000022',NULL,10),
 ('4e000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001',
  'Contrato de água, mudança de titular, fatura da água, tarifário social, ligação ao saneamento, fossas',
  'e1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000023',NULL,50),
 ('4e000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001',
  'Leitura do contador da água',
  'e1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000024',NULL,50),
 ('4e000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001',
  'Recolha de monstros: monos, sofás, colchões, móveis e eletrodomésticos velhos (volumosos)',
  'e1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000031',
  'a recolha é grátis; em algumas zonas é feita pela câmara (Serviços Urbanos, 253 421 210) e não pela Vitrus: o mapa está na página dos resíduos volumosos',20),
 ('4e000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000001',
  'Lixo por recolher, contentor cheio ou partido, limpeza da rua',
  'e1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000031',NULL,30),
 ('4e000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001',
  'Obras sem licença, construção ilegal, ocupação da via pública sem licença',
  'e1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000008',NULL,60),
 ('4e000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001',
  'Estacionamento abusivo, carro abandonado na rua, trânsito',
  'e1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004',NULL,60),
 ('4e000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000001',
  'Aviso de pagamento de estacionamento, parquímetros, parques de estacionamento',
  'e1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000037',
  'a autorização de estacionamento de residente pede-se à câmara, nos Serviços Online',60),
 ('4e000000-0000-4000-8000-000000000013','a1000000-0000-4000-8000-000000000001',
  'Animal abandonado ou perdido, canil, adoção de cães e gatos',
  'e1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-00000000000e',NULL,60),
 ('4e000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001',
  'Árvore caída, muro ou casa em risco de cair, cheias (sem pessoas em perigo)',
  'e1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000005',
  'se houver pessoas em perigo, é o 112',40),
 ('4e000000-0000-4000-8000-00000000000b','a1000000-0000-4000-8000-000000000001',
  'Apoio social, carência económica, pessoas idosas sozinhas',
  'e1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000006',NULL,70),
 ('4e000000-0000-4000-8000-00000000000c','a1000000-0000-4000-8000-000000000001',
  'Habitação social, casas da câmara, rendas dos bairros municipais',
  'e1000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000051',NULL,70),
 ('4e000000-0000-4000-8000-00000000000d','a1000000-0000-4000-8000-000000000001',
  'Piscinas e pavilhões municipais, inscrições em atividades desportivas',
  'e1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000041',NULL,80),
 ('4e000000-0000-4000-8000-00000000000e','a1000000-0000-4000-8000-000000000001',
  'Pagar o IMI, nota de cobrança do IMI, isenção de IMI',
  'e1000000-0000-4000-8000-000000000007',NULL,NULL,80),
 ('4e000000-0000-4000-8000-00000000000f','a1000000-0000-4000-8000-000000000001',
  'Cartão de Cidadão (renovar, alterar morada), serviços do Estado',
  'e1000000-0000-4000-8000-000000000009','c1000000-0000-4000-8000-000000000091',NULL,80),
 ('4e000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000001',
  'Saúde, médico, centro de saúde, sintomas',
  'e1000000-0000-4000-8000-000000000008','c1000000-0000-4000-8000-000000000081',
  'se for grave ou urgente, é o 112',80),
 ('4e000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000001',
  'Atestado de residência, atestado de agregado familiar, recenseamento eleitoral',
  'e1000000-0000-4000-8000-00000000000a',NULL,NULL,90)
ON CONFLICT (id) DO UPDATE SET
  assunto = EXCLUDED.assunto, entidade_id = EXCLUDED.entidade_id, contacto_id = EXCLUDED.contacto_id,
  passa_a_pessoa = EXCLUDED.passa_a_pessoa, prioridade = EXCLUDED.prioridade, ativo = true;

-- ======================================================================
-- Serviços (para onde vão processos, ocorrências e marcações)
-- ======================================================================
INSERT INTO servicos (id, municipio_id, entidade_id, nome, email, telefone) VALUES
 ('50000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Obras particulares e licenciamento',NULL,'253 421 200'),
 ('50000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Ocupação do espaço público e licenças de atividade',NULL,'253 421 200'),
 ('50000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Obras municipais: vias e pavimentos',NULL,'253 421 240'),
 ('50000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Serviços Urbanos e Ambiente',NULL,'253 421 210'),
 ('50000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Polícia Municipal',NULL,'253 421 222'),
 ('50000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Divisão de Fiscalização',NULL,'253 421 290'),
 ('50000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Ação Social',NULL,'253 421 255'),
 ('50000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
  'Balcão Único de Atendimento','geral@cm-guimaraes.pt','253 421 200'),
 ('50000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003',
  'Recolha de resíduos e limpeza urbana','geral@vitrusambiente.pt','800 209 565'),
 ('50000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
  'Redes de água e saneamento','vimagua@vimagua.pt','800 910 410')
ON CONFLICT (id) DO UPDATE SET
  entidade_id = EXCLUDED.entidade_id, nome = EXCLUDED.nome,
  email = EXCLUDED.email, telefone = EXCLUDED.telefone;

-- ======================================================================
-- Temas (as áreas da lista de perguntas de teste)
-- ======================================================================
INSERT INTO temas (id, municipio_id, nome) VALUES
 ('70000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Obras e urbanismo'),
 ('70000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Licenças de atividade, comércio e espaço público'),
 ('70000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','Taxas e pagamentos'),
 ('70000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','Lixo, ambiente e limpeza'),
 ('70000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001','Água e saneamento'),
 ('70000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001','Trânsito e estacionamento'),
 ('70000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000001','Educação e ação social'),
 ('70000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001','Cultura, desporto e eventos'),
 ('70000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001','Atendimento, documentos e contactos'),
 ('70000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001','Animais, cemitérios e habitação'),
 ('70000000-0000-4000-8000-00000000000b','a1000000-0000-4000-8000-000000000001','Ocorrências na via pública'),
 ('70000000-0000-4000-8000-00000000000c','a1000000-0000-4000-8000-000000000001','Emergências')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome;

-- ======================================================================
-- Tipos de processo
-- ======================================================================
INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario, frase_do_agente) VALUES
 ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','CP',
  'Comunicação prévia · obras de alteração',20,'50000000-0000-4000-8000-000000000001',
  '[{"chave":"nome","rotulo":"Nome do requerente","tipo":"texto","obrigatorio":true,"pergunta_do_agente":"Qual é o seu nome completo?"},
    {"chave":"nif","rotulo":"NIF do requerente","tipo":"nif","obrigatorio":true,"pergunta_do_agente":"Qual é o seu NIF?"},
    {"chave":"qualidade","rotulo":"Qualidade do requerente","tipo":"escolha","obrigatorio":true,"opcoes":["proprietário","arrendatário","outra"],"pergunta_do_agente":"É o proprietário da casa?"},
    {"chave":"morada_obra","rotulo":"Morada da obra","tipo":"morada","obrigatorio":true,"pergunta_do_agente":"Qual é a morada da obra, com rua e número?"},
    {"chave":"freguesia","rotulo":"Freguesia","tipo":"texto","obrigatorio":false,"pergunta_do_agente":"Em que freguesia fica?"},
    {"chave":"descricao","rotulo":"Descrição da obra","tipo":"texto","obrigatorio":true,"pergunta_do_agente":"O que vai fazer, exatamente?"},
    {"chave":"area_m2","rotulo":"Área da obra (m²)","tipo":"numero","obrigatorio":false,"pergunta_do_agente":"Mais ou menos quantos metros quadrados tem a obra?"},
    {"chave":"centro_historico","rotulo":"Fica no centro histórico","tipo":"sim_nao","obrigatorio":true,"pergunta_do_agente":"A casa fica no centro histórico?"}]',
  'Vou preencher a comunicação prévia consigo, agora mesmo. No fim mando-lhe por SMS o link para rever e a lista dos documentos que faltam.'),
 ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','OV',
  'Ocupação da via pública · andaime, tapume ou contentor de obra',10,'50000000-0000-4000-8000-000000000002',
  '[{"chave":"nome","rotulo":"Nome do requerente","tipo":"texto","obrigatorio":true,"pergunta_do_agente":"Qual é o seu nome completo?"},
    {"chave":"nif","rotulo":"NIF do requerente","tipo":"nif","obrigatorio":true,"pergunta_do_agente":"Qual é o seu NIF?"},
    {"chave":"morada","rotulo":"Morada da ocupação","tipo":"morada","obrigatorio":true,"pergunta_do_agente":"Em que rua e número vai ficar?"},
    {"chave":"o_que","rotulo":"O que ocupa a via","tipo":"escolha","obrigatorio":true,"opcoes":["andaime","tapume","contentor de obra","grua","outro"],"pergunta_do_agente":"É um andaime, um tapume ou um contentor?"},
    {"chave":"area_m2","rotulo":"Área ocupada (m²)","tipo":"numero","obrigatorio":true,"pergunta_do_agente":"Quantos metros quadrados de passeio ou rua vai ocupar?"},
    {"chave":"data_inicio","rotulo":"Data de início","tipo":"data","obrigatorio":true,"pergunta_do_agente":"Em que dia começa?"},
    {"chave":"dias","rotulo":"Duração (dias)","tipo":"numero","obrigatorio":true,"pergunta_do_agente":"Durante quantos dias?"}]',
  'Vou preencher o pedido de ocupação da via pública consigo.')
ON CONFLICT (id) DO UPDATE SET
  codigo = EXCLUDED.codigo, nome = EXCLUDED.nome, prazo_dias_uteis = EXCLUDED.prazo_dias_uteis,
  servico_id = EXCLUDED.servico_id, formulario = EXCLUDED.formulario,
  frase_do_agente = EXCLUDED.frase_do_agente, ativo = true;

INSERT INTO tipo_processo_documentos (id, tipo_processo_id, nome, obrigatorio, ordem, verificacoes, gerado_pelo_sistema) VALUES
 ('d1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  'Certidão permanente do registo predial',true,1,'[{"tipo":"validade","meses":6}]',false),
 ('d1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001',
  'Planta de localização',true,2,'[]',true),
 ('d1000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001',
  'Fotografias do local',true,3,'[]',false),
 ('d1000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001',
  'Memória descritiva e projeto de arquitetura',true,4,'[]',false),
 ('d1000000-0000-4000-8000-000000000005','b1000000-0000-4000-8000-000000000001',
  'Termo de responsabilidade do técnico autor do projeto',true,5,'[{"tipo":"assinatura"}]',false),
 ('d1000000-0000-4000-8000-000000000011','b1000000-0000-4000-8000-000000000002',
  'Planta de localização com a área a ocupar assinalada',true,1,'[]',false),
 ('d1000000-0000-4000-8000-000000000012','b1000000-0000-4000-8000-000000000002',
  'Seguro de responsabilidade civil da obra',true,2,'[{"tipo":"validade","meses":12}]',false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, obrigatorio = EXCLUDED.obrigatorio, ordem = EXCLUDED.ordem,
  verificacoes = EXCLUDED.verificacoes, gerado_pelo_sistema = EXCLUDED.gerado_pelo_sistema;

-- ======================================================================
-- Agendas (marcações no balcão)
-- ======================================================================
INSERT INTO agendas (id, municipio_id, servico_id, nome, local, duracao_slot, horario) VALUES
 ('90000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000008',
  'Balcão Único · atendimento geral','Largo Cónego José Maria Gomes, Guimarães','30 minutes',
  '{"seg":["09:00-16:30"],"ter":["09:00-16:30"],"qua":["09:00-16:30"],"qui":["09:00-16:30"],"sex":["09:00-16:30"]}'),
 ('90000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
  'Balcão Único · atendimento técnico do urbanismo','Largo Cónego José Maria Gomes, Guimarães','30 minutes',
  -- Horário publicado (com marcação prévia à 2.ª e à 4.ª; 6.ª sem marcação, mas fica aqui para o agente marcar).
  '{"seg":["09:30-11:30","14:30-16:30"],"qua":["14:30-16:30"],"sex":["10:00-12:00"]}')
ON CONFLICT (id) DO UPDATE SET
  servico_id = EXCLUDED.servico_id, nome = EXCLUDED.nome, local = EXCLUDED.local,
  duracao_slot = EXCLUDED.duracao_slot, horario = EXCLUDED.horario;

-- ======================================================================
-- Categorias de ocorrência
-- ======================================================================
INSERT INTO categorias_ocorrencia (id, municipio_id, nome, icone, servico_id) VALUES
 ('80000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Buraco na via','construction','50000000-0000-4000-8000-000000000003'),
 ('80000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Passeio danificado','footprints','50000000-0000-4000-8000-000000000003'),
 ('80000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','Iluminação pública','lamp','50000000-0000-4000-8000-000000000004'),
 ('80000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','Sinalização ou semáforo','traffic-cone','50000000-0000-4000-8000-000000000005'),
 ('80000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001','Árvore ou espaço verde','trees','50000000-0000-4000-8000-000000000004'),
 ('80000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001','Lixo ou contentor','trash-2','50000000-0000-4000-8000-000000000009'),
 ('80000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000001','Monstros abandonados na rua','sofa','50000000-0000-4000-8000-000000000009'),
 ('80000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001','Rotura de água ou esgoto','droplets','50000000-0000-4000-8000-00000000000a'),
 ('80000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001','Carro abandonado','car','50000000-0000-4000-8000-000000000005'),
 ('80000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001','Obra sem licença','hard-hat','50000000-0000-4000-8000-000000000006')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, icone = EXCLUDED.icone, servico_id = EXCLUDED.servico_id;

-- ======================================================================
-- Feriados (nacionais com municipio_id NULL; o municipal de Guimarães)
-- ======================================================================
INSERT INTO feriados (municipio_id, data, nome) VALUES
 (NULL,'2026-01-01','Ano Novo'),
 (NULL,'2026-04-03','Sexta-feira Santa'),
 (NULL,'2026-04-05','Páscoa'),
 (NULL,'2026-04-25','Dia da Liberdade'),
 (NULL,'2026-05-01','Dia do Trabalhador'),
 (NULL,'2026-06-04','Corpo de Deus'),
 (NULL,'2026-06-10','Dia de Portugal'),
 (NULL,'2026-08-15','Assunção de Nossa Senhora'),
 (NULL,'2026-10-05','Implantação da República'),
 (NULL,'2026-11-01','Dia de Todos os Santos'),
 (NULL,'2026-12-01','Restauração da Independência'),
 (NULL,'2026-12-08','Imaculada Conceição'),
 (NULL,'2026-12-25','Natal'),
 (NULL,'2027-01-01','Ano Novo'),
 (NULL,'2027-03-26','Sexta-feira Santa'),
 (NULL,'2027-03-28','Páscoa'),
 (NULL,'2027-04-25','Dia da Liberdade'),
 (NULL,'2027-05-01','Dia do Trabalhador'),
 (NULL,'2027-05-27','Corpo de Deus'),
 (NULL,'2027-06-10','Dia de Portugal'),
 (NULL,'2027-08-15','Assunção de Nossa Senhora'),
 (NULL,'2027-10-05','Implantação da República'),
 (NULL,'2027-11-01','Dia de Todos os Santos'),
 (NULL,'2027-12-01','Restauração da Independência'),
 (NULL,'2027-12-08','Imaculada Conceição'),
 (NULL,'2027-12-25','Natal'),
 ('a1000000-0000-4000-8000-000000000001','2026-06-24','Feriado municipal de Guimarães'),
 ('a1000000-0000-4000-8000-000000000001','2027-06-24','Feriado municipal de Guimarães')
ON CONFLICT (municipio_id, data) DO UPDATE SET nome = EXCLUDED.nome;

-- ======================================================================
-- Pronúncias (nomes locais que a voz tem de dizer bem)
-- ======================================================================
INSERT INTO pronuncias (municipio_id, termo, como_se_diz) VALUES
 ('a1000000-0000-4000-8000-000000000001','Gualterianas','gual-te-ri-a-nas'),
 ('a1000000-0000-4000-8000-000000000001','Vimágua','vi-má-gua'),
 ('a1000000-0000-4000-8000-000000000001','Creixomil','crei-xo-mil'),
 ('a1000000-0000-4000-8000-000000000001','Paço dos Duques','pa-ço dos du-ques'),
 ('a1000000-0000-4000-8000-000000000001','Pegú','pe-gú')
ON CONFLICT (municipio_id, termo) DO UPDATE SET como_se_diz = EXCLUDED.como_se_diz;

-- ======================================================================
-- RGPD: quanto tempo se guarda (mostrado em Equipa e acessos)
-- ======================================================================
INSERT INTO politicas_retencao (municipio_id, objeto, guardar, acao) VALUES
 ('a1000000-0000-4000-8000-000000000001','gravacoes','30 days','apagar'),
 ('a1000000-0000-4000-8000-000000000001','transcricoes','12 months','anonimizar'),
 ('a1000000-0000-4000-8000-000000000001','telefones_sem_processo','6 months','anonimizar'),
 ('a1000000-0000-4000-8000-000000000001','fotos_ocorrencias','12 months','apagar')
ON CONFLICT (municipio_id, objeto) DO UPDATE SET guardar = EXCLUDED.guardar, acao = EXCLUDED.acao;

COMMIT;
