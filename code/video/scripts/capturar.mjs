/*
 * Capturas do painel para o vídeo, a partir de um painel a correr com a
 * demonstração preparada (ver README). Grava em public/capturas/ as imagens
 * (1920×1080 a 2x) e em src/dados.gerado.json os números que a narração diz
 * e as zonas de cada ecrã para onde a câmara vai. Pode correr-se as vezes
 * que for preciso (por exemplo, depois de haver fotografias das pessoas).
 *
 *   PAINEL_TOKEN=... npm run capturar
 *
 * Variáveis: WEB_URL (http://localhost:3000), API_URL (http://localhost:3001),
 * MUNICIPIO (guimaraes), PAINEL_TOKEN (sessão de chefia ou administração do
 * painel), CHROME (executável do Chromium; por omissão o de /opt/pw-browsers).
 *
 * Antes de capturar, esconde o que não é da demonstração ("Preparar demo"
 * com "limpar testes"): as chamadas simuladas das capturas anteriores não
 * entram nos números. LIMPAR=0 salta este passo.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'public', 'capturas');
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:3001';
const MUNICIPIO = process.env.MUNICIPIO ?? 'guimaraes';
const TOKEN = process.env.PAINEL_TOKEN;
const LARGURA = 1920;
const ALTURA = 1080;

if (!TOKEN) {
  console.error('Falta PAINEL_TOKEN (sessão do painel). Ver README.');
  process.exit(1);
}

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const pasta = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  return pasta ? join(base, pasta, 'chrome-linux', 'chrome') : undefined;
}

async function api(caminho) {
  const r = await fetch(`${API}/v1/painel/${caminho}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`GET ${caminho}: HTTP ${r.status}`);
  return r.json();
}

if (process.env.LIMPAR !== '0') {
  const r = await fetch(`${API}/v1/painel/demo/preparar`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ confirmar: true, limpar_testes: true }),
  });
  if (!r.ok) throw new Error(`Preparar demo: HTTP ${r.status} ${await r.text()}`);
  const { ocultados } = await r.json();
  console.log(`Escondido o que não é da demonstração: ${JSON.stringify(ocultados)}`);
}

// ---------------------------------------------------------------------------
// Os objetos da história (procurados pelo que são, não por ids fixos)
// ---------------------------------------------------------------------------

const visao = await api('visao-geral');
if (!visao.indicadores.conversas.valor) {
  throw new Error(
    'A Visão geral ainda está a zeros: os números refrescam de 5 em 5 minutos depois de preparar a demonstração.',
  );
}
const processo = (
  await api(`processos?texto=${encodeURIComponent('Porta na cozinha')}`)
).itens?.find((p) => p.assunto === 'Porta na cozinha');
const processoFicha = processo && (await api(`processos/${processo.id}`));
const ocorrencias = (await api('ocorrencias?limite=100')).itens ?? [];
const ocorrencia = ocorrencias.find(
  (o) => /Santo António, 40/.test(o.morada) && o.duplicados > 0,
);
const ocorrenciaFicha = ocorrencia && (await api(`ocorrencias/${ocorrencia.id}`));
const campanha = (await api('campanhas')).campanhas.find((c) =>
  c.titulo.startsWith('Onda de calor'),
);
const campanhaFicha = campanha && (await api(`campanhas/${campanha.id}`));
const passagens = (await api('passagens?estado=pendentes')).itens ?? [];
const passagem = passagens.find((p) => /muro de vedação/i.test(p.resumo ?? ''));

for (const [nome, o] of Object.entries({ processo, ocorrencia, campanha, passagem })) {
  if (!o) throw new Error(`Não encontrei ${nome}: a demonstração está preparada?`);
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

mkdirSync(SAIDA, { recursive: true });
const browser = await chromium.launch({
  executablePath: chrome(),
  args: ['--no-sandbox'],
});
const contexto = await browser.newContext({
  viewport: { width: LARGURA, height: ALTURA },
  deviceScaleFactor: 2,
  timezoneId: 'Europe/Lisbon',
  locale: 'pt-PT',
});
await contexto.addInitScript(
  ([token, municipio]) => {
    try {
      localStorage.setItem('toucamara.token', token);
      localStorage.setItem('toucamara.municipio', municipio);
    } catch {
      /* sem localStorage */
    }
  },
  [TOKEN, MUNICIPIO],
);
const pagina = await contexto.newPage();
const capturas = {};

async function ir(caminho, espera = 'networkidle') {
  // O "Ao vivo" fica sempre à escuta: aí basta a página carregada.
  await pagina.goto(WEB + caminho, { waitUntil: espera, timeout: 180_000 });
  await pagina.addStyleTag({
    content:
      'nextjs-portal{display:none!important} *{scrollbar-width:none!important} ::-webkit-scrollbar{display:none!important}',
  });
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForTimeout(900);
}

/** Retângulo (px CSS da página) da primeira secção que começa com o texto. */
async function seccao(texto) {
  return pagina.evaluate((t) => {
    const s = [...document.querySelectorAll('main section')].find((e) =>
      (e.textContent ?? '').trim().startsWith(t),
    );
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  }, texto);
}

