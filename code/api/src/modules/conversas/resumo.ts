import { z } from 'zod';

/*
 * O que o job resumir_conversa pede ao Claude e as regras puras à volta
 * (transcrição para o modelo, escolha do tema, texto do SMS).
 */

export const RESULTADOS_IA = [
  'resolvida',
  'sem_resposta',
  'passada_funcionario',
  'marcacao',
] as const;

export const esquemaResumo = z.object({
  resumo: z
    .string()
    .describe(
      'Para o painel da câmara: 2 a 3 frases sobre o que o munícipe queria e o que ficou feito.',
    ),
  tema: z
    .string()
    .describe(
      'Nome exato de um dos temas da lista; se nenhum servir, um nome novo curto (2 a 5 palavras).',
    ),
  resultado: z
    .enum(RESULTADOS_IA)
    .describe(
      'resolvida: teve resposta ou ficou tratado; sem_resposta: o agente não soube responder; ' +
        'passada_funcionario: passou a um funcionário; marcacao: ficou uma marcação feita.',
    ),
  perguntas_sem_resposta: z
    .array(
      z.object({
        texto: z
          .string()
          .describe(
            'A pergunta em forma canónica, curta e sem dados pessoais (ex.: "Posso pintar a fachada de outra cor?").',
          ),
        turno: z
          .number()
          .int()
          .describe('Número [n] do turno do munícipe onde foi feita.'),
      }),
    )
    .describe(
      'Só perguntas do munícipe a que o agente não soube responder com fonte.',
    ),
  proximos_passos: z
    .array(z.string())
    .describe(
      'O que o munícipe tem de fazer a seguir, no máximo 4 passos curtos no imperativo. Vazio se não houver.',
    ),
  sms: z
    .string()
    .describe(
      'Resumo para SMS ao munícipe: no máximo 140 caracteres, sem saudações, sem link (é acrescentado depois).',
    ),
});

export type ResumoIa = z.infer<typeof esquemaResumo>;

/** Fixo (fica em cache): nada de datas, nomes de município nem ids aqui. */
export const SISTEMA_RESUMO = `És o assistente que, no fim de cada chamada para o atendimento de uma câmara municipal portuguesa, prepara o resumo da conversa entre o agente de voz e o munícipe.

Escreve sempre em português de Portugal, com frases simples e tratamento por "você" quando te diriges ao munícipe.

Recebes: a lista de temas já usados pela câmara, o que ficou registado durante a chamada (requerimentos, ocorrências, marcações, pagamentos, passagens a funcionário) e a transcrição com cada turno numerado [n].

Regras:
- Usa só o que está na transcrição e no que ficou registado. Não inventes prazos, valores, documentos nem regras.
- O resumo é para os funcionários da câmara: factual, 2 a 3 frases, sem repetir dados pessoais completos (NIF, morada completa, telefone).
- O tema: prefere um tema da lista, escrito exatamente como lá está. Só propões um novo se nenhum servir.
- Perguntas sem resposta: as que o agente disse não saber, não ter fonte ou passou a um funcionário por falta de informação. Escreve-as na forma canónica, como uma pergunta geral que outros munícipes também fariam. Se não houver, devolve lista vazia.
- Próximos passos: só o que o munícipe tem mesmo de fazer (ex.: "Assine o requerimento no link", "Leve o Cartão de Cidadão"). Se não tiver de fazer nada, lista vazia.
- SMS: curto (no máximo 140 caracteres), diz o essencial do que ficou feito ou do que falta; o link para os detalhes é acrescentado depois. Evita abreviaturas que se percebam mal.`;

export interface TurnoParaResumo {
  ordem: number;
  papel: string;
  texto: string;
}

/** Transcrição numerada: o modelo indica o turno de cada pergunta pelo [n]. */
export function formatarTranscricao(turnos: TurnoParaResumo[]): string {
  const quem: Record<string, string> = {
    agente: 'Agente',
    municipe: 'Munícipe',
    funcionario: 'Funcionário',
    sistema: 'Sistema',
  };
  return turnos
    .map((t) => `[${t.ordem}] ${quem[t.papel] ?? t.papel}: ${t.texto}`)
    .join('\n');
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O tema escolhido pelo modelo: um existente (sem olhar a maiúsculas nem
 * acentos) ou o nome novo a criar, arrumado e cortado a 60 caracteres.
 */
export function escolherTema(
  proposto: string,
  temas: { id: string; nome: string }[],
): { id: string } | { novo: string } | null {
  const limpo = proposto
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:]+$/, '');
  if (!limpo) return null;
  const chave = normalizar(limpo);
  const existente = temas.find((t) => normalizar(t.nome) === chave);
  if (existente) return { id: existente.id };
  const nome = limpo.slice(0, 60).trim();
  return { novo: nome.charAt(0).toUpperCase() + nome.slice(1) };
}

/**
 * O turno do munícipe a que se liga uma pergunta sem resposta: o indicado, se
 * for do munícipe; senão o turno do munícipe mais próximo dele.
 */
export function turnoMaisProximo(
  indicado: number,
  turnos: { id: string; ordem: number; papel: string }[],
): string | null {
  const doMunicipe = turnos.filter((t) => t.papel === 'municipe');
  let melhor: { id: string; ordem: number } | null = null;
  for (const t of doMunicipe) {
    if (
      !melhor ||
      Math.abs(t.ordem - indicado) < Math.abs(melhor.ordem - indicado)
    ) {
      melhor = t;
    }
  }
  return melhor?.id ?? null;
}

/**
 * Corpo máximo do SMS do fim da chamada: 1 parte em GSM-7 (os acentos saem
 * na transliteração do MensagensService). O resto está no link.
 */
export const MAX_SMS_FIM = 160;

/** Texto do resumo + link, cortado numa palavra para caber em MAX_SMS_FIM. */
export function montarSmsFimChamada(
  texto: string,
  url: string,
  max = MAX_SMS_FIM,
): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const espaco = max - url.length - 1;
  if (limpo.length <= espaco) return limpo ? `${limpo} ${url}` : url;
  const corte = limpo.slice(0, Math.max(0, espaco - 3));
  const ultimaPalavra = corte.lastIndexOf(' ');
  const base = (ultimaPalavra > 20 ? corte.slice(0, ultimaPalavra) : corte)
    .replace(/[\s,;:.]+$/, '')
    .trim();
  // '...' e não '…': o '…' não existe em GSM-7.
  return `${base}... ${url}`;
}

/** Sem resumo da IA: o SMS diz só onde ver o que ficou feito. */
export function smsSemResumo(municipio: string): string {
  // "de Guimarães", "do Porto", "da Maia": o nome à frente evita a preposição.
  return `${municipio}: obrigado por ligar. Veja o que ficou tratado e o que tem de fazer:`;
}
