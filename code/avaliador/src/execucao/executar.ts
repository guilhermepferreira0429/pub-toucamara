/*
 * Execução: um sistema × um conjunto (ou a amostra). Cada resposta grava-se
 * logo que chega (UPSERT por execução + pergunta), por isso uma execução
 * interrompida retoma onde ia. Spec secções 5.3 e 10.
 *
 * Uso por script (ex.: o gate de publicação da API chamado à mão):
 *
 *   import { correrExecucao } from './execucao/executar.js';
 *   const r = await correrExecucao({
 *     sistema: 'Tou, Câmara? · Guimarães · chat',
 *     motivo: 'publicacao',
 *   });
 *   // r = { execucao_id, estado: 'terminada' | 'interrompida', perguntas,
 *   //       respondidas, erros, erro }
 *   await bd.fechar();
 *
 * Não lança por erros do sistema avaliado (ficam nas respostas ou em
 * `r.erro`); lança se não houver nada para correr (sistema, conjunto ou
 * gabarito em falta) ou se houve uma execução externa há menos de 24 h.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bd, type Q } from '../bd.js';
import { config } from '../config.js';
import { NOME_BASE } from '../perguntas/conjuntos.js';
import {
  criarAdaptador,
  slugDoSistema,
  versaoAgente,
} from '../sistemas/index.js';
import {
  ErroAdaptador,
  type Adaptador,
  type Pergunta,
  type RespostaSistema,
  type Sistema,
} from '../tipos.js';
import { escolherAmostra } from './amostra.js';
import { correrFila } from './fila.js';
import { sistemaPorId, sistemaPorNome } from './sistemas.js';

export const MOTIVOS = ['manual', 'publicacao', 'pitch', 'auditoria'] as const;
export type Motivo = (typeof MOTIVOS)[number];

export interface OpcoesExecucao {
  /** Nome do sistema (obrigatório, exceto ao retomar com `execucao`). */
  sistema?: string;
  /** Nome do conjunto (por omissão "Perguntas base"). */
  conjunto?: string;
  /** Slug do município do gabarito (por omissão o do sistema). */
  municipio?: string;
  amostra?: boolean;
  motivo?: Motivo;
  /** Retomar esta execução (salta as já respondidas sem erro). */
  execucao?: string;
  /** Com `execucao`: perguntar só as que ficaram com erro. */
  soErros?: boolean;
  /** Todas as perguntas, mesmo sem gabarito aprovado (para testar). */
  semGabarito?: boolean;
  /** Correr mesmo que tenha havido execução externa nas últimas 24 h. */
  forcar?: boolean;
  /** Adaptadores com browser: visível. */
  ver?: boolean;
  /** Outro adaptador (testes, scripts). */
  adaptador?: Adaptador;
  /** Abortar = parar limpo (as perguntas em curso acabam e gravam-se). */
  sinal?: AbortSignal;
  /** Tratar Ctrl+C (a CLI liga isto). */
  ctrlC?: boolean;
  /** Linhas de progresso (por omissão, consola). */
  progresso?: (linha: string) => void;
}

export interface ResultadoExecucao {
  execucao_id: string;
  estado: 'terminada' | 'interrompida';
  /** Perguntas a fazer nesta corrida (sem as já respondidas). */
  perguntas: number;
  respondidas: number;
  erros: number;
  /** Motivo da interrupção (erro fatal do adaptador, Ctrl+C...). */
  erro: string | null;
}

interface Conjunto {
  id: string;
  nome: string;
  versao: number;
  municipio_id: string | null;
}

/** O do município, senão o genérico; versão mais recente. */
export async function conjuntoParaExecucao(
  nome: string | undefined,
  municipioId: string | null,
  q: Q = bd,
): Promise<Conjunto> {
  const procurado = nome ?? NOME_BASE;
  const [c] = await q.query<Conjunto>(
    `SELECT id, nome, versao, municipio_id
     FROM avaliacao.conjuntos
     WHERE (municipio_id = $2::uuid OR municipio_id IS NULL)
       AND (lower(nome) = lower($1) OR nome ILIKE '%' || $1 || '%')
     ORDER BY (lower(nome) = lower($1)) DESC, (municipio_id IS NOT NULL) DESC,
              versao DESC
     LIMIT 1`,
    [procurado, municipioId],
  );
  if (!c) {
    throw new Error(
      `Não há conjunto "${procurado}"${municipioId ? ' para este município' : ''}. Importa-o com \`perguntas importar\`.`,
    );
  }
  return c;
}