/** Retângulo do elemento mais pequeno que contém o texto, subindo `subir` níveis. */
async function elemento(texto, subir = 0) {
  return pagina.evaluate(
    ([t, n]) => {
      const todos = [...document.querySelectorAll('main *')].filter((e) =>
        (e.textContent ?? '').includes(t),
      );
      let e = todos.at(-1);
      if (!e) return null;
      for (let i = 0; i < n && e.parentElement; i++) e = e.parentElement;
      const r = e.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    },
    [texto, subir],
  );
}

/**
 * Guarda a captura e as zonas. `proibidas`: o que nunca pode aparecer no
 * vídeo (resultados do teste de qualidade de demonstração, avisos de que a
 * IA ou o armazenamento não estão ligados nesta instalação local): o render
 * falha se uma câmara lhes tocar.
 */
async function guardar(nome, zonas, { inteira = false, proibidas = [] } = {}) {
  const ficheiro = `${nome}.jpg`;
  await pagina.screenshot({
    path: join(SAIDA, ficheiro),
    type: 'jpeg',
    quality: 90,
    fullPage: inteira,
  });
  const altura = inteira
    ? await pagina.evaluate(() => document.documentElement.scrollHeight)
    : ALTURA;
  const limpas = Object.fromEntries(
    Object.entries(zonas).filter(([, r]) => r && r.w > 0 && r.h > 0),
  );
  for (const k of Object.keys(zonas)) {
    if (!limpas[k]) console.warn(`  aviso: zona "${k}" não encontrada em ${nome}`);
  }
  capturas[nome] = {
    ficheiro,
    largura: LARGURA,
    altura,
    zonas: limpas,
    proibidas: proibidas.filter((r) => r && r.w > 0 && r.h > 0),
  };
  console.log(`${ficheiro} (${LARGURA}×${altura})`);
}

/** Captura de um só elemento (uma linha de uma lista, um cartão). */
async function recorte(nome, localizador) {
  const ficheiro = `${nome}.jpg`;
  await localizador.scrollIntoViewIfNeeded();
  const caixa = await localizador.boundingBox();
  if (!caixa) throw new Error(`Recorte ${nome}: elemento não encontrado`);
  await localizador.screenshot({ path: join(SAIDA, ficheiro), type: 'jpeg', quality: 92 });
  capturas[nome] = {
    ficheiro,
    largura: Math.round(caixa.width),
    altura: Math.round(caixa.height),
    zonas: {},
    proibidas: [],
  };
  console.log(`${ficheiro} (recorte ${Math.round(caixa.width)}×${Math.round(caixa.height)})`);
}

// 1. Visão geral (o cartão do teste de qualidade tem resultados de
// demonstração: nunca entra no vídeo)
await ir('/painel');
await guardar(
  'visao',
  {
    titulo: await seccao(`${visao.indicadores.conversas.valor} conversas`),
    atencao: await seccao('Precisa de atenção agora'),
    tratou: await seccao('O que o agente tratou'),
  },
  { inteira: true, proibidas: [await seccao('Teste de qualidade')] },
);

// 2. Entrada e a passagem a funcionário
await ir('/painel/entrada');
await guardar('entrada', {
  lista: await elemento('Tudo o que chega, num só sítio', 2),
  separadores: await elemento('Balcão', 1),
});
await ir(`/painel/passagens/${passagem.id}`);
await guardar('passagem', {
  caso: await elemento('O caso, resumido pelo agente', 2),
  titulo: await elemento('Pediu para falar com uma pessoa', 1),
});

// 3. Processo "Porta na cozinha" e o apoio ao técnico
await ir(`/painel/processos/${processo.id}`);
await guardar(
  'processo',
  {
    topo: await elemento('Porta na cozinha · ', 2),
    etapas: await elemento('Apreciação técnica', 3),
    documentos: await elemento('Certidão permanente do registo predial', 4),
  },
  {
    inteira: true,
    proibidas: [await elemento('Sem armazenamento configurado')],
  },
);
await ir(`/painel/processos/${processo.id}/apoio`);
await guardar(
  'apoio',
  {
    verificacoes: await elemento('Documentos esperados', 3),
    documentos: await elemento('Faltam 2 elementos', 2),
  },
  {
    inteira: true,
    proibidas: [
      await elemento('O assistente de IA não está ligado', 1),
      await elemento('Técnico inscrito na Ordem', 2),
      await elemento('Leitura do projeto pela IA', 2),
      await elemento('Novo rascunho', 3),
      await elemento('O resumo precisa da IA', 1),
    ],
  },
);
// No vídeo, o apoio ao técnico mostra-se por recortes: as verificações
// automáticas que passaram e a primeira regra aplicável (entre elas há as
// que dependem da IA, que nesta instalação não está ligada).
const linha = (texto) => pagina.locator('main li').filter({ hasText: texto }).first();
await recorte('apoio_documentos', linha('Documentos esperados'));
await recorte('apoio_termo', linha('Termo de responsabilidade válido'));
await recorte('apoio_pdm', linha('Sem condicionantes do PDM'));
// A regra que responde ao caso (abrir uma porta numa parede interior);
// se não estiver na lista, a primeira.
const regras = pagina
  .locator('main section', { hasText: 'Regras aplicáveis' })
  .locator('ol > li');
