/*
 * Avaliação da leitura de projetos pela IA (V4 #2 · "testar a leitura do
 * projeto com o Claude real"). Corre o MESMO pedido das verificações
 * (`pedidoLeituraProjeto`) sobre projetos de demonstração cujos números
 * conhecemos (os PDF são gerados por nós) e compara o que a IA leu com o
 * gabarito, campo a campo e perfil a perfil.
 *
 * Tudo aqui é puro exceto o cliente da IA, que entra por parâmetro (nos
 * testes, um cliente falso). O comando é `npm run verificar-projetos`
 * (`src/scripts/verificar-projetos.ts`).
 *
 * Resultados por campo:
 * - certo: leu o valor esperado (com a tolerância das verificações) ou, num
 *   valor que não está nos desenhos, não pôs nada;
 * - errado: leu outro valor;
 * - em falta: não leu (ou o valor foi posto de parte pela validação). Não é
 *   grave: fica "por verificar" para o técnico;
 * - inventado: pôs um número que não está nos desenhos. É o pior erro.
 */
import { z } from 'zod';
import type { PedidoIa } from '../../ia/claude.service.js';
import type { MimeVisao } from '../../ia/visao.service.js';
import { analisarPdf } from './analise-pdf.js';
import {
  CODIGOS_ELEMENTO,
  CODIGOS_GRANDEZA,
  ELEMENTOS,
  Grandeza,
  GRANDEZAS,
  tolerancia,
  valorDito,
} from './medidas.js';
import {
  DEFINICOES,
  Perfil,
  PERFIS,
  pedidoDoPerfil,
} from './perfis-verificacao.js';
import {
  gerarProjetoDemonstracao,
  gerarTermoDemonstracao,
} from './projeto-demonstracao-pdf.js';
import {
  ChaveProjetoAvaliacao,
  gerarProjetoAvaliacao,
  gerarTermoAvaliacao,
  PROJETOS_AVALIACAO,
} from './projetos-avaliacao-pdf.js';
import {
  ficheiroProjetoPerfil,
  leituraDemo,
  PROCESSOS_PERFIS,
} from './projetos-perfis-pdf.js';
import {
  DocumentoLido,
  esquemaLeituraProjeto,
  FicheiroCandidato,
  interpretarLeitura,
  LeituraProjeto,
  pedidoLeituraProjeto,
  PROJETO,
  ResultadoLeitura,
  selecionarParaLeitura,
  TERMO,
} from './verificacoes.js';

// ---------------------------------------------------------------------------
// Gabarito
// ---------------------------------------------------------------------------

type SimNao = 'sim' | 'nao';

/** O que se espera que a IA leia num projeto. Campos ausentes não se avaliam. */
export const esquemaEsperado = z.object({
  /** Número esperado; null = NÃO está nos desenhos (a IA não pode pôr nada). */
  medicoes: z
    .partialRecord(z.enum(CODIGOS_GRANDEZA), z.number().nullable())
    .default({}),
  elementos: z
    .partialRecord(z.enum(CODIGOS_ELEMENTO), z.enum(['sim', 'nao']))
    .default({}),
  fachada: z.enum(['sim', 'nao']).optional(),
  paredes: z.enum(['sim', 'nao']).optional(),
  parede_nao_estrutural: z.boolean().optional(),
  estruturas: z.boolean().optional(),
  tecnico: z
    .object({ nome: z.string(), numero: z.string() })
    .nullable()
    .optional(),
  termo_assinado: z.boolean().optional(),
});
export type Esperado = z.output<typeof esquemaEsperado>;

export interface DocumentoCaso {
  nome: string;
  mime: MimeVisao;
  ficheiro: () => Promise<Buffer>;
  /** O projeto (desenhos): é o que se digitaliza na variante "digitalizado". */
  projeto: boolean;
}

export interface CasoAvaliacao {
  chave: string;
  perfil: Perfil | null;
  titulo: string;
  tipo: string;
  assunto: string;
  descricao: string;
  /** Pela ordem em que vão à IA (como nas verificações: peças do projeto e o termo no fim). */
  documentos: DocumentoCaso[];
  /** null: sem gabarito (um PDF de fora): só se mostra o que a IA leu. */
  esperado: Esperado | null;
}