/** Perguntas do conjunto com gabarito aprovado para o município (ou todas). */
export async function perguntasComGabarito(
  conjuntoId: string,
  municipioId: string | null,
  todas: boolean,
  q: Q = bd,
): Promise<{ perguntas: Pergunta[]; noConjunto: number }> {
  const perguntas = await q.query<Pergunta>(
    `SELECT p.id, p.conjunto_id, p.ordem, p.categoria, p.texto, p.idioma,
            p.comportamento, p.entidade_esperada, p.nota
     FROM avaliacao.perguntas p
     WHERE p.conjunto_id = $1
       AND ($3 OR EXISTS (
         SELECT 1 FROM avaliacao.gabarito g
         WHERE g.pergunta_id = p.id AND g.municipio_id = $2::uuid
           AND g.estado = 'aprovado'))
     ORDER BY p.ordem`,
    [conjuntoId, municipioId, todas],
  );
  const [{ n }] = await q.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM avaliacao.perguntas WHERE conjunto_id = $1',
    [conjuntoId],
  );
  return { perguntas, noConjunto: n };
}

/** Execuções a este sistema nas últimas 24 h (só importa nos externos). */
async function execucoesRecentes(sistemaId: string, q: Q) {
  return q.query<{ id: string; iniciada_em: Date }>(
    `SELECT id, iniciada_em FROM avaliacao.execucoes
     WHERE sistema_id = $1 AND iniciada_em > now() - interval '24 hours'
     ORDER BY iniciada_em DESC`,
    [sistemaId],
  );
}

/** UPSERT da resposta: repetir uma pergunta substitui a resposta anterior. */
export async function gravarResposta(
  execucaoId: string,
  perguntaId: string,
  r: Partial<RespostaSistema> & {
    captura_key?: string | null;
    erro?: string | null;
  },
  q: Q = bd,
): Promise<void> {
  await q.query(
    `INSERT INTO avaliacao.respostas
       (execucao_id, pergunta_id, texto, latencia_ms, captura_key, ferramentas,
        fontes, bruto, erro, respondida_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (execucao_id, pergunta_id) DO UPDATE SET
       texto = EXCLUDED.texto, latencia_ms = EXCLUDED.latencia_ms,
       captura_key = EXCLUDED.captura_key, ferramentas = EXCLUDED.ferramentas,
       fontes = EXCLUDED.fontes, bruto = EXCLUDED.bruto, erro = EXCLUDED.erro,
       respondida_em = now()`,
    [
      execucaoId,
      perguntaId,
      r.texto ?? null,
      r.latencia_ms === undefined ? null : Math.round(r.latencia_ms),
      r.captura_key ?? null,
      r.ferramentas ?? [],
      JSON.stringify(r.fontes ?? []),
      r.bruto === undefined ? null : JSON.stringify(r.bruto),
      r.erro ?? null,
    ],
  );
}