const regraDoCaso = regras.filter({ hasText: /porta numa parede interior/i }).first();
await recorte(
  'apoio_regra',
  (await regraDoCaso.count()) ? regraDoCaso : regras.first(),
);

// 4. Ocorrências: o buraco reportado três vezes
await ir(`/painel/ocorrencias/${ocorrencia.id}`);
await guardar('ocorrencia', {
  mapa: await elemento('Leaflet', 4),
  ficha: await elemento('Voltar à lista', 2),
  avisos: await elemento('Também reportada por', 1),
});

// 5. Ação social: a campanha da onda de calor
await ir(`/painel/campanhas/${campanha.id}`);
await guardar(
  'campanha',
  {
    contagens: await seccao('Contactadas'),
    ajuda: await seccao('Precisam de ajuda'),
    bem: await seccao('Estão bem'),
  },
  { inteira: true },
);

// 6. A chamada (simulada) no "Ao vivo": uma captura por fala, no fim (cria
// uma conversa simulada, que já não entra nos números acima).
const FALAS = [
  ['agente', 'Em que posso ajudar?'],
  ['municipe', 'Preciso de licença por causa do barulho?'],
  ['agente', 'Posso tratar disso já. Qual é a morada?'],
  ['municipe', 'Pode falar com a minha filha?'],
  ['agente', 'Posso mandar um SMS à sua filha'],
  ['municipe', 'Chama-se Ana.'],
  ['agente', 'Mandei um SMS para a sua filha'],
  ['municipe', 'E quanto é que isso custa?'],
  ['agente', 'a licença ficou emitida e segue por SMS'],
];
await ir('/painel/ao-vivo', 'load');
await pagina.getByRole('button', { name: 'Simular chamada' }).click();
const falas = [];
for (const [i, [quem, excerto]] of FALAS.entries()) {
  const alvo = pagina.getByText(excerto, { exact: false }).last();
  await alvo.waitFor({ state: 'visible', timeout: 60_000 });
  await pagina.waitForTimeout(1200);
  const texto = (await alvo.evaluate((e) => e.textContent ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const nome = `chamada_${String(i + 1).padStart(2, '0')}`;
  // O balão da última fala (a câmara segue-o).
  const ultima = await alvo.evaluate((e) => {
    const r = (e.parentElement ?? e).getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });
  await guardar(
    nome,
    {
      ultima,
      conversa: await elemento('Chamada web', 3),
      ajuda: await elemento('Ajuda ao funcionário', 2),
      alerta: await elemento('Pessoa vulnerável', 1),
    },
    { proibidas: [await elemento('O assistente de IA não está configurado')] },
  );
  falas.push({ quem, texto, captura: nome });
}
const terminar = pagina.getByRole('button', { name: /Terminar a simulação/ });
if (await terminar.isVisible().catch(() => false)) await terminar.click();
await browser.close();

// ---------------------------------------------------------------------------
// Os números da narração
// ---------------------------------------------------------------------------

const ind = visao.indicadores;
const semana = visao.trabalho_semana;
const cont = campanhaFicha.contagens;
const dados = {
  gerado_em: new Date().toISOString(),
  visao: {
    conversas: ind.conversas.valor,
    fora_de_horas_pct: Math.round(ind.fora_de_horas_pct.valor),
    resolvidas_pct: Math.round(ind.resolvidas_sem_humano_pct.valor),
    passadas: ind.passadas.valor,
    ocorrencias: semana.ocorrencias_agente,
    requerimentos: semana.requerimentos,
    consultas: semana.consultas_processo,
    marcacoes: semana.marcacoes,
    referencias: semana.referencias_mb,
  },
  processo: {
    numero: processoFicha.numero,
    requerente: (processoFicha.municipe?.nome ?? 'Sandra').split(' ')[0],
    verificados: processoFicha.documentos_resumo.tem.length,
    faltam: processoFicha.documentos_resumo.faltam.length,
  },
  ocorrencia: {
    numero: ocorrenciaFicha.numero,
    avisos: 1 + (ocorrenciaFicha.duplicados?.length ?? 0),
  },
  campanha: {
    total: campanhaFicha.total,
    bem: cont.bem,
    ajuda: cont.precisa_ajuda,
    sem_resposta: cont.nao_atendeu + cont.sem_ligacao + cont.recusou,
    tratados: campanhaFicha.destinatarios.filter(
      (d) => d.estado === 'precisa_ajuda' && d.tratado_em,
    ).length,
  },
  falas,
  capturas,
};
writeFileSync(
  join(RAIZ, 'src', 'dados.gerado.json'),
  `${JSON.stringify(dados, null, 2)}\n`,
);
console.log('src/dados.gerado.json');
