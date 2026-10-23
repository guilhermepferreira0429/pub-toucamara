/*
 * Vídeo do munícipe: "Uma renovação, do princípio ao fim".
 *
 * O caminho é o verdadeiro, com uma pessoa de demonstração (telefone da gama
 * de teste: nada sai para a rede):
 *   1. a licença da esplanada do Café da Praça, pedida pela ferramenta
 *      pedir_licenca e paga em modo de teste, como faz o "Experimentar uma
 *      renovação" do /ligar (DemoVisitanteService), e posta a acabar daqui a
 *      10 dias (a renovação pede 5 dias úteis);
 *   2. o aviso pelo job diário das licenças (o SMS "Para renovar, ligue ou
 *      escreva-nos…"; a chamada da câmara só vai quando há número de saída);
 *   3. a chamada no /ligar, num telemóvel, com o ElevenLabs simulado (o
 *      agente de voz não corre aqui): as falas são escritas por nós, as
 *      ferramentas são as verdadeiras (renovar_licenca, na API local) e o
 *      ecrã mostra o que elas devolvem;
 *   4. o SMS do pagamento, a página de pagamento (modo de teste), o SMS da
 *      licença emitida e a página da licença com o QR;
 *   5. o painel: a licença a expirar e a renovação emitida.
 *
 * Precisa de AGENTE_SEGREDO (o das ferramentas do agente) e das variáveis da
 * base (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME): o passo 1 acerta
 * as datas na base, como o DemoVisitanteService.
 */
import pg from 'pg';
import { API, MUNICIPIO, WEB, api, captor, diaLisboa } from './comum.mjs';
import { diaPorExtenso, eurosPorExtenso, porExtenso } from './extenso.mjs';

const TELEFONE = process.env.MUNICIPE_TELEFONE ?? '+351910000146';
const ESTABELECIMENTO = 'Café da Praça';
const TELEMOVEL = { width: 390, height: 844 };