function resumir(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function haQuanto(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
}

interface Preparada {
  execucaoId: string;
  sistema: Sistema;
  pendentes: Pergunta[];
  saltadas: number;
}

async function prepararNova(
  o: OpcoesExecucao,
  log: (l: string) => void,
): Promise<Preparada> {
  if (!o.sistema) throw new Error('Falta --sistema <nome>.');
  const sistema = await sistemaPorNome(o.sistema);
  const municipioId = await municipioDaExecucao(o, sistema);
  const conjunto = await conjuntoParaExecucao(o.conjunto, municipioId);
  let { perguntas, noConjunto } = await perguntasComGabarito(
    conjunto.id,
    municipioId,
    !!o.semGabarito,
  );
  if (!o.semGabarito) {
    log(
      `${perguntas.length} de ${noConjunto} perguntas de "${conjunto.nome}" v${conjunto.versao} têm gabarito aprovado.`,
    );
  }
  if (o.amostra) perguntas = escolherAmostra(perguntas);
  if (perguntas.length === 0) {
    throw new Error(
      o.semGabarito
        ? 'O conjunto não tem perguntas.'
        : 'Nenhuma pergunta com gabarito aprovado para este município. Aprova o gabarito ou usa --sem-gabarito para testar.',
    );
  }

  // Ritmo de pessoa também entre execuções: não martelar o site de outros.
  if (!sistema.nosso && !o.forcar) {
    const [r] = await execucoesRecentes(sistema.id, bd);
    if (r) {
      throw new Error(
        `Já houve uma execução a "${sistema.nome}" há ${haQuanto(r.iniciada_em)} (${r.id}). Para correr outra nas 24 h, usa --forcar.`,
      );
    }
  }

  let agenteVersao: string | null = null;
  if (
    sistema.nosso &&
    (sistema.adaptador === 'tou-chat' || sistema.adaptador === 'tou-voz')
  ) {
    try {
      agenteVersao = await versaoAgente(await slugDoSistema(sistema));
    } catch (e) {
      log(`Aviso: sem versão do agente (${(e as Error).message}).`);
    }
    if (!agenteVersao)
      log(
        'Aviso: o município não tem agente_config.versao; a execução não serve para o gate de publicação.',
      );
  }

  const [e] = await bd.query<{ id: string }>(
    `INSERT INTO avaliacao.execucoes (sistema_id, conjunto_id, agente_versao, motivo, amostra)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sistema.id, conjunto.id, agenteVersao, o.motivo ?? 'manual', !!o.amostra],
  );
  log(
    `Execução ${e.id}: "${sistema.nome}" × "${conjunto.nome}" v${conjunto.versao}${o.amostra ? ' (amostra)' : ''}, ${perguntas.length} perguntas${agenteVersao ? `, agente ${agenteVersao}` : ''}.`,
  );
  return { execucaoId: e.id, sistema, pendentes: perguntas, saltadas: 0 };
}

async function municipioDaExecucao(
  o: OpcoesExecucao,
  sistema: Sistema,
): Promise<string | null> {
  if (o.municipio) {
    const [m] = await bd.query<{ id: string }>(
      'SELECT id FROM municipios WHERE slug = $1',
      [o.municipio],
    );
    if (!m) throw new Error(`Município "${o.municipio}" não existe.`);
    return m.id;
  }
  if (!sistema.municipio_id && !o.semGabarito) {
    throw new Error(
      `"${sistema.nome}" não tem município: usa --municipio <slug> (o do gabarito) ou --sem-gabarito.`,
    );
  }
  return sistema.municipio_id;
}

async function prepararRetoma(
  o: OpcoesExecucao,
  log: (l: string) => void,
): Promise<Preparada> {
  const [e] = await bd.query<{
    id: string;
    sistema_id: string;
    conjunto_id: string;
    amostra: boolean;
    estado: string;
  }>(
    'SELECT id, sistema_id, conjunto_id, amostra, estado FROM avaliacao.execucoes WHERE id = $1',
    [o.execucao],
  );
  if (!e) throw new Error(`Execução ${o.execucao} não existe.`);
  const sistema = await sistemaPorId(e.sistema_id);
  if (
    o.sistema &&
    o.sistema !== sistema.nome &&
    !sistema.nome.includes(o.sistema)
  ) {
    throw new Error(
      `A execução ${e.id} é de "${sistema.nome}", não de "${o.sistema}".`,
    );
  }
  let pendentes: Pergunta[];
  let saltadas: number;
  if (o.soErros) {
    pendentes = await bd.query<Pergunta>(
      `SELECT p.id, p.conjunto_id, p.ordem, p.categoria, p.texto, p.idioma,
              p.comportamento, p.entidade_esperada, p.nota
       FROM avaliacao.respostas r JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       WHERE r.execucao_id = $1 AND r.erro IS NOT NULL
       ORDER BY p.ordem`,
      [e.id],
    );
    if (pendentes.length === 0)
      throw new Error(`A execução ${e.id} não tem respostas com erro.`);
    saltadas = 0;
  } else {
    // A mesma escolha do início (mesmo conjunto, gabarito e amostra), menos
    // as que já têm resposta sem erro.
    const municipioId = await municipioDaExecucao(o, sistema);
    let { perguntas } = await perguntasComGabarito(
      e.conjunto_id,
      municipioId,
      !!o.semGabarito,
    );
    if (e.amostra) perguntas = escolherAmostra(perguntas);
    const feitas = new Set(
      (
        await bd.query<{ pergunta_id: string }>(
          'SELECT pergunta_id FROM avaliacao.respostas WHERE execucao_id = $1 AND erro IS NULL',
          [e.id],
        )
      ).map((r) => r.pergunta_id),
    );
    pendentes = perguntas.filter((p) => !feitas.has(p.id));
    saltadas = perguntas.length - pendentes.length;
  }
  await bd.query(
    `UPDATE avaliacao.execucoes SET estado = 'a_correr', erro = NULL, terminada_em = NULL
     WHERE id = $1`,
    [e.id],
  );
  log(
    `${o.soErros ? 'A repetir os erros da' : 'A retomar a'} execução ${e.id} ("${sistema.nome}"): ${pendentes.length} por perguntar${saltadas ? `, ${saltadas} já respondidas` : ''}.`,
  );
  return { execucaoId: e.id, sistema, pendentes, saltadas };
}

export async function correrExecucao(
  o: OpcoesExecucao,
): Promise<ResultadoExecucao> {
  const log = o.progresso ?? ((l: string) => console.log(l));
  const prep = o.execucao
    ? await prepararRetoma(o, log)
    : await prepararNova(o, log);
  const { execucaoId, sistema, pendentes } = prep;

  const parar = new AbortController();
  const sinal = o.sinal
    ? AbortSignal.any([o.sinal, parar.signal])
    : parar.signal;
  let motivoParagem: string | null = null;
  const pararCom = (m: string) => {
    motivoParagem ??= m;
    parar.abort();
  };
  o.sinal?.addEventListener('abort', () => pararCom('Interrompida.'), {
    once: true,
  });

  // Ctrl+C: o primeiro para limpo (as em curso acabam); o segundo sai já.
  let ctrlC = 0;
  const aoCtrlC = () => {
    ctrlC++;
    if (ctrlC === 1) {
      log(
        '\nA parar: espera pelas perguntas em curso (Ctrl+C outra vez para sair já).',
      );
      pararCom('Interrompida (Ctrl+C).');
      return;
    }
    void marcarFim(
      execucaoId,
      'interrompida',
      'Interrompida (Ctrl+C).',
    ).finally(() => process.exit(130));
  };
  if (o.ctrlC) process.on('SIGINT', aoCtrlC);

  const adaptador = o.adaptador ?? criarAdaptador(sistema, { ver: o.ver });
  const total = pendentes.length;
  let feitas = 0;
  let respondidas = 0;
  let erros = 0;
  let erroInterno: unknown = null;

  try {
    await correrFila(pendentes, {
      paralelo: adaptador.paralelo,
      pausa: () => adaptador.pausa(),
      sinal,
      trabalhar: async (p) => {
        const t0 = Date.now();
        let r: RespostaSistema;
        try {
          r = await adaptador.perguntar({ texto: p.texto, idioma: p.idioma });
        } catch (e) {
          const fatal = e instanceof ErroAdaptador && e.fatal;
          const msg = e instanceof Error ? e.message : String(e);
          await gravarResposta(execucaoId, p.id, {
            erro: `erro_adaptador: ${msg}`,
            latencia_ms: Date.now() - t0,
          });
          erros++;
          feitas++;
          log(
            `[${String(feitas).padStart(String(total).length)}/${total}] ERRO #${p.ordem} ${resumir(p.texto, 40)}: ${msg}`,
          );
          if (fatal) pararCom(msg);
          return;
        }
        let capturaKey: string | null = null;
        if (r.captura) {
          // Caminho relativo a PASTA_SAIDA, com / (vai para a BD e para HTML).
          capturaKey = `capturas/${execucaoId}/${p.ordem}.png`;
          const destino = path.join(
            config.pastaSaida,
            ...capturaKey.split('/'),
          );
          await mkdir(path.dirname(destino), { recursive: true });
          await writeFile(destino, r.captura);
        }
        await gravarResposta(execucaoId, p.id, {
          ...r,
          captura_key: capturaKey,
          erro: null,
        });
        respondidas++;
        feitas++;
        log(
          `[${String(feitas).padStart(String(total).length)}/${total}] ok ${(r.latencia_ms / 1000).toFixed(1).padStart(5)} s  #${p.ordem} ${resumir(p.texto)}`,
        );
      },
    });
  } catch (e) {
    // Erro nosso (BD, disco): a execução fica interrompida e retomável.
    erroInterno = e;
    pararCom(`Erro do avaliador: ${(e as Error).message}`);
  } finally {
    if (o.ctrlC) process.off('SIGINT', aoCtrlC);
    if (!o.adaptador) await adaptador.fechar?.().catch(() => undefined);
  }

  const estado = motivoParagem ? 'interrompida' : 'terminada';
  await marcarFim(execucaoId, estado, motivoParagem);
  log(
    `Execução ${execucaoId} ${estado}: ${respondidas} respondidas, ${erros} com erro${prep.saltadas ? `, ${prep.saltadas} já estavam feitas` : ''}.` +
      (motivoParagem ? `\n  Motivo: ${motivoParagem}` : '') +
      (estado === 'interrompida'
        ? `\n  Retomar: executar --execucao ${execucaoId}`
        : '') +
      (erros && estado === 'terminada'
        ? `\n  Repetir os erros: repetir-erros --execucao ${execucaoId}`
        : ''),
  );
  if (erroInterno) throw erroInterno;
  return {
    execucao_id: execucaoId,
    estado,
    perguntas: total,
    respondidas,
    erros,
    erro: motivoParagem,
  };
}

async function marcarFim(
  id: string,
  estado: 'terminada' | 'interrompida',
  erro: string | null,
) {
  await bd.query(
    `UPDATE avaliacao.execucoes SET estado = $2, erro = $3, terminada_em = now() WHERE id = $1`,
    [id, estado, erro],
  );
}
