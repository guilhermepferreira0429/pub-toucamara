-- Seed de Guimarães · DADOS DE DEMONSTRAÇÃO (não são munícipes reais).
-- Duas semanas de atividade para o painel não estar vazio nos vídeos e no pitch:
-- ~190 conversas (telefone e chat, com transcrição curta e a fonte citada),
-- requerimentos e processos CP, ocorrências no mapa, passagens a funcionários,
-- marcações no balcão, SMS de fim de chamada e perguntas sem resposta.
--
-- Segurança: os munícipes de demonstração não têm telefone nem email e têm
-- aceita_chamadas/aceita_avisos = false; lembretes já marcados como enviados e
-- SMS já "entregues". Nenhum job manda nada a ninguém por causa disto.
--
-- Corre uma vez: se já houver conversas 'demo-%' não faz nada. As datas são
-- relativas ao momento em que corre (as últimas 2 semanas).
-- Para apagar: env/prod/docker/limpar-demo.sh

DO $demo$
DECLARE
  mid  constant uuid := 'a1000000-0000-4000-8000-000000000001';
  tec  constant uuid := '60000000-0000-4000-8000-000000000003';   -- Rui Salgado, técnico
  atd  constant uuid := '60000000-0000-4000-8000-000000000004';   -- Marta Oliveira, atendimento
  tipo_cp constant uuid := 'b1000000-0000-4000-8000-000000000001';
  ag_balcao constant uuid := '90000000-0000-4000-8000-000000000001';
  nomes text[] := ARRAY['Maria Fernandes','José Machado','Ana Ribeiro','Manuel Oliveira','Rosa Pereira',
    'António Silva','Fernanda Costa','Joaquim Martins','Lúcia Gonçalves','Carlos Mendes','Isabel Lopes',
    'Rui Carvalho','Teresa Alves','Paulo Sousa','Helena Teixeira','Domingos Freitas','Sandra Pinto',
    'Albino Castro','Cristina Faria','Jorge Barbosa','Patrícia Araújo','Armando Lemos','Sónia Cunha',
    'Filipe Rocha','Graça Magalhães','Nuno Vieira','Olga Antunes','Vítor Moreira','Beatriz Salgado',
    'Hugo Fonseca','Laura Cardoso','Mário Guimarães','Ilda Coelho','Tiago Neves','Conceição Abreu',
    'Ricardo Leite','Fátima Marques','Henrique Matos','Alice Sampaio','Bruno Ferraz'];
  ruas text[] := ARRAY['Rua de Santo António','Largo do Toural','Avenida D. Afonso Henriques','Rua Paio Galvão',
    'Alameda de São Dâmaso','Avenida de Londres','Avenida Conde Margaride','Rua de Camões','Avenida D. João IV',
    'Rua Francisco Agra','Avenida da Universidade','Rua Dr. José Sampaio','Rua de Gil Vicente','Rua da Liberdade'];
  lats float8[] := ARRAY[41.4426,41.4417,41.4397,41.4428,41.4425,41.4365,41.4385,41.4418,41.4440,41.4455,41.4519,41.4405,41.4447,41.4392];
  lngs float8[] := ARRAY[-8.2949,-8.2954,-8.2953,-8.2970,-8.2915,-8.2935,-8.3030,-8.2925,-8.2870,-8.2885,-8.2913,-8.2885,-8.2950,-8.2990];
  fregs text[] := ARRAY['Oliveira, São Paio e São Sebastião','Oliveira, São Paio e São Sebastião','Urgezes',
    'Oliveira, São Paio e São Sebastião','Oliveira, São Paio e São Sebastião','Creixomil','Creixomil',
    'Oliveira, São Paio e São Sebastião','Azurém','Azurém','Azurém','Fermentões','Costa','Creixomil'];
  obras text[] := ARRAY['Abrir uma janela na fachada da cozinha','Alargar a porta da garagem para a rua',
    'Substituir a caixilharia da fachada principal','Fechar a varanda com vidro','Abrir uma porta para o quintal',
    'Mudar a janela da sala para porta de sacada','Remodelar a fachada lateral','Abrir uma janela no sótão',
    'Alterar o vão da montra','Substituir o portão da entrada','Abrir uma janela na casa de banho','Alargar a janela do quarto'];
  pesos int[] := ARRAY[14,6,12,9,6,8,5,4,3,4,3,5,4,7,4,1,4,2];
  sorteio int[] := '{}';
  mo record;
  munis uuid[] := '{}';
  m uuid; c uuid; r uuid; p uuid; o uuid; ev bigint; t3 bigint;
  i int; k int; n_cp int := 400; n_oc int := 300; n_marc int := 0;
  ini timestamptz; dur int; v_canal canal; hora int; dia int; idade float8;
  fora boolean; ix int; numero text; resumo text; fase fase_processo; cat uuid; est estado_ocorr;
  cita uuid; inicio_marc timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM conversas WHERE provider_id LIKE 'demo-%') THEN
    RAISE NOTICE 'demonstração já carregada: nada a fazer';
    RETURN;
  END IF;
  PERFORM setseed(0.42);

  -- Modelos de conversa: o que o munícipe pergunta, o que o agente responde, o resumo do painel.
  CREATE TEMP TABLE tpl (n int PRIMARY KEY, tema uuid, pergunta text, resposta text, resumo text,
                         resultado resultado_conv, cita uuid) ON COMMIT DROP;
  INSERT INTO tpl VALUES
   (1,'70000000-0000-4000-8000-000000000001','Quero fazer obras na cozinha, trocar os azulejos e os móveis. Preciso de licença?',
    'Se as obras forem só no interior e não mexerem na estrutura, na fachada nem no telhado, não precisa de licença nem de comunicação prévia. Mando-lhe por SMS o que diz a câmara sobre isso.',
    'Obras no interior da cozinha: isentas de licença e de comunicação prévia. Enviado o link por SMS.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000001' AND t.texto ILIKE '%isent%' ORDER BY t.ordem LIMIT 1)),
   (2,'70000000-0000-4000-8000-000000000001','Quero abrir uma janela na fachada da minha casa. O que tenho de fazer?',
    'Abrir uma janela na fachada precisa de comunicação prévia. Posso preencher o pedido consigo agora. As taxas são 78,60 euros de apreciação e 81,04 euros por fachada.',
    NULL,'resolvida','f4000000-0000-4000-8000-000000000003'),
   (3,'70000000-0000-4000-8000-000000000005','Estou sem água em casa. Para onde ligo?',
    'É só na sua casa ou os vizinhos também? Se for na rua toda, é avaria na rede. A Vimágua atende faltas de água 24 horas no 253 439 560, opção 3. Mando-lhe o número por SMS.',
    'Falta de água na rua. Encaminhado para a linha de faltas de água da Vimágua, 24 horas.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000021' ORDER BY (t.texto ILIKE '%falta%') DESC, t.ordem LIMIT 1)),
   (4,'70000000-0000-4000-8000-000000000004','Tenho um sofá velho e um colchão. Como me livro deles?',
    'A recolha de monstros é gratuita. A Vitrus marca a recolha à porta: ligue para o número verde 800 209 565, que é grátis. Não deixe os monstros na rua sem a recolha marcada, porque dá multa.',
    'Recolha de monstros (sofá e colchão): explicado que é grátis e como marcar com a Vitrus.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000031' ORDER BY t.ordem LIMIT 1)),
   (5,'70000000-0000-4000-8000-000000000004','O contentor do lixo da minha rua está sempre a transbordar.',
    'Registei a ocorrência e passei-a à equipa da recolha. Vai receber um SMS quando estiver resolvida.',
    NULL,'resolvida',NULL),
   (6,'70000000-0000-4000-8000-00000000000b','Há um buraco grande na estrada ao pé da minha casa.',
    'Registei a ocorrência com a morada que me disse e passei-a à equipa de vias. Vai receber um SMS com o número e outro quando estiver resolvida.',
    NULL,'resolvida',NULL),
   (7,'70000000-0000-4000-8000-00000000000b','O candeeiro da minha rua está apagado há uma semana.',
    'A iluminação pública é reparada pela E-REDES. A câmara indica que a avaria se comunica no balcão digital da E-REDES. Mando-lhe o link por SMS.',
    'Candeeiro apagado: encaminhado para o balcão digital da E-REDES, como indica a câmara.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-00000000000b' ORDER BY t.ordem LIMIT 1)),
   (8,'70000000-0000-4000-8000-000000000003','Qual é a taxa do IMI em Guimarães? Tenho dois filhos.',
    'Para o IMI de 2025, que se paga em 2026, a taxa em Guimarães é de 0,31%. Com dois dependentes tem uma redução de 70 euros. O pagamento é feito às Finanças.',
    'IMI: taxa de 0,31% e redução de 70 euros por ter 2 dependentes.','resolvida','f4000000-0000-4000-8000-000000000022'),
   (9,'70000000-0000-4000-8000-000000000002','Tenho um café e quero pôr uma esplanada. Quanto custa por ano?',
    'A esplanada paga 15,15 euros por metro quadrado e por ano. No Centro Histórico, na Rua de Santo António, no Toural e na Alameda de São Dâmaso são 18,18 euros.',
    'Esplanada: valor por m² e por ano explicado, com a diferença do Centro Histórico.','resolvida','f4000000-0000-4000-8000-000000000013'),
   (10,'70000000-0000-4000-8000-000000000006','Como peço a autorização de estacionamento de residente?',
    'Pede-se à câmara pelos Serviços Online, na parte dos Formulários. Mando-lhe o link e o valor por SMS.',
    'Autorização de estacionamento de residente: como pedir nos Serviços Online.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000006' ORDER BY (t.texto ILIKE '%residente%') DESC, t.ordem LIMIT 1)),
   (11,'70000000-0000-4000-8000-00000000000a','Encontrei um cão abandonado na rua. A quem aviso?',
    'Ligue para o Centro de Recolha Oficial de Animais da câmara, em Aldão, pelo 253 421 232. Atendem nos dias úteis de manhã e à tarde.',
    'Cão abandonado: encaminhado para o Centro de Recolha Oficial de Animais.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000009' ORDER BY t.ordem LIMIT 1)),
   (12,'70000000-0000-4000-8000-000000000001','Queria saber em que ponto está o meu pedido de obras.',
    'Encontrei o seu processo. Está em apreciação pelo técnico. Aviso-o por SMS quando houver uma decisão.',
    'Consulta do estado de um processo de obras pelo telefone.','resolvida',NULL),
   (13,'70000000-0000-4000-8000-000000000009','Queria marcar atendimento no Balcão Único.',
    'Marquei-lhe atendimento no Balcão Único. Mando-lhe por SMS o dia, a hora e o que deve levar.',
    'Marcação no Balcão Único feita na conversa.','marcacao',NULL),
   (14,'70000000-0000-4000-8000-000000000001','Não concordo com o que a câmara decidiu sobre o meu processo e quero falar com alguém.',
    'Percebo. Isso tem de ser visto por um funcionário. Passo-lhe já o caso resumido, e respondem-lhe até amanhã.',
    NULL,'passada_funcionario',NULL),
   (15,'70000000-0000-4000-8000-000000000008','A que horas abre a piscina de Brito ao fim de semana?',
    'Não tenho essa informação confirmada para a piscina de Brito. Deixo a pergunta registada e passo-a à Tempo Livre, pelo 253 721 254.',
    'Horário da piscina de Brito ao fim de semana: sem fonte; pergunta registada.','sem_resposta',NULL),
   (16,'70000000-0000-4000-8000-00000000000c','Está a sair fumo da casa do meu vizinho!',
    'Ligue já para o 112. Se puder, afaste-se da casa e não entre.',
    'Possível incêndio numa habitação: munícipe mandado ligar para o 112.','emergencia',NULL),
   (17,'70000000-0000-4000-8000-000000000009','Preciso de renovar o cartão de cidadão.',
    'Pode renovar no Espaço Cidadão, no Balcão Único da câmara, nos dias úteis das 9h às 17h. As senhas acabam às 16h45.',
    'Renovação do Cartão de Cidadão: encaminhado para o Espaço Cidadão no Balcão Único.','resolvida',
    (SELECT t.id FROM trechos t JOIN fonte_versoes v ON v.id=t.fonte_versao_id
      WHERE v.fonte_id='f1000000-0000-4000-8000-000000000091' ORDER BY (t.texto ILIKE '%cart%') DESC, t.ordem LIMIT 1)),
   (18,NULL,'Estou a ligar por causa da',NULL,'Chamada caiu antes de o munícipe dizer o assunto.','caiu',NULL);

  FOR k IN 1..array_length(pesos,1) LOOP
    FOR i IN 1..pesos[k] LOOP sorteio := sorteio || k; END LOOP;
  END LOOP;

  -- Munícipes de demonstração: sem contactos (nada lhes pode ser enviado).
  FOR i IN 1..array_length(nomes,1) LOOP
    INSERT INTO municipes (id, municipio_id, nome, aceita_chamadas, aceita_avisos, criado_em)
    VALUES (('de000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, mid, nomes[i], false, false,
            now() - interval '30 days') RETURNING id INTO m;
    munis := munis || m;
  END LOOP;

  FOR i IN 1..190 LOOP
    k := sorteio[1 + floor(random()*array_length(sorteio,1))::int];   -- fora do WHERE: o random() seria por linha
    SELECT * INTO mo FROM tpl WHERE n = k;
    dia := floor(random()*14)::int;
    hora := (ARRAY[8,9,9,10,10,10,11,11,11,12,13,14,14,15,15,16,16,17,18,19,20,21,21,22,23,0,7])[1 + floor(random()*27)::int];
    ini := (date_trunc('day', now() AT TIME ZONE 'Europe/Lisbon') - make_interval(days => dia)
            + make_interval(hours => hora, mins => floor(random()*60)::int)) AT TIME ZONE 'Europe/Lisbon';
    IF ini > now() - interval '10 minutes' THEN ini := now() - make_interval(mins => 20 + floor(random()*300)::int); END IF;
    idade := extract(epoch FROM now() - ini) / 86400;
    v_canal := CASE WHEN random() < 0.64 THEN 'telefone' ELSE 'chat' END;
    IF mo.n = 16 THEN v_canal := 'telefone'; END IF;
    dur := CASE WHEN mo.n = 18 THEN 9 + floor(random()*10)::int ELSE 70 + floor(random()*290)::int END;
    fora := extract(isodow FROM ini AT TIME ZONE 'Europe/Lisbon') > 5
            OR extract(hour FROM ini AT TIME ZONE 'Europe/Lisbon') NOT BETWEEN 9 AND 16;
    m := CASE WHEN v_canal = 'chat' AND random() < 0.4 THEN NULL ELSE munis[1 + floor(random()*array_length(munis,1))::int] END;
    IF mo.n IN (2,12,13,14) AND m IS NULL THEN m := munis[1 + floor(random()*array_length(munis,1))::int]; END IF;
    ix := 1 + floor(random()*array_length(ruas,1))::int;
    resumo := mo.resumo;

    INSERT INTO conversas (municipio_id, municipe_id, canal, provider_id, iniciada_em, terminada_em, duracao_s,
                           consentimento_em, resultado, tema_id, resumo, agente_versao, fora_de_horas,
                           resumida_em, revisao, revista_por, revista_em)
    VALUES (mid, m, v_canal, 'demo-' || i, ini, ini + make_interval(secs => dur), dur,
            CASE WHEN v_canal = 'telefone' THEN ini END, mo.resultado, mo.tema, coalesce(resumo, '…'), 'v1', fora,
            ini + make_interval(secs => dur + 40),
            CASE WHEN random() < 0.25 AND mo.n NOT IN (15,18) THEN 'certa' END,
            NULL, NULL)
    RETURNING id INTO c;
    UPDATE conversas SET revista_por = atd, revista_em = ini + interval '1 day' WHERE id = c AND revisao IS NOT NULL;

    INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto, inicio_ms, fim_ms) VALUES
     (c, 1, 'agente', CASE WHEN v_canal = 'telefone'
        THEN 'Olá, fala o Patrício Brito, o assistente automático da Câmara Municipal de Guimarães. A chamada é gravada. Em que posso ajudar?'
        ELSE 'Olá, sou o Patrício Brito, o assistente automático da Câmara Municipal de Guimarães. Em que posso ajudar?' END, 0, 6500),
     (c, 2, 'municipe', mo.pergunta, 7000, 12000);
    IF mo.resposta IS NOT NULL THEN
      INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto, inicio_ms, fim_ms)
      VALUES (c, 3, 'agente', mo.resposta, 13500, 26000) RETURNING id INTO t3;
      IF mo.cita IS NOT NULL THEN INSERT INTO citacoes (turno_id, trecho_id) VALUES (t3, mo.cita); END IF;
    END IF;

    -- Comunicação prévia preenchida na conversa → requerimento entregue → processo.
    IF mo.n = 2 THEN
      n_cp := n_cp + 1;
      numero := 'CP ' || n_cp || '/2026';
      fase := CASE WHEN idade < 1 THEN 'entrada' WHEN idade < 4 THEN 'documentos' WHEN idade < 8 THEN 'apreciacao'
                   WHEN idade < 11 THEN 'decisao' ELSE 'notificado' END;
      INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, conversa_origem_id, assunto, morada,
                             freguesia, lat, lng, fase, tecnico_id, prazo_inicio, prazo_fim, decisao, decidido_em,
                             criado_em, atualizado_em)
      VALUES (mid, numero, tipo_cp, m, c, obras[1 + (n_cp % array_length(obras,1))],
              ruas[ix] || ', ' || (10 + floor(random()*190)::int), fregs[ix],
              lats[ix] + (random()-0.5)*0.003, lngs[ix] + (random()-0.5)*0.003, fase,
              CASE WHEN fase <> 'entrada' THEN tec END,
              (ini AT TIME ZONE 'Europe/Lisbon')::date, (ini AT TIME ZONE 'Europe/Lisbon')::date + 28,
              CASE WHEN fase = 'notificado' THEN 'admitido' END,
              CASE WHEN fase = 'notificado' THEN ini + interval '10 days' END,
              ini + make_interval(secs => dur), now())
      RETURNING id INTO p;
      INSERT INTO requerimentos (municipio_id, municipe_id, conversa_id, tipo_processo_id, dados, estado, assinatura,
                                 assinado_em, processo_id, criado_em, atualizado_em)
      VALUES (mid, m, c, tipo_cp,
              jsonb_build_object('nome', (SELECT nome FROM municipes WHERE id = m), 'qualidade', 'proprietário',
                'morada_obra', (SELECT morada FROM processos WHERE id = p), 'freguesia', fregs[ix],
                'descricao', (SELECT assunto FROM processos WHERE id = p), 'centro_historico', false, 'nif_registado', true),
              'entregue', 'simulada', ini + make_interval(secs => dur - 20), p, ini, ini + make_interval(secs => dur));
      INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, em)
      VALUES (p, 'criado', 'Comunicação prévia preenchida e assinada na conversa com o agente.', 'agente', ini + make_interval(secs => dur));
      IF fase <> 'entrada' THEN
        INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
        VALUES (p, 'fase', 'Passou a documentos.', 'utilizador', tec, '{"de":"entrada","para":"documentos"}', ini + interval '1 day');
        INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
        VALUES (p, 'documento_pedido', 'Pedida a certidão permanente do registo predial.', 'utilizador', tec,
                '{"nome":"Certidão permanente do registo predial","tipo_documento_id":"d1000000-0000-4000-8000-000000000001"}',
                ini + interval '1 day 1 hour')
        RETURNING id INTO ev;
        INSERT INTO processo_pedidos (processo_id, evento_id, descricao, tipo_documento_id, pedido_em, prazo,
                                      lembrete_enviado_em, criado_por)
        VALUES (p, ev, 'Certidão permanente do registo predial', 'd1000000-0000-4000-8000-000000000001',
                ini + interval '1 day 1 hour', (ini AT TIME ZONE 'Europe/Lisbon')::date + 15, now(), tec);
      END IF;
      IF fase IN ('apreciacao','decisao','notificado') THEN
        INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
        VALUES (p, 'fase', 'Passou a apreciação.', 'utilizador', tec, '{"de":"documentos","para":"apreciacao"}', ini + interval '4 days');
      END IF;
      IF fase IN ('decisao','notificado') THEN
        INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
        VALUES (p, 'fase', 'Passou a decisão.', 'utilizador', tec, '{"de":"apreciacao","para":"decisao"}', ini + interval '8 days');
      END IF;
      IF fase = 'notificado' THEN
        INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
        VALUES (p, 'fase', 'Comunicação prévia admitida e munícipe notificado.', 'utilizador', tec,
                '{"de":"decisao","para":"notificado"}', ini + interval '10 days');
      END IF;
      UPDATE conversas SET resumo = 'Abertura de um vão na fachada: comunicação prévia preenchida na chamada e entregue como '
        || numero || '.' WHERE id = c;
    END IF;

    -- Ocorrências registadas pelo agente.
    IF mo.n IN (5,6) THEN
      n_oc := n_oc + 1;
      numero := 'OC-' || lpad(n_oc::text, 4, '0');
      cat := CASE WHEN mo.n = 5 THEN '80000000-0000-4000-8000-000000000006'::uuid
                  WHEN random() < 0.75 THEN '80000000-0000-4000-8000-000000000001'::uuid
                  ELSE '80000000-0000-4000-8000-000000000002'::uuid END;
      est := CASE WHEN idade > 5 AND random() < 0.7 THEN 'resolvida' WHEN idade > 1 THEN 'com_equipa' ELSE 'nova' END;
      INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, estado, servico_id,
                               municipe_id, conversa_id, prevista_para, resolvida_em, criada_em)
      VALUES (mid, numero, cat,
              CASE WHEN mo.n = 5 THEN 'Contentor do lixo cheio, com sacos no chão à volta.'
                   ELSE 'Buraco na faixa de rodagem, perigoso para motas e bicicletas.' END,
              ruas[ix] || ', ' || (10 + floor(random()*190)::int),
              lats[ix] + (random()-0.5)*0.004, lngs[ix] + (random()-0.5)*0.004, est,
              CASE WHEN est = 'nova' AND random() < 0.5 THEN NULL
                   ELSE (SELECT servico_id FROM categorias_ocorrencia WHERE id = cat) END,
              m, c,
              CASE WHEN est = 'com_equipa' THEN (now() AT TIME ZONE 'Europe/Lisbon')::date + 1 + floor(random()*5)::int END,
              CASE WHEN est = 'resolvida' THEN ini + make_interval(hours => 20 + floor(random()*70)::int) END,
              ini + make_interval(secs => dur))
      RETURNING id INTO o;
      INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, dados, em)
      VALUES (o, 'registada', 'agente', '{}', ini + make_interval(secs => dur));
      IF est <> 'nova' THEN
        INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados, em)
        VALUES (o, 'atribuida', 'utilizador', tec, '{}', ini + interval '5 hours');
      END IF;
      IF est = 'resolvida' THEN
        INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, ator_id, dados, em)
        SELECT o, 'resolvida', 'utilizador', tec, '{}', resolvida_em FROM ocorrencias WHERE id = o;
      END IF;
      UPDATE conversas SET resumo = CASE WHEN mo.n = 5 THEN 'Contentor cheio' ELSE 'Buraco na via' END
        || ' em ' || (SELECT morada FROM ocorrencias WHERE id = o) || ': ocorrência ' || numero || ' registada na conversa.'
      WHERE id = c;
    END IF;

    -- Passagem a um funcionário.
    IF mo.n = 14 THEN
      INSERT INTO passagens_humano (conversa_id, motivo, resumo, fora_de_horas, preferencia_resposta, responder_ate,
                                    atribuida_a, estado, criada_em, respondida_em)
      VALUES (c, 'processo',
              'O munícipe discorda da decisão sobre o seu processo de obras e quer explicações de um técnico. Já sabe o número do processo e a fase em que está.',
              fora, CASE WHEN v_canal = 'chat' THEN 'chat' ELSE 'telefone' END, ini + interval '1 day',
              CASE WHEN idade > 2 THEN tec END,
              CASE WHEN idade < 2 THEN 'aberta' WHEN random() < 0.5 THEN 'respondida' ELSE 'fechada' END,
              ini + make_interval(secs => dur),
              CASE WHEN idade >= 2 THEN ini + interval '20 hours' END);
      UPDATE conversas SET resumo = 'Discorda da decisão sobre um processo de obras: passado a um funcionário com o caso resumido.'
      WHERE id = c;
    END IF;

    -- Marcação no Balcão Único (dias úteis seguintes, de meia em meia hora).
    IF mo.n = 13 THEN
      SELECT (d::date + make_interval(hours => 9, mins => 30 * (n_marc % 14))) AT TIME ZONE 'Europe/Lisbon'
      INTO inicio_marc
      FROM generate_series(current_date + 1, current_date + 30, interval '1 day') d
      WHERE extract(isodow FROM d) < 6
        AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = d::date AND (f.municipio_id IS NULL OR f.municipio_id = mid))
      ORDER BY d OFFSET n_marc / 14 LIMIT 1;
      INSERT INTO marcacoes (agenda_id, municipe_id, conversa_id, periodo, assunto, levar, lembrete_enviado_em, criada_em)
      VALUES (ag_balcao, m, c, tstzrange(inicio_marc, inicio_marc + interval '30 minutes'),
              'Atendimento geral', ARRAY['Cartão de Cidadão'], now(), ini + make_interval(secs => dur));
      n_marc := n_marc + 1;
    END IF;

    -- SMS de fim de chamada (já entregue; nunca volta a sair).
    IF v_canal = 'telefone' AND mo.resultado IN ('resolvida','marcacao','passada_funcionario') AND random() < 0.7 THEN
      INSERT INTO mensagens_saida (municipio_id, municipe_id, canal, destino, motivo, corpo, codificacao, segmentos,
                                   relacionado, enviar_em, estado, custo_cent, enviada_em, entregue_em, chave_idempotencia)
      VALUES (mid, m, 'sms', '+351000000000', 'fim_chamada',
              'Câmara de Guimarães: resumo da sua chamada e próximos passos (demonstração).', 'ucs2', 2,
              jsonb_build_object('conversa_id', c), ini + make_interval(secs => dur + 30), 'entregue', 10,
              ini + make_interval(secs => dur + 30), ini + make_interval(secs => dur + 35), 'demo-sms-' || i);
    END IF;
  END LOOP;

  -- Dois processos antigos com o prazo ultrapassado (para "atrasados").
  FOR k IN 1..2 LOOP
    n_cp := n_cp + 1; ix := k * 3;
    m := munis[k + 20];
    ini := now() - make_interval(days => 30 + k * 9);
    INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, freguesia, lat, lng,
                           fase, tecnico_id, prazo_inicio, prazo_fim, criado_em, atualizado_em)
    VALUES (mid, 'CP ' || n_cp || '/2026', tipo_cp, m, obras[k + 5], ruas[ix] || ', ' || (40 + k * 17), fregs[ix],
            lats[ix], lngs[ix], 'apreciacao', tec, (ini AT TIME ZONE 'Europe/Lisbon')::date,
            (ini AT TIME ZONE 'Europe/Lisbon')::date + 28, ini, now())
    RETURNING id INTO p;
    INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, em)
    VALUES (p, 'criado', 'Entregue no Balcão Único.', 'utilizador', ini);
    INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, ator_id, dados, em)
    VALUES (p, 'fase', 'Passou a apreciação.', 'utilizador', tec, '{"de":"entrada","para":"apreciacao"}', ini + interval '3 days');
  END LOOP;

  -- Ocorrências registadas no site (sem conversa), espalhadas pelo mapa, e dois duplicados.
  FOR k IN 1..10 LOOP
    n_oc := n_oc + 1; ix := 1 + (k * 5) % array_length(ruas,1);
    cat := (ARRAY['80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000005',
                  '80000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000007',
                  '80000000-0000-4000-8000-000000000009'])[1 + k % 5]::uuid;
    ini := now() - make_interval(hours => 6 + k * 29);
    est := CASE WHEN k % 3 = 0 THEN 'resolvida' WHEN k % 3 = 1 THEN 'com_equipa' ELSE 'nova' END;
    INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, estado, servico_id,
                             resolvida_em, criada_em, municipe_id)
    VALUES (mid, 'OC-' || lpad(n_oc::text, 4, '0'), cat,
            (ARRAY['Candeeiro apagado à noite.','Ramo de árvore partido em cima do passeio.','Sinal de stop tombado.',
                   'Monstros deixados junto aos contentores.','Carro abandonado há várias semanas.'])[1 + k % 5],
            ruas[ix] || ', ' || (5 + k * 11), lats[ix] + (random()-0.5)*0.004, lngs[ix] + (random()-0.5)*0.004, est,
            CASE WHEN est <> 'nova' THEN (SELECT servico_id FROM categorias_ocorrencia WHERE id = cat) END,
            CASE WHEN est = 'resolvida' THEN ini + interval '30 hours' END, ini, munis[30 + k])
    RETURNING id INTO o;
    INSERT INTO ocorrencia_eventos (ocorrencia_id, tipo, ator_tipo, dados, em) VALUES (o, 'registada', 'municipe', '{}', ini);
  END LOOP;
  UPDATE ocorrencias d SET estado = 'duplicada', duplicada_de = x.orig
  FROM (SELECT o2.id AS dup, (SELECT o1.id FROM ocorrencias o1 WHERE o1.municipio_id = mid AND o1.categoria_id = o2.categoria_id
                                AND o1.id <> o2.id AND o1.duplicada_de IS NULL AND o1.estado <> 'duplicada'
                              ORDER BY o1.criada_em LIMIT 1) AS orig
        FROM ocorrencias o2
        WHERE o2.municipio_id = mid AND o2.estado = 'nova'
          AND o2.categoria_id = '80000000-0000-4000-8000-000000000001'
        ORDER BY o2.criada_em DESC LIMIT 2) x
  WHERE d.id = x.dup AND x.orig IS NOT NULL;

  -- Numeração: os próximos números reais continuam a seguir aos da demonstração.
  INSERT INTO numeracao (municipio_id, prefixo, ano, ultimo) VALUES (mid, 'CP', 2026, n_cp), (mid, 'OC', 0, n_oc)
  ON CONFLICT (municipio_id, prefixo, ano) DO UPDATE SET ultimo = greatest(numeracao.ultimo, EXCLUDED.ultimo);

  -- Perguntas sem resposta (o que o portal não diz).
  INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, primeira_em, ultima_em, estado, o_que_falta) VALUES
   (mid, 'Em que dias passa a recolha do lixo na minha rua?', 14, now() - interval '13 days', now() - interval '3 hours', 'nova',
    'O calendário da recolha por rua ou freguesia (Vitrus).'),
   (mid, 'A que horas abre a piscina de Brito ao fim de semana?', 9, now() - interval '12 days', now() - interval '1 day', 'com_equipa',
    'O horário das piscinas de Brito e de Moreira de Cónegos (Tempo Livre).'),
   (mid, 'Quando abrem as inscrições para as férias desportivas?', 6, now() - interval '9 days', now() - interval '2 days', 'nova', NULL),
   (mid, 'Posso fazer uma queimada no meu terreno?', 5, now() - interval '11 days', now() - interval '4 days', 'espera_camara',
    'Uma regra escrita da câmara ou da Proteção Civil sobre queimas e queimadas.'),
   (mid, 'Há autocarro do centro para o hospital ao domingo?', 4, now() - interval '8 days', now() - interval '6 hours', 'nova', NULL),
   (mid, 'Onde posso estacionar uma autocaravana?', 3, now() - interval '6 days', now() - interval '2 days', 'fora_ambito', NULL);
END
$demo$;

-- Gráficos da Visão geral (o job refresca de 5 em 5 minutos; assim fica já).
REFRESH MATERIALIZED VIEW mv_conversas_por_hora;
REFRESH MATERIALIZED VIEW mv_temas_periodo;
REFRESH MATERIALIZED VIEW mv_resultados_periodo;
REFRESH MATERIALIZED VIEW mv_trabalho_feito_semana;
REFRESH MATERIALIZED VIEW mv_processos_fases;
REFRESH MATERIALIZED VIEW mv_processos_fases_historia;
