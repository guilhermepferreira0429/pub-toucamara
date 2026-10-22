/*
 * O comando `npm run verificar-projetos` (V4 #2): a leitura de projetos pela
 * IA contra os 8 projetos de demonstração (e PDF passados por argumento), com
 * a tabela de acerto. A lógica fica aqui para se testar sem IA; o script em
 * `src/scripts/verificar-projetos.ts` só chama `principal`.
 */
import { z } from 'zod';
import { PERFIS, Perfil } from './perfis-verificacao.js';
import {
  avaliar,
  CasoAvaliacao,
  casosDemonstracao,
  ClienteLeitura,
  esquemaEsperado,
  Relatorio,
  relatorioMarkdown,
  resumir,
  tabelaTexto,
} from './avaliacao-projetos.js';
import type { MimeVisao } from '../../ia/visao.service.js';

export const AJUDA = `Uso: npm run verificar-projetos -- [opções] [projeto.pdf ...]

Corre a leitura de projetos pela IA (o mesmo pedido das verificações do
apoio ao técnico) sobre os 8 projetos de demonstração, um por tipo de
operação, e compara com os números que estão nos desenhos.

Opções:
  --digitalizado        corre também os projetos digitalizados (só imagem,
                        sem texto; precisa do pdftoppm, do poppler-utils)
  --so <perfis>         só estes tipos de operação (ex.: --so piscina,muro)
  --sem-demonstracao    só os PDF passados por argumento
  --perfil <perfil>     tipo de operação dos PDF passados por argumento
                        (${PERFIS.join(', ')})
  --saida <caminho>     pasta ou ficheiro base do relatório
                        (por omissão: docs/avaliacao/verificar-projetos-AAAA-MM-DD)

Um PDF de fora pode ter gabarito em <ficheiro>.esperado.json, por exemplo:
  {"perfil": "piscina", "medicoes": {"area_obra_m2": 32, "afastamento_extremas_m": 1.5},
   "elementos": {"casa_maquinas": "sim"}, "tecnico": {"nome": "Inês Carvalho", "numero": "34567"}}
Sem gabarito, mostra só o que a IA leu.

Código de saída: 0 sem números inventados; 1 se a IA inventou algum número
ou nenhum caso correu; 2 sem ANTHROPIC_API_KEY.`;

export const SEM_CHAVE = `Falta a chave da IA: este comando lê os projetos com o Claude a sério.

Para correr:
  1. Ponha a chave no ambiente (nunca no git):
       export ANTHROPIC_API_KEY=sk-ant-...
     (opcional) o modelo: export ANTHROPIC_MODEL=claude-sonnet-5-5
  2. Na pasta code/api:
       npm run verificar-projetos
     ou, com os projetos digitalizados também:
       npm run verificar-projetos -- --digitalizado
  3. O relatório fica em docs/avaliacao/ (JSON e Markdown) e a tabela de
     acerto sai no terminal.

São 8 pedidos à IA (16 com --digitalizado), um por projeto, com 2 a 4
documentos de poucas páginas cada.`;

export interface Argumentos {
  digitalizado: boolean;
  so: Perfil[] | null;
  demonstracao: boolean;
  perfil: Perfil | null;
  saida: string | null;
  ficheiros: string[];
  ajuda: boolean;
}

export function lerArgumentos(argv: string[]): Argumentos {
  const r: Argumentos = {
    digitalizado: false,
    so: null,
    demonstracao: true,
    perfil: null,
    saida: null,
    ficheiros: [],
    ajuda: false,
  };
  const perfil = (x: string | undefined): Perfil => {
    const p = (x ?? '').trim();
    if (!(PERFIS as readonly string[]).includes(p)) {
      throw new Error(
        `Tipo de operação desconhecido: "${p}". Use um de: ${PERFIS.join(', ')}.`,
      );
    }
    return p as Perfil;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--digitalizado') r.digitalizado = true;
    else if (a === '--sem-demonstracao') r.demonstracao = false;
    else if (a === '--so') r.so = (argv[++i] ?? '').split(',').map(perfil);
    else if (a === '--perfil') r.perfil = perfil(argv[++i]);
    else if (a === '--saida') r.saida = argv[++i] ?? null;
    else if (a === '--ajuda' || a === '--help' || a === '-h') r.ajuda = true;
    else if (a.startsWith('--')) throw new Error(`Opção desconhecida: ${a}`);
    else r.ficheiros.push(a);
  }
  return r;
}

/** O gabarito de um PDF de fora (<ficheiro>.esperado.json), com o perfil. */
export const esquemaGabaritoFicheiro = esquemaEsperado.extend({
  perfil: z.enum(PERFIS).optional(),
});

const MIMES: Record<string, MimeVisao> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** O que o comando precisa de fora (ficheiros, IA, relógio): nos testes, falsos. */
export interface Dependencias {
  env: Record<string, string | undefined>;
  /** Cria o cliente da IA (só se chama com a chave). */
  cliente: (env: Record<string, string | undefined>) => ClienteLeitura;
  ler: (caminho: string) => Promise<Buffer>;
  existe: (caminho: string) => Promise<boolean>;
  escrever: (caminho: string, conteudo: string) => Promise<void>;
  /** Pasta por omissão do relatório (docs/avaliacao). */
  pasta_relatorios: string;
  digitalizar?: (pdf: Buffer) => Promise<Buffer>;
  log: (t: string) => void;
  erro: (t: string) => void;
  agora: () => Date;
}

