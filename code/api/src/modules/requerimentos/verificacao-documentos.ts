import { z } from 'zod';

/*
 * Verificação de documentos por fotografia: regras puras (sem BD nem IA),
 * aplicadas ao que a IA leu da foto.
 *
 * `tipo_processo_documentos.verificacoes` é jsonb com a lista das regras de
 * cada documento (lista vazia = só se verifica se é o documento certo e se
 * se lê):
 *
 *   [{ "tipo": "validade", "meses": 6 },   emitido há menos de N meses
 *    { "tipo": "validade", "dias": 90 },    ... ou há menos de N dias
 *    { "tipo": "assinatura" },              assinatura, carimbo ou código de validação visível
 *    { "tipo": "nif_requerente" }]          o NIF do documento é o do requerente
 *
 * Regras de tipos desconhecidos são ignoradas (não partem a página).
 *
 * Estado final (`documentos.verificacao_estado`), pela ordem:
 *   ilegivel          a foto não se lê, ou a data de que a validade precisa não se lê
 *   documento_errado  não é o documento pedido (ou a confiança é baixa)
 *   fora_de_prazo     a validade falhou
 *   documento_errado  falta assinatura ou o NIF não é o do requerente
 *   valido            passou tudo
 */

export const esquemaVerificacao = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('validade'),
    meses: z.number().int().positive().optional(),
    dias: z.number().int().positive().optional(),
  }),
  z.object({ tipo: z.literal('assinatura') }),
  z.object({ tipo: z.literal('nif_requerente') }),
]);

export type Verificacao = z.infer<typeof esquemaVerificacao>;

/** O jsonb da BD → regras conhecidas. Nunca lança. */
export function lerVerificacoes(json: unknown): Verificacao[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((v) => {
    const r = esquemaVerificacao.safeParse(v);
    if (!r.success) return [];
    if (r.data.tipo === 'validade' && !r.data.meses && !r.data.dias) return [];
    return [r.data];
  });
}

/** Para o modelo saber onde olhar. */
export function verificacoesEmPalavras(lista: Verificacao[]): string[] {
  return lista.map((v) => {
    switch (v.tipo) {
      case 'validade':
        return 'data de emissão (validade)';
      case 'assinatura':
        return 'assinatura, carimbo ou código de validação';
      case 'nif_requerente':
        return 'NIF do titular';
    }
  });
}

export type EstadoVerificacao =
  'valido' | 'fora_de_prazo' | 'documento_errado' | 'ilegivel';

export interface ResultadoRegra {
  regra: 'legivel' | 'documento' | Verificacao['tipo'];
  ok: boolean;
  detalhe: string;
}

/** O que a IA leu (ver `esquemaLeituraDocumento`), sem o NIF. */
export interface Leitura {
  tipo_reconhecido: string;
  corresponde_ao_esperado: boolean;
  confianca: 'alta' | 'media' | 'baixa';
  legivel: boolean;
  data_emissao: string | null;
  tem_assinatura_ou_carimbo: boolean;
}

export interface Avaliacao {
  estado: EstadoVerificacao;
  regras: ResultadoRegra[];
  /** Data de emissão lida e válida ('AAAA-MM-DD') ou null. */
  emitido_em: string | null;
}

/** 'AAAA-MM-DD' que existe no calendário, ou null. */
export function dataValida(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, me - 1, d));
  return dt.getUTCFullYear() === a &&
    dt.getUTCMonth() === me - 1 &&
    dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
}

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Dias entre duas datas ISO (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
}

/** Meses completos entre duas datas ISO (de 2026-02-20 a 2026-10-19 → 7). */
export function mesesEntre(a: string, b: string): number {
  const [da, db] = [utc(a), utc(b)];
  let m =
    (db.getUTCFullYear() - da.getUTCFullYear()) * 12 +
    db.getUTCMonth() -
    da.getUTCMonth();
  if (db.getUTCDate() < da.getUTCDate()) m--;
  return m;
}

