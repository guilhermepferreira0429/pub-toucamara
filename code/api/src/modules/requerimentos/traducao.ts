import { z } from 'zod';
import { Dados, Formulario, validarValor } from '../processos/formulario.js';

/*
 * Atendimento noutra língua, requerimento em português. O agente fala na
 * língua da pessoa e grava o que ela diz; ao concluir, o job
 * `traduzir_requerimento` passa para português de Portugal os campos de
 * texto livre (`texto`) e normaliza as moradas (`morada`: escrita
 * portuguesa, sem traduzir nomes de ruas). Os valores originais ficam em
 * `requerimentos.dados_originais` (só os que mudaram) e a página pública
 * mostra-os ao lado.
 */

export const TIPOS_TRADUZIVEIS = ['texto', 'morada'] as const;

/** 'pt', 'pt-PT', 'pt-BR' não se traduzem. Vazio conta como português. */
export function precisaTraducao(idioma: string | null | undefined): boolean {
  const i = (idioma ?? '').trim().toLowerCase();
  return i !== '' && !/^pt(-|$)/.test(i);
}

/** BCP 47 canónico ('EN-gb' → 'en-GB'); inválido → null. */
export function idiomaCanonico(
  idioma: string | null | undefined,
): string | null {
  if (!idioma?.trim()) return null;
  try {
    return Intl.getCanonicalLocales(idioma.trim())[0] ?? null;
  } catch {
    return null;
  }
}

export interface CampoATraduzir {
  chave: string;
  rotulo: string;
  tipo: (typeof TIPOS_TRADUZIVEIS)[number];
  valor: string;
}

/**
 * Os campos a mandar ao modelo: de texto ou morada, com valor, e que ainda
 * não foram traduzidos (não estão em `originais`).
 */
export function camposATraduzir(
  formulario: Formulario,
  dados: Dados,
  originais: Dados | null,
): CampoATraduzir[] {
  return formulario.flatMap((c) => {
    const v = dados[c.chave];
    if (c.tipo !== 'texto' && c.tipo !== 'morada') return [];
    if (typeof v !== 'string' || !v.trim()) return [];
    if (originais && c.chave in originais) return [];
    return [{ chave: c.chave, rotulo: c.rotulo, tipo: c.tipo, valor: v }];
  });
}

export const esquemaTraducao = z.object({
  campos: z.array(
    z.object({
      chave: z.string(),
      valor: z
        .string()
        .describe(
          'O valor em português de Portugal (ou a morada normalizada).',
        ),
    }),
  ),
});

export type Traducao = z.infer<typeof esquemaTraducao>;

// Fixo para ficar em cache.
export const SISTEMA_TRADUCAO = `Traduzes para português de Portugal os campos de um requerimento a uma câmara municipal, ditos pelo munícipe noutra língua.
Recebes JSON com idioma_origem e campos [{chave, rotulo, tipo, valor}]. Devolves campos [{chave, valor}] com as mesmas chaves.
- tipo "texto": traduz fielmente para português de Portugal, registo neutro e claro, sem acrescentar nem resumir.
- tipo "morada": não traduzas nomes de ruas, lugares ou freguesias; só normaliza para a escrita portuguesa (ex.: "Street of Santo Antonio 12" → "Rua de Santo António, 12"; "nº", códigos postais 4800-123).
- Se o valor já estiver em português, devolve-o igual.
- Nunca inventes informação.`;

/**
 * Aplica a tradução: só chaves pedidas, valores válidos para o tipo e
 * diferentes do original. Devolve os novos `dados` e `dados_originais`.
 */
export function aplicarTraducao(
  formulario: Formulario,
  dados: Dados,
  originais: Dados | null,
  pedidos: CampoATraduzir[],
  traducao: Traducao,
): { dados: Dados; originais: Dados | null; traduzidos: string[] } {
  const novos: Dados = { ...dados };
  const orig: Dados = { ...(originais ?? {}) };
  const traduzidos: string[] = [];
  for (const t of traducao.campos) {
    const pedido = pedidos.find((p) => p.chave === t.chave);
    const campo = formulario.find((c) => c.chave === t.chave);
    if (!pedido || !campo) continue;
    const v = validarValor(campo, t.valor);
    if (!v.ok || v.valor === pedido.valor) continue;
    orig[t.chave] = pedido.valor;
    novos[t.chave] = v.valor;
    traduzidos.push(t.chave);
  }
  return {
    dados: novos,
    originais: Object.keys(orig).length ? orig : originais,
    traduzidos,
  };
}

/**
 * A linha curta na língua da pessoa no SMS (que vai sempre em português).
 * Só para as línguas mais comuns no atendimento; as outras ficam só em
 * português. Curta para não passar de mais um segmento.
 */
const LINHA_SMS: Record<string, string> = {
  en: 'EN: Your request is ready. Review and sign it at the link above.',
  es: 'ES: Su solicitud está lista. Revísela y fírmela en el enlace de arriba.',
  fr: 'FR: Votre demande est prête. Vérifiez-la et signez-la via le lien ci-dessus.',
};

export function linhaSmsNaLingua(
  idioma: string | null | undefined,
): string | null {
  const base = (idioma ?? '').trim().toLowerCase().split('-')[0];
  return LINHA_SMS[base] ?? null;
}