/** O gabarito de um processo de demonstração a partir da leitura certa dele. */
export function esperadoDaLeitura(perfil: Perfil, l: LeituraProjeto): Esperado {
  const medicoes: Esperado['medicoes'] = {};
  for (const g of DEFINICOES[perfil].grandezas) medicoes[g] = null;
  for (const m of l.medicoes) {
    // As leituras de demonstração estão na unidade da grandeza.
    medicoes[m.grandeza] = m.valor;
  }
  const elementos: Esperado['elementos'] = {};
  for (const e of l.elementos) {
    if (e.resposta !== 'incerto') elementos[e.elemento] = e.resposta;
  }
  const t = l.tecnico_autor;
  return {
    medicoes,
    elementos,
    fachada:
      l.fachada_cobertura.alteracoes === 'incerto'
        ? undefined
        : l.fachada_cobertura.alteracoes,
    paredes:
      l.paredes.abertura_ou_demolicao === 'incerto'
        ? undefined
        : l.paredes.abertura_ou_demolicao,
    parede_nao_estrutural:
      l.paredes.abertura_ou_demolicao === 'sim'
        ? l.paredes.declarada_nao_estrutural
        : undefined,
    estruturas: l.planta_estruturas.existe,
    tecnico:
      t?.nome && t.numero_inscricao
        ? { nome: t.nome, numero: t.numero_inscricao }
        : null,
    termo_assinado: t?.termo_assinado ?? undefined,
  };
}

const pdf = (
  nome: string,
  ficheiro: () => Promise<Buffer>,
  projeto: boolean,
): DocumentoCaso => ({ nome, mime: 'application/pdf', ficheiro, projeto });

/** Os 3 processos da análise por tipo de operação (ampliação, piscina, muro). */
function casoDoProcesso(
  chave: 'ampliacao' | 'piscina' | 'muro',
): CasoAvaliacao {
  const p = PROCESSOS_PERFIS.find((x) => x.chave === chave)!;
  const pecas = p.documentos.filter(
    (d) => PROJETO.test(d.nome) && !TERMO.test(d.nome),
  );
  const termo = p.documentos.find((d) => TERMO.test(d.nome))!;
  const ler = (k: string) => async () => (await ficheiroProjetoPerfil(k))!;
  return {
    chave,
    perfil: chave,
    titulo: `CP ${p.numero} · ${p.assunto}`,
    tipo: 'Comunicação prévia',
    assunto: p.assunto,
    descricao: p.descricao,
    documentos: [
      ...pecas.map((d) =>
        pdf(d.nome, ler(d.ficheiro), d.nome === 'Projeto de arquitetura'),
      ),
      pdf(termo.nome, ler(termo.ficheiro), false),
    ],
    esperado: esperadoDaLeitura(chave, leituraDemo(chave)),
  };
}

/** Os 4 projetos novos (moradia nova, fachada, demolição, mudança de uso). */
function casoNovo(
  chave: ChaveProjetoAvaliacao,
  tipo: string,
  nomeProjeto: string,
  esperado: Omit<Esperado, 'tecnico' | 'termo_assinado'>,
): CasoAvaliacao {
  const p = PROJETOS_AVALIACAO[chave];
  return {
    chave,
    perfil: chave,
    titulo: p.assunto,
    tipo,
    assunto: p.assunto,
    descricao: p.descricao,
    documentos: [
      pdf(nomeProjeto, () => gerarProjetoAvaliacao(chave), true),
      pdf('Termo de responsabilidade', () => gerarTermoAvaliacao(chave), false),
    ],
    esperado: {
      ...esperado,
      tecnico: { nome: p.tecnico.nome, numero: p.tecnico.numero },
      termo_assinado: true,
    },
  };
}

/**
 * Os 8 projetos de demonstração, um por tipo de operação, com o gabarito.
 * A ordem é a de `PERFIS`.
 */