/** "há 12 dias", "há 1 mês", "há 8 meses". */
export function haQuanto(emitido: string, hoje: string): string {
  const meses = mesesEntre(emitido, hoje);
  if (meses >= 1) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const dias = diasEntre(emitido, hoje);
  if (dias === 0) return 'hoje';
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function regraValidade(
  v: Extract<Verificacao, { tipo: 'validade' }>,
  emitido: string | null,
  lidaMasInvalida: boolean,
  hoje: string,
): ResultadoRegra {
  if (!emitido) {
    return {
      regra: 'validade',
      ok: false,
      detalhe: lidaMasInvalida
        ? 'não foi possível perceber a data de emissão'
        : 'não se vê a data de emissão',
    };
  }
  if (emitido > hoje) {
    return {
      regra: 'validade',
      ok: false,
      detalhe: 'a data de emissão lida está no futuro',
    };
  }
  const quando = haQuanto(emitido, hoje);
  if (v.meses) {
    // Válido enquanto não passarem N meses completos.
    const ok = mesesEntre(emitido, hoje) < v.meses;
    return {
      regra: 'validade',
      ok,
      detalhe: ok
        ? `emitida ${quando} (validade de ${v.meses} ${v.meses === 1 ? 'mês' : 'meses'})`
        : `emitida ${quando}, tem de ter menos de ${v.meses}`,
    };
  }
  const dias = v.dias ?? 0;
  const ok = diasEntre(emitido, hoje) < dias;
  return {
    regra: 'validade',
    ok,
    detalhe: ok
      ? `emitida ${quando} (validade de ${dias} dias)`
      : `emitida ${quando}, tem de ter menos de ${dias} dias`,
  };
}

/**
 * Aplica as regras ao que a IA leu. `nifCorresponde`: true/false da
 * comparação (por hash) com o NIF do requerente; null se não houve como
 * comparar (o requerente ainda não deu NIF) — aí a regra passa com aviso,
 * para o funcionário confirmar.
 */
export function avaliarDocumento(e: {
  leitura: Leitura;
  verificacoes: Verificacao[];
  hoje: string;
  nifVisivel: boolean;
  nifCorresponde: boolean | null;
}): Avaliacao {
  const { leitura } = e;
  const emitido = dataValida(leitura.data_emissao);
  const regras: ResultadoRegra[] = [
    {
      regra: 'legivel',
      ok: leitura.legivel,
      detalhe: leitura.legivel
        ? 'lê-se bem'
        : 'a fotografia não se lê bem: tire outra, com boa luz e o documento inteiro',
    },
  ];
  const certo =
    leitura.corresponde_ao_esperado && leitura.confianca !== 'baixa';
  regras.push({
    regra: 'documento',
    ok: certo,
    detalhe: certo
      ? 'é o documento pedido'
      : leitura.corresponde_ao_esperado
        ? 'não foi possível confirmar que é o documento pedido'
        : `parece ser: ${leitura.tipo_reconhecido || 'outro documento'}`,
  });

  let dataIlegivel = false;
  let foraDePrazo = false;
  let incompleto = false;
  for (const v of e.verificacoes) {
    if (v.tipo === 'validade') {
      const r = regraValidade(v, emitido, !!leitura.data_emissao, e.hoje);
      if (!r.ok) {
        if (!emitido || emitido > e.hoje) dataIlegivel = true;
        else foraDePrazo = true;
      }
      regras.push(r);
    } else if (v.tipo === 'assinatura') {
      const ok = leitura.tem_assinatura_ou_carimbo;
      if (!ok) incompleto = true;
      regras.push({
        regra: 'assinatura',
        ok,
        detalhe: ok
          ? 'tem assinatura ou carimbo'
          : 'não se vê assinatura, carimbo nem código de validação',
      });
    } else {
      const r: ResultadoRegra = !e.nifVisivel
        ? { regra: 'nif_requerente', ok: false, detalhe: 'não se vê o NIF' }
        : e.nifCorresponde === null
          ? {
              regra: 'nif_requerente',
              ok: true,
              detalhe: 'NIF por confirmar (o requerente ainda não o indicou)',
            }
          : e.nifCorresponde
            ? {
                regra: 'nif_requerente',
                ok: true,
                detalhe: 'o NIF é o do requerente',
              }
            : {
                regra: 'nif_requerente',
                ok: false,
                detalhe: 'o NIF do documento não é o do requerente',
              };
      if (!r.ok) {
        if (e.nifVisivel) incompleto = true;
        else dataIlegivel = true;
      }
      regras.push(r);
    }
  }

  const estado: EstadoVerificacao =
    !leitura.legivel || dataIlegivel
      ? 'ilegivel'
      : !certo
        ? 'documento_errado'
        : foraDePrazo
          ? 'fora_de_prazo'
          : incompleto
            ? 'documento_errado'
            : 'valido';
  return { estado, regras, emitido_em: emitido };
}

const ESTADO_EM_PALAVRAS: Record<EstadoVerificacao, string> = {
  valido: 'está bem',
  fora_de_prazo: 'fora de prazo',
  documento_errado: 'não é o documento certo',
  ilegivel: 'não se lê bem',
};

/**
 * A frase do ecrã: "Certidão do registo predial: fora de prazo — emitida há
 * 8 meses, tem de ter menos de 6." Junta os detalhes das regras que falharam.
 */
export function fraseVerificacao(nome: string, a: Avaliacao): string {
  if (a.estado === 'valido') {
    const validade = a.regras.find((r) => r.regra === 'validade');
    return `${nome}: está bem${validade ? ` — ${validade.detalhe}` : ''}.`;
  }
  const falhas = a.regras.filter((r) => !r.ok).map((r) => r.detalhe);
  const estado =
    a.estado === 'documento_errado' &&
    a.regras.find((r) => r.regra === 'documento')?.ok
      ? 'incompleto'
      : ESTADO_EM_PALAVRAS[a.estado];
  return `${nome}: ${estado}${falhas.length ? ` — ${falhas.join('; ')}` : ''}.`;
}

// ------------------------------------------------- documentos entregues

/**
 * Documento exigido com o melhor estado do que já chegou (no requerimento ou
 * no processo): 'valido' > 'por_verificar' > o último rejeitado; null se
 * nada chegou.
 */
export interface DocumentoComEstado {
  id: string;
  nome: string;
  obrigatorio: boolean;
  gerado_pelo_sistema: boolean;
  estado:
    | 'valido'
    | 'por_verificar'
    | 'fora_de_prazo'
    | 'documento_errado'
    | 'ilegivel'
    | null;
}

/**
 * Três listas, em todo o lado:
 * - tem: verificados e válidos;
 * - por_verificar: entregues sem verificação por foto (envio de ficheiro ou
 *   foto ainda não lida). Contam como entregues — não aparecem em `faltam`
 *   nem no SMS — mas mostram-se como "por verificar" até um funcionário (ou
 *   a verificação por foto) dizer que estão bons;
 * - faltam: os outros (nunca chegaram ou foram rejeitados), com o motivo
 *   da última rejeição. Os que o sistema gera nunca faltam ao munícipe.
 */
export function resumirEntregas(lista: DocumentoComEstado[]) {
  const item = (d: DocumentoComEstado) => ({ id: d.id, nome: d.nome });
  return {
    tem: lista.filter((d) => d.estado === 'valido').map(item),
    por_verificar: lista.filter((d) => d.estado === 'por_verificar').map(item),
    faltam: lista
      .filter(
        (d) =>
          d.estado !== 'valido' &&
          d.estado !== 'por_verificar' &&
          !d.gerado_pelo_sistema,
      )
      .map((d) => ({
        ...item(d),
        obrigatorio: d.obrigatorio,
        ultima_verificacao: d.estado,
      })),
  };
}

/**
 * Para o agente, o SMS e o PDF (só nomes): `tem` inclui os por verificar
 * (marcados no PDF), `faltam` só os obrigatórios.
 */
export function resumirParaAgente(lista: DocumentoComEstado[]): {
  tem: string[];
  por_verificar: string[];
  faltam: string[];
} {
  const r = resumirEntregas(lista);
  return {
    tem: [...r.tem, ...r.por_verificar].map((d) => d.nome),
    por_verificar: r.por_verificar.map((d) => d.nome),
    faltam: r.faltam.filter((d) => d.obrigatorio).map((d) => d.nome),
  };
}

// ------------------------------------------------------------ ficheiro

/** Limites da API do Claude: 5 MB por imagem; PDF até 10 MB aqui. */
export const MAXIMO_IMAGEM_BYTES = 5 * 1024 * 1024;
export const MAXIMO_PDF_BYTES = 10 * 1024 * 1024;

/** Bytes que um base64 representa, sem o descodificar. */
export function bytesDeBase64(b64: string): number {
  const limpo = b64.replace(/\s/g, '');
  const pad = limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0;
  return Math.floor((limpo.length * 3) / 4) - pad;
}

/** Tira o prefixo 'data:image/jpeg;base64,' de um data URL. */
export function semPrefixoDataUrl(b64: string): string {
  const i = b64.indexOf('base64,');
  return b64.startsWith('data:') && i >= 0 ? b64.slice(i + 7) : b64;
}

/** O tipo real pelos primeiros bytes (a extensão e o mime do browser mentem). */
export function mimePelosBytes(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}
