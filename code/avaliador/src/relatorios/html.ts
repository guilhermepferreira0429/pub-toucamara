/*
 * HTML autónomo dos relatórios: CSS inline, capturas embebidas, nada externo
 * (abre offline, manda-se por email, imprime-se em PDF com o Playwright).
 * Identidade do produto: terracota, fundo creme, texto azul-escuro; tom
 * simples, para quem decide numa câmara, não para engenheiros.
 */
import type { ResumoNumeros } from '../juiz/numeros.js';
import type { Veredicto } from '../tipos.js';
import {
  ehCerta,
  numerosSemFonte,
  porCategoria,
  taxa,
  TITULO_EXEMPLO,
  type Divergencias,
  type ExecucaoRel,
  type Par,
  type RespostaRel,
  type TipoExemplo,
} from './agregar.js';

export const CORES = {
  terracota: '#C0603F',
  terracotaClaro: '#F3DDD2',
  creme: '#FAF5EC',
  cremeEscuro: '#F1E8D8',
  azul: '#1F2A44',
  azulSuave: '#55607A',
  verde: '#3C7A55',
  vermelho: '#A93A2F',
};

export function esc(t: string | null | undefined): string {
  return (t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pctPt(v: number | null): string {
  if (v === null) return '—';
  return `${v.toLocaleString('pt-PT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

export function dataPt(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function dataHoraPt(d: Date | string): string {
  return new Date(d).toLocaleString('pt-PT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const NOME_VEREDICTO: Record<Veredicto, string> = {
  certa: 'Certa',
  passada_bem: 'Passada a uma pessoa',
  errada: 'Errada',
  sem_resposta: 'Sem resposta',
};

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:${CORES.creme};color:${CORES.azul};font:15px/1.55 "Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif}
.pag{max-width:980px;margin:0 auto;padding:40px 32px 64px}
header{border-bottom:3px solid ${CORES.terracota};padding-bottom:18px;margin-bottom:28px}
.marca{color:${CORES.terracota};font-weight:700;letter-spacing:.02em}
h1{font-size:30px;margin:6px 0 4px;line-height:1.2}
h2{font-size:21px;margin:40px 0 12px;color:${CORES.azul};border-left:5px solid ${CORES.terracota};padding-left:10px}
h3{font-size:16px;margin:22px 0 8px}
.sub{color:${CORES.azulSuave}}
.cartoes{display:flex;flex-wrap:wrap;gap:14px}
.cartao{flex:1 1 200px;background:#fff;border-radius:12px;padding:16px 18px;border:1px solid ${CORES.cremeEscuro}}
.cartao.nosso{border:2px solid ${CORES.terracota}}
.cartao .nome{font-weight:600}
.cartao .taxa{font-size:38px;font-weight:700;color:${CORES.terracota};line-height:1.1;margin:6px 0}
.cartao .det{font-size:13px;color:${CORES.azulSuave}}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid ${CORES.cremeEscuro};vertical-align:top}
th{background:${CORES.cremeEscuro};font-weight:600;font-size:13px}
td.num,th.num{text-align:right;white-space:nowrap}
.caso{background:#fff;border-radius:12px;padding:16px 18px;margin:12px 0;border:1px solid ${CORES.cremeEscuro};page-break-inside:avoid}
.caso .q{font-weight:600;font-size:16px}
.caso .cat{font-size:12px;color:${CORES.azulSuave};text-transform:uppercase;letter-spacing:.04em}
.lado{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px}
.lado>div{flex:1 1 280px;min-width:0}
.rot{font-size:12px;font-weight:600;color:${CORES.azulSuave};margin-bottom:4px}
.txt{background:${CORES.creme};border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-wrap:break-word;font-size:14px}
.gab{background:${CORES.terracotaClaro}}
.tag{display:inline-block;font-size:12px;font-weight:600;border-radius:99px;padding:2px 10px;margin-left:6px}
.tag.ok{background:#DCEFE2;color:${CORES.verde}}
.tag.ko{background:#F6DAD5;color:${CORES.vermelho}}
.porque{font-size:13px;color:${CORES.azulSuave};margin-top:6px}
img.cap{max-width:100%;border:1px solid ${CORES.cremeEscuro};border-radius:8px;margin-top:8px}
.nota{font-size:13px;color:${CORES.azulSuave}}
ul.muda li{margin:6px 0}
footer{margin-top:48px;padding-top:14px;border-top:1px solid ${CORES.cremeEscuro};font-size:12.5px;color:${CORES.azulSuave}}
@media print{body{background:${CORES.creme};-webkit-print-color-adjust:exact;print-color-adjust:exact}.pag{padding:0 8px}}
`;

export function documento(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>${CSS}</style></head>
<body><div class="pag">${corpo}</div></body></html>`;
}

function tag(v: Veredicto): string {
  return `<span class="tag ${ehCerta(v) ? 'ok' : 'ko'}">${NOME_VEREDICTO[v]}</span>`;
}

/** Sem o código da regra: no relatório fala-se como pessoas. */
function porque(r: RespostaRel): string {
  const j = (r.justificacao ?? '').replace(/^\[[^\]]+\]\s*/, '');
  const partes: string[] = [];
  if (r.factos_errados.length)
    partes.push(`Informação errada: ${r.factos_errados.join('; ')}.`);
  if (r.factos_em_falta.length && !ehCerta(r.veredicto))
    partes.push(`Faltou: ${r.factos_em_falta.join('; ')}.`);
  if (j) partes.push(j);
  return partes.length
    ? `<div class="porque">${esc(partes.join(' '))}</div>`
    : '';
}

export function cartoesTaxas(execs: ExecucaoRel[]): string {
  return `<div class="cartoes">${execs
    .map((e) => {
      const t = taxa(e.respostas);
      return `<div class="cartao${e.nosso ? ' nosso' : ''}">
<div class="nome">${esc(e.sistema)}</div>
<div class="taxa">${pctPt(t.taxa)}</div>
<div class="det">${t.certas + t.passadas_bem} de ${t.total} certas${t.passadas_bem ? ` (${t.passadas_bem} passadas a uma pessoa)` : ''}<br>
${t.erradas} erradas · ${t.sem_resposta} sem resposta<br>${esc(textoNumeros(numerosSemFonte(e.respostas)))}<br>execução de ${dataPt(e.terminada_em ?? e.iniciada_em)}</div></div>`;
    })
    .join('')}</div>`;
}

/** "0 números sem fonte" ou "3 números sem fonte em 2 respostas (5%)". */
export function textoNumeros(n: ResumoNumeros): string {
  const nums = `${n.numeros_sem_fonte} ${n.numeros_sem_fonte === 1 ? 'número' : 'números'} sem fonte`;
  if (!n.com_numeros_sem_fonte) return nums;
  return `${nums} em ${n.com_numeros_sem_fonte} ${n.com_numeros_sem_fonte === 1 ? 'resposta' : 'respostas'} (${pctPt(n.percentagem)})`;
}

export function tabelaCategorias(execs: ExecucaoRel[]): string {
  const cats = [...porCategoria(execs.flatMap((e) => e.respostas)).keys()];
  const porExec = execs.map((e) => porCategoria(e.respostas));
  return `<table><thead><tr><th>Tema</th>${execs
    .map((e) => `<th class="num">${esc(e.sistema)}</th>`)
    .join('')}</tr></thead><tbody>${cats
    .map(
      (c) =>
        `<tr><td>${esc(c)}</td>${porExec
          .map((m) => {
            const t = m.get(c);
            return `<td class="num">${t ? `${pctPt(t.taxa)} <span class="nota">(${t.certas + t.passadas_bem}/${t.total})</span>` : '—'}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

function blocoResposta(
  rotulo: string,
  r: RespostaRel,
  capturas: Map<string, string>,
): string {
  const cap = r.captura_key ? capturas.get(r.captura_key) : undefined;
  return `<div><div class="rot">${esc(rotulo)} ${tag(r.veredicto)}</div>
<div class="txt">${esc(r.texto?.trim() || '(sem texto)')}</div>${porque(r)}
${cap ? `<img class="cap" alt="Captura de ecrã de ${esc(rotulo)}" src="${cap}"><div class="nota">Captura de ${dataHoraPt(r.respondida_em)}</div>` : r.captura_key ? '<div class="nota">(captura em falta)</div>' : ''}</div>`;
}

export function caso(
  p: Par,
  nomes: { nos: string; outro: string },
  capturas: Map<string, string>,
): string {
  return `<div class="caso"><div class="cat">${esc(p.nos.categoria)}</div>
<div class="q">"${esc(p.nos.pergunta)}"</div>
${p.nos.gabarito_resposta ? `<div class="rot" style="margin-top:10px">Resposta certa (gabarito revisto)</div><div class="txt gab">${esc(p.nos.gabarito_resposta)}</div>` : ''}
<div class="lado">${blocoResposta(nomes.outro, p.outro, capturas)}${blocoResposta(nomes.nos, p.nos, capturas)}</div></div>`;
}

export function listaCasos(
  pares: Par[],
  nomes: { nos: string; outro: string },
  capturas: Map<string, string>,
): string {
  return pares.length
    ? pares.map((p) => caso(p, nomes, capturas)).join('')
    : '<p class="nota">Nenhuma.</p>';
}

export function seccaoDivergencias(
  nos: ExecucaoRel,
  outro: ExecucaoRel,
  d: Divergencias,
  capturas: Map<string, string>,
): string {
  const nomes = { nos: nos.sistema, outro: outro.sistema };
  const lista = (pares: Par[]) => listaCasos(pares, nomes, capturas);
  return `<h3>${esc(nos.sistema)} acertou e ${esc(outro.sistema)} não (${d.nosGanhamos.length})</h3>${lista(d.nosGanhamos)}
<h3>${esc(outro.sistema)} acertou e ${esc(nos.sistema)} não (${d.outroGanha.length})</h3>${lista(d.outroGanha)}`;
}

export function seccaoExemplos(
  grupos: { tipo: TipoExemplo; pares: Par[] }[],
  nomes: { nos: string; outro: string },
  capturas: Map<string, string>,
): string {
  if (!grupos.length)
    return '<p class="nota">Não há perguntas em que o assistente atual falhe e o Tou, Câmara? acerte.</p>';
  return grupos
    .map(
      (g) =>
        `<h3>${esc(TITULO_EXEMPLO[g.tipo])}</h3>${g.pares.map((p) => caso(p, nomes, capturas)).join('')}`,
    )
    .join('');
}

export function seccaoCalibracao(
  c: { n: number; acordo: number | null; kappa: number | null } | null,
  leitura: string,
): string {
  if (!c || !c.n)
    return '<p class="nota">Ainda sem calibração: nenhuma destas respostas foi também avaliada por uma pessoa.</p>';
  return `<p>Uma pessoa da equipa avaliou ${c.n} destas respostas sem saber o veredicto do juiz nem o sistema. Juiz e pessoa concordaram em <b>${pctPt(c.acordo)}</b> dos casos (kappa de Cohen ${c.kappa!.toFixed(2).replace('.', ',')}: concordância ${esc(leitura)}). Quando discordam, conta a avaliação da pessoa.</p>`;
}

export function rodape(info: {
  rubricas: string[];
  agentes: string[];
  geradoEm: Date;
}): string {
  return `<footer>
<p><b>Como medimos.</b> Todos os assistentes recebem as mesmas perguntas, como um munícipe as faria, cada uma numa conversa nova. Cada resposta é comparada com uma resposta de referência escrita a partir das fontes oficiais e revista por uma pessoa. Um avaliador automático, que não sabe que assistente está a avaliar, descreve a resposta; regras fixas e iguais para todos decidem se está certa. Uma resposta errada inclui informação errada, falta do essencial, "contacte-nos" em vez de responder, ou não mandar ligar 112 numa emergência. Passar a uma pessoa numa pergunta difícil conta como certo. Taxa = respostas certas ÷ respostas avaliadas.</p>
<p>Rubrica ${esc(info.rubricas.join(', ') || '—')} · agente ${esc(info.agentes.join(', ') || '—')} · gerado em ${dataHoraPt(info.geradoEm)}.</p>
</footer>`;
}