export function casosDemonstracao(): CasoAvaliacao[] {
  const casos: Record<Perfil, CasoAvaliacao> = {
    // O "CP 412 · Porta na cozinha" (o processo de demonstração do apoio ao técnico).
    interior: {
      chave: 'interior',
      perfil: 'interior',
      titulo: 'CP 412 · Porta na cozinha',
      tipo: 'Comunicação prévia',
      assunto: 'Porta na cozinha',
      descricao:
        'Abertura de um vão de porta em parede interior, entre a cozinha e a sala, e remodelação da cozinha, numa moradia unifamiliar.',
      documentos: [
        pdf('Projeto de arquitetura', gerarProjetoDemonstracao, true),
        pdf('Termo de responsabilidade', gerarTermoDemonstracao, false),
      ],
      esperado: {
        medicoes: {},
        elementos: {},
        fachada: 'nao',
        paredes: 'sim',
        parede_nao_estrutural: true,
        estruturas: false,
        tecnico: { nome: 'Joana Lima', numero: '12345' },
        termo_assinado: true,
      },
    },
    ampliacao: casoDoProcesso('ampliacao'),
    construcao_nova: casoNovo(
      'construcao_nova',
      'Licença de obras de edificação',
      'Projeto de arquitetura',
      {
        medicoes: {
          area_lote_m2: 600,
          area_implantacao_m2: 180,
          area_construcao_m2: 290,
          pisos: 2,
          cercea_m: 6.5,
          afastamento_extremas_m: 4,
          afastamento_frente_m: 6,
          lugares_estacionamento: 2,
        },
        elementos: {},
        estruturas: false,
      },
    ),
    piscina: casoDoProcesso('piscina'),
    muro: casoDoProcesso('muro'),
    fachada: casoNovo(
      'fachada',
      'Comunicação prévia',
      'Projeto de arquitetura',
      {
        // A cércea não está cotada: a IA não pode pôr um número.
        medicoes: { cercea_m: null },
        elementos: { materiais_cores: 'sim' },
        fachada: 'sim',
        paredes: 'nao',
        estruturas: false,
      },
    ),
    demolicao: casoNovo(
      'demolicao',
      'Licença de demolição',
      'Plano de demolição e peças desenhadas',
      {
        medicoes: {},
        elementos: { plano_demolicao: 'sim', amianto: 'sim' },
        paredes: 'sim',
        estruturas: false,
      },
    ),
    mudanca_uso: casoNovo(
      'mudanca_uso',
      'Licença de alteração de uso',
      'Projeto de arquitetura',
      {
        medicoes: { lugares_estacionamento: 1 },
        elementos: { acessibilidades: 'sim' },
        fachada: 'nao',
        paredes: 'nao',
        estruturas: false,
      },
    ),
  };
  return PERFIS.map((p) => casos[p]);
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

export const RESULTADOS_CAMPO = [
  'certo',
  'errado',
  'em_falta',
  'inventado',
] as const;
export type ResultadoCampo = (typeof RESULTADOS_CAMPO)[number];

export interface LinhaAvaliacao {
  caso: string;
  perfil: Perfil | null;
  /** 'medida:pisos', 'elemento:amianto', 'fachada', 'tecnico_numero'... */
  campo: string;
  rotulo: string;
  esperado: string;
  lido: string;
  resultado: ResultadoCampo;
  nota?: string;
}

const SIMNAO_DITO: Record<string, string> = {
  sim: 'sim',
  nao: 'não',
  incerto: 'incerto',
};
const bool = (b: boolean | null | undefined) =>
  b === null || b === undefined ? '—' : b ? 'sim' : 'não';

function semAcentos(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compara a leitura com o gabarito. `bruto` é a resposta da IA (validada ou
 * não); `interpretado` é o que as verificações usam (números já validados).
 */
export function compararLeitura(e: {
  caso: string;
  perfil: Perfil | null;
  esperado: Esperado;
  bruto: unknown;
  interpretado: ResultadoLeitura;
}): LinhaAvaliacao[] {
  const { esperado } = e;
  const p = esquemaLeituraProjeto.safeParse(e.bruto);
  const l = p.success && p.data.legivel ? p.data : null;
  const linhas: LinhaAvaliacao[] = [];
  const base = { caso: e.caso, perfil: e.perfil };
  const motivoSemLeitura = !p.success
    ? 'sem resposta válida da IA'
    : !p.data.legivel
      ? 'a IA disse que não se lê'
      : undefined;

  // Medidas: as do perfil (ausentes = não estão nos desenhos) e as do gabarito.
  const grandezas = new Set<Grandeza>([
    ...(e.perfil ? DEFINICOES[e.perfil].grandezas : []),
    ...(Object.keys(esperado.medicoes) as Grandeza[]),
  ]);
  for (const g of CODIGOS_GRANDEZA) {
    if (!grandezas.has(g)) continue;
    const esp = esperado.medicoes[g] ?? null;
    const lida = e.interpretado.medicoes?.find((x) => x.grandeza === g);
    const descartada = e.interpretado.descartadas?.find((d) =>
      d.startsWith(GRANDEZAS[g].rotulo),
    );
    const linha = {
      ...base,
      campo: `medida:${g}`,
      rotulo: GRANDEZAS[g].rotulo,
      esperado: esp === null ? 'não está nos desenhos' : valorDito(g, esp),
      lido: lida ? valorDito(g, lida.valor) : '—',
    };
    let resultado: ResultadoCampo;
    if (esp === null) resultado = lida ? 'inventado' : 'certo';
    else if (!lida) resultado = 'em_falta';
    else
      resultado =
        Math.abs(lida.valor - esp) <= tolerancia(g, esp) ? 'certo' : 'errado';
    linhas.push({
      ...linha,
      resultado,
      nota: descartada ?? (!lida ? motivoSemLeitura : undefined),
    });
  }

  // Elementos (sim/não).
  for (const el of CODIGOS_ELEMENTO) {
    const esp = esperado.elementos[el];
    if (!esp) continue;
    const r = e.interpretado.elementos?.find((x) => x.elemento === el);
    linhas.push({
      ...base,
      campo: `elemento:${el}`,
      rotulo: ELEMENTOS[el].rotulo,
      esperado: SIMNAO_DITO[esp],
      lido: r ? SIMNAO_DITO[r.resposta] : '—',
      resultado:
        !r || r.resposta === 'incerto'
          ? 'em_falta'
          : r.resposta === esp
            ? 'certo'
            : 'errado',
      nota: r?.descricao ?? motivoSemLeitura,
    });
  }

  // O que é geral a todos os projetos.
  const simNao = (
    campo: string,
    rotulo: string,
    esp: SimNao | undefined,
    lido: 'sim' | 'nao' | 'incerto' | undefined,
  ) => {
    if (!esp) return;
    linhas.push({
      ...base,
      campo,
      rotulo,
      esperado: SIMNAO_DITO[esp],
      lido: lido ? SIMNAO_DITO[lido] : '—',
      resultado:
        !lido || lido === 'incerto'
          ? 'em_falta'
          : lido === esp
            ? 'certo'
            : 'errado',
      nota: lido ? undefined : motivoSemLeitura,
    });
  };
  const booleano = (
    campo: string,
    rotulo: string,
    esp: boolean | undefined,
    lido: boolean | null | undefined,
  ) => {
    if (esp === undefined) return;
    linhas.push({
      ...base,
      campo,
      rotulo,
      esperado: bool(esp),
      lido: bool(lido),
      resultado:
        lido === null || lido === undefined
          ? 'em_falta'
          : lido === esp
            ? 'certo'
            : 'errado',
      nota: lido === undefined ? motivoSemLeitura : undefined,
    });
  };
  simNao(
    'fachada',
    'Altera a fachada ou a cobertura',
    esperado.fachada,
    l?.fachada_cobertura.alteracoes,
  );
  simNao(
    'paredes',
    'Abre ou demole paredes',
    esperado.paredes,
    l?.paredes.abertura_ou_demolicao,
  );
  booleano(
    'parede_nao_estrutural',
    'O projeto diz que a parede não é estrutural',
    esperado.parede_nao_estrutural,
    l?.paredes.declarada_nao_estrutural,
  );
  booleano(
    'estruturas',
    'Há planta de estruturas entre os documentos',
    esperado.estruturas,
    l?.planta_estruturas.existe,
  );
  if (esperado.tecnico !== undefined) {
    const t = l?.tecnico_autor ?? null;
    const espT = esperado.tecnico;
    const nomeLido = t?.nome ?? null;
    const numLido = t?.numero_inscricao ?? null;
    const digitos = (x: string | null) => (x ?? '').replace(/\D/g, '');
    linhas.push({
      ...base,
      campo: 'tecnico_nome',
      rotulo: 'Nome do técnico autor',
      esperado: espT?.nome ?? 'não aparece',
      lido: nomeLido ?? '—',
      resultado: !espT
        ? nomeLido
          ? 'inventado'
          : 'certo'
        : !nomeLido
          ? 'em_falta'
          : semAcentos(nomeLido).includes(semAcentos(espT.nome))
            ? 'certo'
            : 'errado',
      nota: l ? undefined : motivoSemLeitura,
    });
    linhas.push({
      ...base,
      campo: 'tecnico_numero',
      rotulo: 'N.º de inscrição na Ordem',
      esperado: espT?.numero ?? 'não aparece',
      lido: numLido ?? '—',
      resultado: !espT
        ? numLido
          ? 'inventado'
          : 'certo'
        : !numLido
          ? 'em_falta'
          : digitos(numLido) === digitos(espT.numero)
            ? 'certo'
            : 'errado',
      nota: l ? undefined : motivoSemLeitura,
    });
  }
  booleano(
    'termo_assinado',
    'Assinatura visível no termo',
    esperado.termo_assinado,
    l ? l.tecnico_autor?.termo_assinado : undefined,
  );
  return linhas;
}

// ---------------------------------------------------------------------------
// Correr
// ---------------------------------------------------------------------------

/** O que a avaliação precisa da IA (o `ClaudeService` serve; nos testes, um falso). */
export interface ClienteLeitura {
  extrair(
    esquema: typeof esquemaLeituraProjeto,
    pedido: PedidoIa,
  ): Promise<unknown>;
}

export interface ResultadoCaso {
  caso: string;
  titulo: string;
  perfil: Perfil | null;
  digitalizado: boolean;
  documentos: { nome: string; paginas: number | null; sem_texto: boolean }[];
  por_ler: string[];
  /** Números lidos pela IA e postos de parte pela validação. */
  descartadas: string[];
  /** O que a IA leu (já validado), para os casos sem gabarito. */
  lidas: { campo: string; valor: string }[];
  segundos: number;
  erro: string | null;
  linhas: LinhaAvaliacao[];
}

export interface Contagem {
  campos: number;
  certo: number;
  errado: number;
  em_falta: number;
  inventado: number;
  /** certo ÷ campos (0 a 1); null sem campos. */
  acerto: number | null;
}

export interface Relatorio {
  gerado_em: string;
  modelo: string | null;
  casos: ResultadoCaso[];
  total: Contagem;
  por_perfil: { perfil: string; contagem: Contagem }[];
  por_campo: { campo: string; rotulo: string; contagem: Contagem }[];
}

export interface OpcoesAvaliacao {
  /** Transforma o PDF do projeto antes de o mandar (ex.: digitalizar). */
  digitalizar?: (pdf: Buffer) => Promise<Buffer>;
  modelo?: string | null;
  agora?: () => Date;
  aoTerminarCaso?: (r: ResultadoCaso) => void;
}

function erroDito(e: unknown): string {
  if (e && typeof e === 'object') {
    const x = e as { codigo?: unknown; message?: unknown };
    const codigo = typeof x.codigo === 'string' ? `${x.codigo}: ` : '';
    return `${codigo}${typeof x.message === 'string' ? x.message : JSON.stringify(e)}`;
  }
  return typeof e === 'string' ? e : JSON.stringify(e);
}

export async function avaliarCaso(
  caso: CasoAvaliacao,
  cliente: ClienteLeitura,
  opcoes: OpcoesAvaliacao = {},
): Promise<ResultadoCaso> {
  const agora = opcoes.agora ?? (() => new Date());
  const digitalizado = Boolean(opcoes.digitalizar);
  const candidatos: FicheiroCandidato<{ doc: DocumentoCaso; buf: Buffer }>[] =
    [];
  for (const d of caso.documentos) {
    let buf = await d.ficheiro();
    if (opcoes.digitalizar && d.projeto && d.mime === 'application/pdf') {
      buf = await opcoes.digitalizar(buf);
    }
    candidatos.push({
      item: { doc: d, buf },
      nome: d.nome,
      mime: d.mime,
      tamanho: buf.length,
      analise: d.mime === 'application/pdf' ? analisarPdf(buf) : null,
    });
  }
  const sel = selecionarParaLeitura(candidatos);
  const usados = sel.usados;
  const docs: DocumentoLido[] = usados.map((u, i) => ({
    id: `doc${i + 1}`,
    nome: u.item.doc.nome,
    paginas: u.paginas,
    digitalizado: u.digitalizado,
  }));
  const pedido = pedidoLeituraProjeto({
    tipo: caso.tipo,
    assunto: caso.assunto,
    descricao: caso.descricao,
    ficheiros: usados.map((u) => ({
      nome: u.item.doc.nome,
      ficheiro: u.item.buf,
      mime: u.item.doc.mime,
      paginas: u.paginas,
      digitalizado: u.digitalizado,
    })),
    perfil: caso.perfil ? pedidoDoPerfil(caso.perfil) : null,
    por_ler: sel.por_ler,
  });
  const t0 = agora().getTime();
  let bruto: unknown = null;
  let erro: string | null = null;
  if (usados.length) {
    try {
      bruto = await cliente.extrair(esquemaLeituraProjeto, pedido);
    } catch (e) {
      erro = erroDito(e);
    }
  } else {
    erro = `Nenhum documento pôde seguir: ${sel.por_ler.join('; ')}`;
  }
  const segundos = Math.round((agora().getTime() - t0) / 100) / 10;
  const interpretado = interpretarLeitura(
    bruto,
    docs,
    caso.perfil ? DEFINICOES[caso.perfil].leitura : {},
  );
  if (!erro && !interpretado.lida) {
    erro = interpretado.depois[0]?.detalhe ?? 'Leitura inválida.';
  }
  return {
    caso: caso.chave + (digitalizado ? ' (digitalizado)' : ''),
    titulo: caso.titulo,
    perfil: caso.perfil,
    digitalizado,
    documentos: usados.map((u) => ({
      nome: u.item.doc.nome,
      paginas: u.paginas,
      sem_texto: u.digitalizado,
    })),
    por_ler: sel.por_ler,
    descartadas: interpretado.descartadas ?? [],
    lidas: [
      ...(interpretado.medicoes ?? []).map((m) => ({
        campo: GRANDEZAS[m.grandeza].rotulo,
        valor: valorDito(m.grandeza, m.valor),
      })),
      ...(interpretado.elementos ?? []).map((x) => ({
        campo: ELEMENTOS[x.elemento].rotulo,
        valor: SIMNAO_DITO[x.resposta],
      })),
    ],
    segundos,
    erro,
    linhas: caso.esperado
      ? compararLeitura({
          caso: caso.chave + (digitalizado ? ' (digitalizado)' : ''),
          perfil: caso.perfil,
          esperado: caso.esperado,
          bruto,
          interpretado,
        })
      : [],
  };
}

export function contar(linhas: LinhaAvaliacao[]): Contagem {
  const c: Contagem = {
    campos: linhas.length,
    certo: 0,
    errado: 0,
    em_falta: 0,
    inventado: 0,
    acerto: null,
  };
  for (const l of linhas) c[l.resultado]++;
  c.acerto = c.campos ? c.certo / c.campos : null;
  return c;
}

export function resumir(
  casos: ResultadoCaso[],
  extra: { gerado_em: string; modelo: string | null },
): Relatorio {
  const todas = casos.flatMap((c) => c.linhas);
  const perfis = [...new Set(casos.map((c) => c.caso))];
  const campos = [...new Set(todas.map((l) => l.campo))];
  return {
    ...extra,
    casos,
    total: contar(todas),
    por_perfil: perfis.map((p) => ({
      perfil: p,
      contagem: contar(
        casos.filter((c) => c.caso === p).flatMap((c) => c.linhas),
      ),
    })),
    por_campo: campos.map((campo) => {
      const ls = todas.filter((l) => l.campo === campo);
      return { campo, rotulo: ls[0].rotulo, contagem: contar(ls) };
    }),
  };
}

export async function avaliar(
  casos: CasoAvaliacao[],
  cliente: ClienteLeitura,
  opcoes: OpcoesAvaliacao = {},
): Promise<Relatorio> {
  const agora = opcoes.agora ?? (() => new Date());
  const resultados: ResultadoCaso[] = [];
  // Um de cada vez: não se pede tudo à IA ao mesmo tempo.
  for (const c of casos) {
    const r = await avaliarCaso(c, cliente, opcoes);
    resultados.push(r);
    opcoes.aoTerminarCaso?.(r);
  }
  return resumir(resultados, {
    gerado_em: agora().toISOString(),
    modelo: opcoes.modelo ?? null,
  });
}

// ---------------------------------------------------------------------------
// Mostrar
// ---------------------------------------------------------------------------

const pct = (x: number | null) =>
  x === null ? '—' : `${Math.round(x * 100)}%`;

function tabela(cabecalho: string[], linhas: string[][]): string {
  const larg = cabecalho.map((h, i) =>
    Math.max(h.length, ...linhas.map((l) => l[i].length)),
  );
  const fmt = (l: string[]) =>
    l
      .map((c, i) => (i === 0 ? c.padEnd(larg[i]) : c.padStart(larg[i])))
      .join('  ');
  return [
    fmt(cabecalho),
    larg.map((n) => '-'.repeat(n)).join('  '),
    ...linhas.map(fmt),
  ].join('\n');
}

const linhaContagem = (nome: string, c: Contagem) => [
  nome,
  String(c.campos),
  String(c.certo),
  String(c.errado),
  String(c.em_falta),
  String(c.inventado),
  pct(c.acerto),
];
const CABECALHO = [
  '',
  'campos',
  'certos',
  'errados',
  'em falta',
  'inventados',
  'acerto',
];

/** A tabela de acerto para o terminal (por perfil, por campo e o que falhou). */
export function tabelaTexto(r: Relatorio): string {
  const partes = [
    'Acerto por tipo de operação',
    tabela(CABECALHO, [
      ...r.por_perfil.map((p) => linhaContagem(p.perfil, p.contagem)),
      linhaContagem('TOTAL', r.total),
    ]),
    '',
    'Acerto por campo',
    tabela(
      CABECALHO,
      r.por_campo.map((c) => linhaContagem(c.rotulo, c.contagem)),
    ),
  ];
  // Os casos com erro aparecem em "Erros" (não se repete campo a campo).
  const falhas = r.casos
    .filter((c) => !c.erro)
    .flatMap((c) => c.linhas.filter((l) => l.resultado !== 'certo'));
  if (falhas.length) {
    partes.push(
      '',
      'O que não bateu certo',
      ...falhas.map(
        (l) =>
          `- [${l.resultado.replace('_', ' ')}] ${l.caso} · ${l.rotulo}: esperado ${l.esperado}, lido ${l.lido}${l.nota ? ` (${l.nota})` : ''}`,
      ),
    );
  }
  const erros = r.casos.filter((c) => c.erro);
  if (erros.length) {
    partes.push('', 'Erros', ...erros.map((c) => `- ${c.caso}: ${c.erro}`));
  }
  const semGabarito = r.casos.filter((c) => !c.linhas.length && !c.erro);
  for (const c of semGabarito) {
    partes.push(
      '',
      `${c.titulo} (sem gabarito: só o que a IA leu)`,
      ...(c.lidas.length
        ? c.lidas.map((x) => `- ${x.campo}: ${x.valor}`)
        : ['- nenhuma medida nem elemento']),
      ...c.descartadas.map((d) => `- posto de parte: ${d}`),
    );
  }
  return partes.join('\n');
}

const esc = (t: string) => t.replace(/\|/g, '\\|');

/** O relatório em Markdown (para `docs/avaliacao/`). */
export function relatorioMarkdown(r: Relatorio): string {
  const md = (cab: string[], ls: string[][]) =>
    [
      `| ${cab.join(' | ')} |`,
      `|${cab.map(() => '---').join('|')}|`,
      ...ls.map((l) => `| ${l.map(esc).join(' | ')} |`),
    ].join('\n');
  const cab = [
    '',
    'Campos',
    'Certos',
    'Errados',
    'Em falta',
    'Inventados',
    'Acerto',
  ];
  const partes = [
    '# Leitura de projetos pela IA: avaliação',
    '',
    `Gerado a ${r.gerado_em}${r.modelo ? ` com o modelo \`${r.modelo}\`` : ''} pelo comando \`npm run verificar-projetos\` (code/api).`,
    '',
    'Os projetos de demonstração são gerados por nós: os números esperados são os que estão escritos nos desenhos. **Em falta** fica "por verificar" para o técnico; **inventado** (um número que não está nos desenhos) é o erro grave. A leitura da IA nunca aprova nada: aponta, e o técnico confirma.',
    '',
    `**Total: ${pct(r.total.acerto)} certos** (${r.total.certo} de ${r.total.campos}), ${r.total.errado} errados, ${r.total.em_falta} em falta, ${r.total.inventado} inventados.`,
    '',
    '## Por tipo de operação',
    '',
    md(cab, [
      ...r.por_perfil.map((p) => linhaContagem(p.perfil, p.contagem)),
      linhaContagem('**Total**', r.total),
    ]),
    '',
    '## Por campo',
    '',
    md(
      cab,
      r.por_campo.map((c) => linhaContagem(c.rotulo, c.contagem)),
    ),
    '',
    '## Caso a caso',
  ];
  for (const c of r.casos) {
    partes.push(
      '',
      `### ${c.titulo}${c.digitalizado ? ' (digitalizado)' : ''}`,
      '',
      `Tipo de operação: ${c.perfil ? DEFINICOES[c.perfil].nome : 'sem perfil'} · ${c.segundos} s · documentos: ${c.documentos.map((d) => `${d.nome} (${d.paginas ?? '?'} pág.${d.sem_texto ? ', sem texto' : ''})`).join('; ') || 'nenhum'}`,
    );
    if (c.erro) partes.push('', `**Erro:** ${c.erro}`);
    if (c.por_ler.length) partes.push('', `Por ler: ${c.por_ler.join('; ')}`);
    if (c.linhas.length) {
      partes.push(
        '',
        md(
          ['Campo', 'Esperado', 'Lido', 'Resultado', 'Nota'],
          c.linhas.map((l) => [
            l.rotulo,
            l.esperado,
            l.lido,
            l.resultado === 'certo'
              ? 'certo'
              : `**${l.resultado.replace('_', ' ')}**`,
            l.nota ?? '',
          ]),
        ),
      );
    } else if (!c.erro) {
      partes.push(
        '',
        'Sem gabarito. O que a IA leu:',
        '',
        ...(c.lidas.length
          ? c.lidas.map((x) => `- ${x.campo}: ${x.valor}`)
          : ['- nenhuma medida nem elemento']),
      );
    }
    if (c.descartadas.length) {
      partes.push('', ...c.descartadas.map((d) => `- Posto de parte: ${d}`));
    }
  }
  return `${partes.join('\n')}\n`;
}