async function casoDeFicheiro(
  caminho: string,
  perfilPorOmissao: Perfil | null,
  d: Dependencias,
): Promise<CasoAvaliacao> {
  const ext = (/\.([a-z0-9]+)$/i.exec(caminho)?.[1] ?? '').toLowerCase();
  const mime = MIMES[ext];
  if (!mime) {
    throw new Error(`${caminho}: só PDF ou imagens (png, jpg, webp).`);
  }
  let gabarito: z.output<typeof esquemaGabaritoFicheiro> | null = null;
  const lateral = `${caminho}.esperado.json`;
  if (await d.existe(lateral)) {
    const json: unknown = JSON.parse((await d.ler(lateral)).toString('utf8'));
    const p = esquemaGabaritoFicheiro.safeParse(json);
    if (!p.success) {
      throw new Error(`${lateral}: gabarito inválido (${p.error.message}).`);
    }
    gabarito = p.data;
  }
  const nome = caminho.split(/[\\/]/).pop() ?? caminho;
  const { perfil: perfilGabarito, ...esperado } = gabarito ?? {};
  return {
    chave: nome,
    perfil: perfilGabarito ?? perfilPorOmissao,
    titulo: nome,
    tipo: 'Comunicação prévia',
    assunto: nome.replace(/\.[^.]+$/, ''),
    descricao: '',
    documentos: [
      {
        nome: `Projeto de arquitetura (${nome})`,
        mime,
        ficheiro: () => d.ler(caminho),
        projeto: true,
      },
    ],
    esperado: gabarito ? esquemaEsperado.parse(esperado) : null,
  };
}

/** Os caminhos do JSON e do Markdown. */
export function caminhosSaida(
  saida: string | null,
  pasta: string,
  hoje: Date,
): { json: string; md: string } {
  const dia = hoje.toISOString().slice(0, 10);
  let base: string;
  if (!saida) base = `${pasta}/verificar-projetos-${dia}`;
  else if (/\.(json|md)$/i.test(saida))
    base = saida.replace(/\.(json|md)$/i, '');
  else base = `${saida.replace(/[\\/]+$/, '')}/verificar-projetos-${dia}`;
  return { json: `${base}.json`, md: `${base}.md` };
}

/** Corre o comando; devolve o código de saída. */
export async function principal(
  argv: string[],
  d: Dependencias,
): Promise<number> {
  let args: Argumentos;
  try {
    args = lerArgumentos(argv);
  } catch (e) {
    d.erro(`${(e as Error).message}\n\n${AJUDA}`);
    return 2;
  }
  if (args.ajuda) {
    d.log(AJUDA);
    return 0;
  }
  if (!d.env.ANTHROPIC_API_KEY?.trim()) {
    d.erro(SEM_CHAVE);
    return 2;
  }
  if (args.digitalizado && !d.digitalizar) {
    d.erro(
      'Para --digitalizado é preciso o pdftoppm (poppler-utils) instalado.',
    );
    return 2;
  }

  const casos: CasoAvaliacao[] = [];
  if (args.demonstracao) {
    casos.push(
      ...casosDemonstracao().filter(
        (c) => !args.so || (c.perfil && args.so.includes(c.perfil)),
      ),
    );
  }
  try {
    for (const f of args.ficheiros) {
      casos.push(await casoDeFicheiro(f, args.perfil, d));
    }
  } catch (e) {
    d.erro((e as Error).message);
    return 2;
  }
  if (!casos.length) {
    d.erro('Nada para avaliar.');
    return 2;
  }

  const cliente = d.cliente(d.env);
  const modelo = d.env.ANTHROPIC_MODEL || null;
  const aoTerminarCaso = (r: Relatorio['casos'][number]) => {
    const certos = r.linhas.filter((l) => l.resultado === 'certo').length;
    d.log(
      `${r.erro ? '✕' : '✓'} ${r.caso} (${r.segundos} s)${r.linhas.length ? `: ${certos}/${r.linhas.length} certos` : ''}${r.erro ? ` · ${r.erro}` : ''}`,
    );
  };
  d.log(
    `A ler ${casos.length} projeto(s)${args.digitalizado ? ' e as versões digitalizadas' : ''}${modelo ? ` com ${modelo}` : ''}…`,
  );
  const normal = await avaliar(casos, cliente, {
    modelo,
    agora: d.agora,
    aoTerminarCaso,
  });
  let relatorio = normal;
  if (args.digitalizado && d.digitalizar) {
    const dig = await avaliar(casos, cliente, {
      modelo,
      agora: d.agora,
      digitalizar: d.digitalizar,
      aoTerminarCaso,
    });
    relatorio = resumir([...normal.casos, ...dig.casos], {
      gerado_em: normal.gerado_em,
      modelo,
    });
  }

  d.log('');
  d.log(tabelaTexto(relatorio));
  const saida = caminhosSaida(args.saida, d.pasta_relatorios, d.agora());
  await d.escrever(saida.json, `${JSON.stringify(relatorio, null, 2)}\n`);
  await d.escrever(saida.md, relatorioMarkdown(relatorio));
  d.log('');
  d.log(`Relatório: ${saida.md} (e ${saida.json})`);

  const correram = relatorio.casos.filter((c) => !c.erro).length;
  if (!correram) return 1;
  return relatorio.total.inventado > 0 ? 1 : 0;
}