export async function capturarMunicipe({ browser, pagina, capturas, pasta }) {
  const segredo = process.env.AGENTE_SEGREDO;
  if (!segredo) throw new Error('Falta AGENTE_SEGREDO (as ferramentas do agente).');
  if (!/^\+351910000\d{3}$/.test(TELEFONE)) {
    throw new Error('O telefone do vídeo tem de ser da gama de demonstração (+351 910 000 xxx).');
  }
  const db = new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();
  const um = async (sql, p) => (await db.query(sql, p)).rows[0];

  const ferramenta = async (nome, corpo, conversa) => {
    const r = await fetch(`${API}/v1/agent/tools/${nome}`, {
      method: 'POST',
      headers: {
        'x-agente-segredo': segredo,
        'x-municipio': MUNICIPIO,
        'x-telefone-web': TELEFONE,
        ...(conversa ? { 'x-conversa-id': conversa } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${await r.text()}`);
    return r.json();
  };

  const municipio = await um('SELECT id, nome FROM municipios WHERE slug = $1', [MUNICIPIO]);
  const pessoa = await um(
    'SELECT id, nome FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $2',
    [municipio.id, TELEFONE],
  );
  if (!pessoa) throw new Error('A pessoa de demonstração não existe: prepare a demonstração.');

  // 1. A licença a renovar (a mesma, se uma captura anterior não chegou a renovar).
  const SELECT_BASE = `
    SELECT l.id, p.numero, l.estado FROM licencas l JOIN processos p ON p.id = l.processo_id
    WHERE l.municipe_id = $1 AND l.tipo = 'esplanada' AND l.estado = 'emitida'
      AND l.dados->>'estabelecimento' = $2
      AND NOT EXISTS (SELECT 1 FROM licencas r WHERE r.renova_licenca_id = l.id AND r.estado <> 'recusada')
    ORDER BY l.criada_em DESC LIMIT 1`;
  let base = await um(SELECT_BASE, [pessoa.id, ESTABELECIMENTO]);
  if (!base) {
    const r = await ferramenta('pedir_licenca', {
      tipo: 'esplanada',
      dados: {
        estabelecimento: ESTABELECIMENTO,
        morada: 'Avenida Conde Margaride, 20, Guimarães',
        data_inicio: diaLisboa(21),
        meses: 1,
        area_m2: 10,
        mesas: 4,
        passeio_livre_m: 2,
        estrado: false,
        centro_historico: false,
        nome: `${ESTABELECIMENTO}, Lda`,
      },
    });
    if (!r.pedida) throw new Error(`pedir_licenca: ${JSON.stringify(r).slice(0, 300)}`);
    const codigo = String(r.pagamento?.link ?? '').split('/r/')[1];
    if (codigo) {
      await fetch(`${API}/v1/public/pagamentos/${codigo}/simular-pagamento`, { method: 'POST' });
    }
    await api('licencas?limite=5'); // sincroniza as pagas (emite)
    base = await um(SELECT_BASE, [pessoa.id, ESTABELECIMENTO]);
    if (!base) throw new Error('A licença de demonstração não ficou emitida.');
  }
  // Emitida há 25 dias, começou há 20 e acaba daqui a 10 (como no /ligar).
  await db.query(
    `UPDATE licencas SET valida_ate = $2::date, decidida_em = now() - interval '25 days',
       dados = jsonb_set(dados, '{data_inicio}', to_jsonb($3::text))
     WHERE id = $1`,
    [base.id, diaLisboa(10), diaLisboa(-20)],
  );
  await db.query(
    `INSERT INTO demo_registos (municipio_id, chave, tipo, objeto_id)
     VALUES ($1, $2, 'licenca', $3) ON CONFLICT (municipio_id, chave) DO NOTHING`,
    [municipio.id, `licenca:video:${base.id}`, base.id],
  );

  // 2. O aviso, pelo job diário das licenças.
  await db.query(`INSERT INTO pgboss.job (name, data) VALUES ('licencas_avisos', '{}')`);
  let aviso = null;
  for (let i = 0; i < 45 && !aviso; i++) {
    aviso = await um('SELECT dias, canal FROM licenca_avisos WHERE licenca_id = $1', [base.id]);
    if (!aviso) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!aviso) throw new Error('O aviso da licença não saiu (o job das licenças está a correr?).');

  // O painel antes: a licença a expirar.
  const painel = captor(pagina, capturas, { largura: 1920, altura: 1080, pasta });
  await painel.ir('/painel/licencas');
  await pagina.getByRole('tab', { name: /A expirar/ }).or(pagina.getByRole('button', { name: /A expirar/ })).first().click();
  await pagina.waitForTimeout(1500);
  await painel.guardar('municipe_a_expirar', {
    linha: await painel.elemento(base.numero, 3),
  });

  // 3. A chamada, no telemóvel.
  const contexto = await browser.newContext({
    viewport: TELEMOVEL,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Europe/Lisbon',
    locale: 'pt-PT',
    permissions: ['microphone'],
  });
  const tel = await contexto.newPage();
  const fone = captor(tel, capturas, { largura: 390, altura: 844, pasta });
  const REF = `conv_video_${Date.now()}`;
  let servidor = null;
  await tel.routeWebSocket(/elevenlabs/, (ws) => {
    servidor = ws;
    let iniciado = false;
    ws.onMessage(() => {
      if (iniciado) return;
      iniciado = true;
      ws.send(
        JSON.stringify({
          type: 'conversation_initiation_metadata',
          conversation_initiation_metadata_event: {
            conversation_id: REF,
            agent_output_audio_format: 'pcm_16000',
            user_input_audio_format: 'pcm_16000',
          },
        }),
      );
    });
  });
  let evento = 0;
  const enviar = (o) => servidor.send(JSON.stringify(o));
  const falas = [];
  const agente = async (texto, captura) => {
    enviar({ type: 'agent_response', agent_response_event: { agent_response: texto, event_id: ++evento } });
    await tel.waitForTimeout(1200);
    if (captura) await fone.guardar(captura);
    falas.push({ quem: 'agente', texto, captura });
  };
  const municipe = async (texto, captura) => {
    enviar({ type: 'user_transcript', user_transcription_event: { user_transcript: texto, event_id: ++evento } });
    await tel.waitForTimeout(1200);
    if (captura) await fone.guardar(captura);
    falas.push({ quem: 'municipe', texto, captura });
  };
  const usar = async (nome, corpo, captura) => {
    const id = `ferramenta_${++evento}`;
    enviar({ type: 'agent_tool_request', agent_tool_request: { tool_name: nome, tool_call_id: id, tool_type: 'webhook' } });
    await tel.waitForTimeout(700);
    if (captura) await fone.guardar(captura);
    const r = await ferramenta(nome, corpo, REF);
    enviar({
      type: 'agent_tool_response_full_payload',
      agent_tool_response_full_payload: {
        tool_name: nome,
        tool_call_id: id,
        tool_type: 'webhook',
        is_error: false,
        full_tool_result: JSON.stringify(r),
      },
    });
    await tel.waitForTimeout(900);
    return r;
  };

  await fone.ir('/ligar');
  await fone.guardar('municipe_ligar');
  await tel.getByRole('button', { name: /Ligar agora/ }).click();
  await tel.getByRole('button', { name: /Aceitar e continuar/ }).click();
  await tel.locator('input[type=tel]').fill(TELEFONE.replace('+351', ''));
  await tel.waitForTimeout(500);
  await fone.guardar('municipe_numero');
  await tel.getByRole('button', { name: /Ligar agora/ }).click();
  for (let i = 0; i < 40 && !servidor; i++) await tel.waitForTimeout(250);
  if (!servidor) throw new Error('A chamada não abriu (o ElevenLabs simulado não recebeu a ligação).');
  await tel.getByText('Legendas em direto').waitFor({ timeout: 20_000 });

  // A saudação é a da câmara (agente_config.saudacao; no browser não há o
  // aviso de gravação, que já foi aceite no ecrã).
  const { saudacao } = await um('SELECT saudacao FROM agente_config WHERE municipio_id = $1', [municipio.id]);
  const saudacaoDita = saudacao.replace(/\s*Em que (?:posso|podemos) ajudar\??$/i, '').trim();
  await agente(`${saudacaoDita} Em que posso ajudar?`, 'municipe_chamada_01');
  await municipe(
    'Olá. Recebi um SMS a dizer que a licença da esplanada está a acabar. Queria renová-la.',
    'municipe_chamada_02',
  );
  const r1 = await usar('renovar_licenca', {}, 'municipe_chamada_03');
  if (!r1.encontrada || !r1.licenca) throw new Error(`renovar_licenca: ${JSON.stringify(r1).slice(0, 300)}`);
  const ate = diaPorExtenso(r1.licenca.valida_ate);
  await agente(
    `A sua licença da esplanada do ${ESTABELECIMENTO} é válida até ${ate}. ` +
      `Renovo com os mesmos dados: ${porExtenso(10)} metros quadrados, ${porExtenso(4)} mesas e ${porExtenso(2)} metros de passeio livre, por um mês. Mudou alguma coisa?`,
    'municipe_chamada_04',
  );
  await municipe('Não, está tudo igual.', 'municipe_chamada_05');
  const r2 = await usar('renovar_licenca', { confirmar: true });
  if (!r2.pedida) throw new Error(`renovar_licenca (confirmar): ${JSON.stringify(r2).slice(0, 300)}`);
  const pg2 = r2.pagamento;
  await agente(
    'Verifiquei as regras e o pedido cumpre todas. ' +
      (pg2 ? `A taxa é de ${eurosPorExtenso(pg2.valor_cent)}. ` : '') +
      (pg2?.mbway
        ? 'Mandei-lhe por SMS o pedido MB WAY: é um teste, nada é cobrado. '
        : pg2
          ? 'Mandei-lhe por SMS a referência Multibanco: é de teste, nada é cobrado. '
          : '') +
      'Assim que estiver paga, a licença nova segue por SMS, com um código QR.',
    'municipe_chamada_06',
  );
  await municipe('Ótimo. Obrigada!', null);
  await agente('De nada. Vai receber um SMS com o resumo. Até breve!', 'municipe_chamada_07');
  await tel.getByRole('button', { name: 'Desligar a chamada' }).click();
  await tel.waitForTimeout(1500);
  await fone.guardar('municipe_fim');

  // 4. Os SMS (o texto que ficou gravado: é o que a pessoa recebe) e as páginas.
  const sms = async (motivo, padrao) =>
    (
      await db.query(
        `SELECT corpo, coalesce(enviada_em, enviar_em) AS em FROM mensagens_saida
         WHERE destino = $1 AND motivo = $2 AND corpo LIKE $3 ORDER BY enviar_em DESC LIMIT 1`,
        [TELEFONE, motivo, padrao],
      )
    ).rows[0] ?? null;
  const smsAviso = await sms('lembrete', `%${base.numero}%`);
  const guia = pg2?.guia_numero ?? '';
  const smsPagamento = await sms('pagamento', `%guia ${guia},%`);
  // Os links do SMS levam o domínio público (WEB_URL da API); aqui abrem-se
  // no site local. O link curto resolve-se na API sem seguir o redirect.
  const local = (url) => url.replace(/^https?:\/\/[^/]+/, WEB);
  const resolver = async (url) => {
    const codigo = url.match(/\/r\/(\w+)/)?.[1];
    if (!codigo) return local(url);
    const r = await fetch(`${API}/r/${codigo}`, { redirect: 'manual' });
    const destino = r.headers.get('location');
    if (!destino) throw new Error(`O link curto ${codigo} não abriu (HTTP ${r.status}).`);
    return local(new URL(destino, WEB).toString());
  };
  const linkPagamento = smsPagamento?.corpo.match(/https?:\/\/\S+\/r\/\w+/)?.[0];
  if (!linkPagamento) throw new Error('Não encontrei o SMS do pagamento.');
  await fone.ir(await resolver(linkPagamento));
  await fone.guardar('municipe_pagamento', {}, { inteira: true });
  await tel.getByRole('button', { name: /Simular o pagamento|Aceitar/ }).first().click();
  await tel.waitForTimeout(2000);
  await fone.guardar('municipe_pago', {}, { inteira: true });
  await api('licencas?limite=5'); // sincroniza: a renovação paga fica emitida
  const nova = await um(
    `SELECT l.id, l.estado, p.numero, to_char(l.valida_ate, 'YYYY-MM-DD') AS valida_ate,
            l.dados->>'data_inicio' AS inicio
     FROM licencas l JOIN processos p ON p.id = l.processo_id WHERE p.numero = $1 AND l.municipio_id = $2`,
    [r2.numero, municipio.id],
  );
  const smsEmitida = await sms('processo', `%${r2.numero}%emitida%`);
  const linkLicenca = smsEmitida?.corpo.match(/https?:\/\/\S+\/licenca\/\w+/)?.[0];
  if (linkLicenca) {
    await fone.ir(local(linkLicenca));
    await fone.guardar('municipe_licenca', {}, { inteira: true });
  }

  // 5. O painel depois: a renovação emitida, na lista das licenças.
  await painel.ir('/painel/licencas');
  await painel.guardar(
    'municipe_licencas',
    { cartao: await painel.elemento(r2.numero, 4) },
    { inteira: true },
  );
  await contexto.close();
  await db.end();

  return {
    municipe: {
      estabelecimento: ESTABELECIMENTO,
      telefone: TELEFONE,
      numero: base.numero,
      renovacao: r2.numero,
      estado_renovacao: nova?.estado ?? null,
      valida_ate: r1.licenca.valida_ate,
      nova_valida_ate: nova?.valida_ate ?? null,
      taxa: r2.taxa ?? null,
      taxa_cent: pg2?.valor_cent ?? null,
      mbway: !!pg2?.mbway,
      aviso: aviso,
      sms: {
        aviso: smsAviso?.corpo ?? null,
        pagamento: smsPagamento?.corpo ?? null,
        emitida: smsEmitida?.corpo ?? null,
      },
      falas,
    },
  };
}
