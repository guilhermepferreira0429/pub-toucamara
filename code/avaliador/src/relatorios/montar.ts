/*
 * Montagem dos três relatórios a partir de dados já carregados (sem BD nem
 * ficheiros): fácil de testar e de rever.
 */
import { lerKappa } from '../calibracao/amostra.js';
import {
  divergencias,
  escolherExemplos,
  numerosSemFonte,
  oQueMuda,
  perguntasComuns,
  soComuns,
  taxa,
  type ExecucaoRel,
} from './agregar.js';
import {
  cartoesTaxas,
  dataPt,
  documento,
  esc,
  listaCasos,
  pctPt,
  rodape,
  seccaoCalibracao,
  seccaoDivergencias,
  seccaoExemplos,
  tabelaCategorias,
} from './html.js';

export interface Calib {
  n: number;
  acordo: number | null;
  kappa: number | null;
}

function info(execs: ExecucaoRel[], geradoEm: Date) {
  return {
    rubricas: [
      ...new Set(
        execs.flatMap((e) => e.respostas.map((r) => r.rubrica_versao)),
      ),
    ].sort(),
    agentes: [
      ...new Set(
        execs.map((e) => e.agente_versao).filter((v): v is string => !!v),
      ),
    ],
    geradoEm,
  };
}

/** A execução "nossa" de referência: a primeira nossa, ou a primeira pedida. */
function referencia(execs: ExecucaoRel[]): ExecucaoRel {
  return execs.find((e) => e.nosso) ?? execs[0];
}

function avisoFora(originais: ExecucaoRel[], comuns: number): string {
  const linhas = originais
    .map((e) => {
      const fora = e.respostas.length - comuns;
      const extra = [
        fora ? `${fora} fora por não serem comuns` : '',
        e.porResponder
          ? `${e.porResponder} por responder (erro do sistema)`
          : '',
        e.porAvaliar ? `${e.porAvaliar} por avaliar` : '',
      ].filter(Boolean);
      return extra.length ? `${esc(e.sistema)}: ${extra.join(', ')}` : '';
    })
    .filter(Boolean);
  return linhas.length
    ? `<p class="nota">Só contam as perguntas respondidas e avaliadas em todos os sistemas. ${linhas.join(' · ')}.</p>`
    : '';
}

export function montarComparacao(
  originais: ExecucaoRel[],
  opts: {
    capturas: Map<string, string>;
    calibracao: Calib | null;
    geradoEm: Date;
  },
): { html: string; comuns: number } {
  const comunsSet = perguntasComuns(originais);
  const execs = originais.map((e) => soComuns(e, comunsSet));
  const nos = referencia(execs);
  const outros = execs.filter((e) => e !== nos);
  const titulo = `Comparação · ${execs.map((e) => e.sistema).join(' × ')}`;
  const corpo = `<header><div class="marca">Tou, Câmara? · avaliação</div>
<h1>${esc(titulo)}</h1>
<div class="sub">${comunsSet.size} perguntas iguais para todos · ${dataPt(opts.geradoEm)}</div></header>
<h2>Quantas acertam</h2>${cartoesTaxas(execs)}${avisoFora(originais, comunsSet.size)}
<h2>Por tema</h2>${tabelaCategorias(execs)}
${outros
  .map(
    (o) =>
      `<h2>Onde ${esc(nos.sistema)} e ${esc(o.sistema)} divergem</h2>${seccaoDivergencias(nos, o, divergencias(nos, o), opts.capturas)}`,
  )
  .join('')}
<h2>O avaliador automático é de confiança?</h2>${seccaoCalibracao(opts.calibracao, lerKappa(opts.calibracao?.kappa ?? null))}
${rodape(info(execs, opts.geradoEm))}`;
  return { html: documento(titulo, corpo), comuns: comunsSet.size };
}

export function montarAuditoria(
  originais: ExecucaoRel[],
  opts: {
    municipio: string;
    capturas: Map<string, string>;
    calibracao: Calib | null;
    geradoEm: Date;
  },
): string {
  const comunsSet = perguntasComuns(originais);
  const execs = originais.map((e) => soComuns(e, comunsSet));
  const nos = execs.find((e) => e.nosso);
  const atuais = execs.filter((e) => !e.nosso);
  if (!nos || !atuais.length)
    throw new Error(
      'A auditoria precisa de uma execução nossa e de pelo menos uma do assistente atual.',
    );
  const tn = taxa(nos.respostas);
  const titulo = `Auditoria ao atendimento · ${opts.municipio}`;
  const blocos = atuais.map((o) => {
    const d = divergencias(nos, o);
    const to = taxa(o.respostas);
    const nomes = { nos: nos.sistema, outro: o.sistema };
    return `<h2>${esc(o.sistema)}: o que acerta e o que falha</h2>
<p>Nas mesmas ${to.total} perguntas, o assistente atual acertou <b>${pctPt(to.taxa)}</b> e o Tou, Câmara? <b>${pctPt(tn.taxa)}</b>.
O assistente atual deu ${to.erradas} respostas erradas e ${to.sem_resposta} sem resposta.</p>
<h2>O que muda para o munícipe</h2><ul class="muda">${oQueMuda(nos, o, d)
      .map((f) => `<li>${esc(f)}</li>`)
      .join('')}</ul>
<h2>Exemplos</h2>${seccaoExemplos(escolherExemplos(d.nosGanhamos), nomes, opts.capturas)}
<h2>Onde nós falhámos</h2>${
      d.outroGanha.length
        ? `<p>Para ser justo: em ${d.outroGanha.length} ${d.outroGanha.length === 1 ? 'pergunta' : 'perguntas'} o assistente atual acertou e o Tou, Câmara? não.</p>` +
          listaCasos(d.outroGanha, nomes, opts.capturas)
        : '<p>Em nenhuma destas perguntas o assistente atual acertou e o Tou, Câmara? falhou.</p>'
    }`;
  });
  const corpo = `<header><div class="marca">Tou, Câmara?</div>
<h1>${esc(titulo)}</h1>
<div class="sub">${comunsSet.size} perguntas de munícipes, feitas ao assistente atual e ao Tou, Câmara? · ${dataPt(opts.geradoEm)}</div></header>
<h2>Em resumo</h2>${cartoesTaxas(execs)}${avisoFora(originais, comunsSet.size)}
<h2>Por tema</h2>${tabelaCategorias(execs)}
${blocos.join('')}
<h2>O avaliador automático é de confiança?</h2>${seccaoCalibracao(opts.calibracao, lerKappa(opts.calibracao?.kappa ?? null))}
${rodape(info(execs, opts.geradoEm))}`;
  return documento(titulo, corpo);
}

export interface LinhaPitch {
  sistema: string;
  nosso: boolean;
  execucao_id: string;
  taxa: number | null;
  perguntas: number;
  data: string;
  agente_versao: string | null;
  rubricas: string[];
  concordancia: Calib | null;
  /** Números ditos que não estão na pergunta nem no gabarito. */
  numeros_sem_fonte: number;
  /** % de respostas com pelo menos um número sem fonte. */
  respostas_com_numeros_sem_fonte: number | null;
}

export function linhaPitch(e: ExecucaoRel, calib: Calib | null): LinhaPitch {
  const t = taxa(e.respostas);
  const n = numerosSemFonte(e.respostas);
  return {
    sistema: e.sistema,
    nosso: e.nosso,
    execucao_id: e.id,
    taxa: t.taxa === null ? null : Math.round(t.taxa * 10) / 10,
    perguntas: t.total,
    data: new Date(e.terminada_em ?? e.iniciada_em).toISOString().slice(0, 10),
    agente_versao: e.agente_versao,
    rubricas: [...new Set(e.respostas.map((r) => r.rubrica_versao))].sort(),
    concordancia: calib && calib.n ? calib : null,
    numeros_sem_fonte: n.numeros_sem_fonte,
    respostas_com_numeros_sem_fonte: n.percentagem,
  };
}

/** Uma frase por sistema, pronta para o slide. */
export function textoPitch(linhas: LinhaPitch[], comuns: number): string {
  const ordenadas = [...linhas].sort(
    (a, b) =>
      Number(b.nosso) - Number(a.nosso) || (b.taxa ?? -1) - (a.taxa ?? -1),
  );
  const frases = ordenadas.map((l) => {
    const c = l.concordancia
      ? ` · juiz validado por uma pessoa: ${pctPt(l.concordancia.acordo)} de acordo (n=${l.concordancia.n})`
      : ' · juiz ainda sem calibração';
    const num = ` · ${l.numeros_sem_fonte} ${l.numeros_sem_fonte === 1 ? 'número inventado' : 'números inventados'}${l.numeros_sem_fonte ? ` (${pctPt(l.respostas_com_numeros_sem_fonte)} das respostas)` : ''}`;
    return `${l.sistema}: ${pctPt(l.taxa)} de ${l.perguntas} perguntas (${dataPt(l.data)})${num}${c}`;
  });
  const perguntas = new Set(linhas.map((l) => l.perguntas));
  if (
    linhas.length > 1 &&
    (perguntas.size > 1 || comuns < Math.max(...linhas.map((l) => l.perguntas)))
  )
    frases.push(
      `Atenção: as execuções não cobrem as mesmas perguntas (${comuns} comuns). Para comparar no slide, usar \`relatorio comparar\`.`,
    );
  return frases.join('\n');
}
