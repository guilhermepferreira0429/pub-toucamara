/*
 * O que se passa na chamada, construído a partir dos eventos do SDK do
 * ElevenLabs: transcrições (onMessage) e ferramentas do servidor
 * (onAgentToolRequest / onAgentToolResponse). As ferramentas são as da nossa
 * API (code/api/src/modules/* /*.ferramentas.ts); o resultado só chega se o
 * agente mandar o evento `agent_tool_response_full_payload` (campo
 * `full_tool_result`, o corpo JSON que a API devolveu). Sem ele, só se sabe o
 * nome da ferramenta e se correu bem.
 */

export interface CampoReq {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  pergunta: string;
}

export type Cartao =
  | {
      tipo: "requerimento";
      nomeTipo: string;
      campos: CampoReq[];
      preenchidos: string[];
      valores: Record<string, string>;
      proxima: string | null;
      concluido: { link: string | null; faltam: string[] } | null;
    }
  | {
      tipo: "ocorrencia";
      numero: string | null;
      categoria: string | null;
      duplicada: boolean;
      noMapa: boolean;
      sms: boolean;
    }
  | {
      tipo: "processo";
      numero: string;
      titulo: string;
      fase: string;
      diasUteis: number | null;
      faltam: { nome: string; prazo: string | null }[];
      outros: number;
    }
  | {
      tipo: "recolha";
      quando: string;
      morada: string;
      itens: { item: string; qtd: number }[];
      entidade: string | null;
    }
  | {
      tipo: "marcacao";
      quando: string;
      onde: string | null;
      levar: string[];
    }
  | {
      tipo: "passagem";
      emCurso: boolean;
      foraDeHoras: boolean;
      responderAte: string | null;
      dizer: string | null;
    }
  | { tipo: "emergencia" };

export interface Feito {
  chave: string;
  icone: "requerimento" | "ocorrencia" | "recolha" | "marcacao" | "passagem" | "fonte" | "processo";
  titulo: string;
  detalhe: string;
}

export interface Fonte {
  titulo: string;
  data: string | null;
  url: string | null;
}

export interface EstadoChamada {
  ultimaPessoa: string | null;
  ultimaAgente: string | null;
  cartao: Cartao | null;
  /** Ferramenta à espera de resposta (nome da nossa API). */
  emCurso: string | null;
  /** procurar_conhecimento: a consultar, ou a fonte da última resposta. */
  consulta: "a_consultar" | Fonte | null;
  identificadoNif: boolean;
  feitos: Feito[];
  smsEnviado: boolean;
  /** Link para o munícipe continuar (requerimento ou marcação). */
  link: string | null;
}

export const ESTADO_INICIAL: EstadoChamada = {
  ultimaPessoa: null,
  ultimaAgente: null,
  cartao: null,
  emCurso: null,
  consulta: null,
  identificadoNif: false,
  feitos: [],
  smsEnviado: false,
  link: null,
};

export type Acao =
  | { tipo: "reiniciar" }
  | { tipo: "mensagem"; papel: "user" | "agent"; texto: string }
  | { tipo: "pedido"; ferramenta: string }
  | {
      tipo: "resposta";
      ferramenta: string;
      erro: boolean;
      resultado: unknown;
    };

/** O que mostrar enquanto a ferramenta corre. */
export const A_FAZER: Record<string, string> = {
  procurar_conhecimento: "A consultar a informação oficial…",
  identificar_municipe: "A confirmar a identificação…",
  iniciar_requerimento: "A abrir o requerimento…",
  preencher_campo: "A gravar no requerimento…",
  concluir_requerimento: "A fechar o requerimento…",
  registar_ocorrencia: "A registar a ocorrência…",
  estado_ocorrencia: "A ver a ocorrência…",
  estado_processo: "A ver o seu processo…",
  ver_vagas: "A ver as vagas…",
  marcar: "A marcar o atendimento…",
  agendar_recolha: "A marcar a recolha…",
  cancelar_marcacao: "A cancelar a marcação…",
  simular_taxa: "A calcular a taxa…",
  criar_pagamento: "A preparar o pagamento…",
  encaminhar: "A ver quem trata disto…",
  passar_a_humano: "A passar a um funcionário…",
  conversa_anterior: "A ver a conversa anterior…",
  consultas_abertas: "A ver as consultas públicas…",
  participar_consulta: "A registar a opinião…",
  o_que_se_passa: "A ver o que se passa perto…",
  avisar_me: "A combinar os avisos…",
};

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** `full_tool_result` vem como texto (JSON, às vezes JSON dentro de JSON). */
export function lerResultado(bruto: unknown): unknown {
  let v = bruto;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      break;
    }
  }
  return v;
}

function juntarFeito(feitos: Feito[], f: Feito): Feito[] {
  return [...feitos.filter((x) => x.chave !== f.chave), f];
}

export function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function itensDitos(itens: { item: string; qtd: number }[]): string {
  const partes = itens.map((i) => `${i.qtd} ${i.item}`);
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

function aplicarResultado(
  e: EstadoChamada,
  ferramenta: string,
  r: Obj,
): EstadoChamada {
  const sms = r.sms_enviado === true;
  const base: EstadoChamada = { ...e, smsEnviado: e.smsEnviado || sms };

  switch (ferramenta) {
    case "procurar_conhecimento": {
      const resp = obj(lista(r.respostas)[0]);
      const fonte =
        obj(lista(resp?.fontes)[0]) ?? obj(lista(r.trechos)[0]) ?? null;
      if (r.sem_fonte === true || !fonte) return { ...base, consulta: null };
      const f: Fonte = {
        titulo: str(fonte.titulo) ?? str(fonte.referencia) ?? "Documento oficial",
        data: str(fonte.lida_em)
          ? `Verificada em ${new Date(String(fonte.lida_em)).toLocaleDateString("pt-PT")}`
          : null,
        url: str(fonte.url),
      };
      return {
        ...base,
        consulta: f,
        feitos: juntarFeito(base.feitos, {
          chave: `fonte:${f.titulo}`,
          icone: "fonte",
          titulo: f.titulo,
          detalhe: "Fonte oficial consultada",
        }),
      };
    }

    case "identificar_municipe":
      return { ...base, identificadoNif: true };

    case "iniciar_requerimento": {
      if (r.encontrado === false) return base;
      const tipo = obj(r.tipo);
      const campos: CampoReq[] = lista(r.campos)
        .map(obj)
        .filter((c): c is Obj => !!c)
        .map((c) => ({
          chave: String(c.chave ?? ""),
          rotulo: str(c.rotulo) ?? String(c.chave ?? ""),
          obrigatorio: c.obrigatorio !== false,
          pergunta: str(c.pergunta) ?? "",
        }));
      const preenchidos = lista(r.campos)
        .map(obj)
        .filter((c) => c?.ja_preenchido === true)
        .map((c) => String(c?.chave));
      return {
        ...base,
        cartao: {
          tipo: "requerimento",
          nomeTipo: str(tipo?.nome) ?? "Requerimento",
          campos,
          preenchidos,
          valores: {},
          proxima: str(r.proxima_pergunta),
          concluido: null,
        },
      };
    }

    case "preencher_campo": {
      const c = e.cartao?.tipo === "requerimento" ? e.cartao : null;
      if (!c) return base;
      const gravados = lista(r.gravados).map(String);
      const comErro = new Set(
        lista(r.erros).map((x) => String(obj(x)?.chave ?? "")),
      );
      const valores = { ...c.valores };
      // A resposta só traz as chaves gravadas, não os valores: quando é um
      // campo só, o valor é o que a pessoa acabou de dizer.
      if (gravados.length === 1 && e.ultimaPessoa)
        valores[gravados[0]] = e.ultimaPessoa;
      const emFalta = new Set(lista(r.campos_em_falta).map(String));
      const preenchidos = Array.from(
        new Set([...c.preenchidos, ...gravados]),
      ).filter((k) => !comErro.has(k) && !emFalta.has(k));
      return {
        ...base,
        cartao: {
          ...c,
          preenchidos,
          valores,
          proxima: str(r.proxima_pergunta),
        },
      };
    }

    case "concluir_requerimento": {
      const c = e.cartao?.tipo === "requerimento" ? e.cartao : null;
      const link = str(r.link);
      const nome = c?.nomeTipo ?? "Requerimento";
      return {
        ...base,
        link: link ?? base.link,
        cartao: c
          ? {
              ...c,
              preenchidos: c.campos.map((x) => x.chave),
              proxima: null,
              concluido: {
                link,
                faltam: lista(r.documentos_em_falta).map(String),
              },
            }
          : base.cartao,
        feitos: juntarFeito(base.feitos, {
          chave: "requerimento",
          icone: "requerimento",
          titulo: nome,
          detalhe: "Requerimento pronto: falta rever e assinar",
        }),
      };
    }

    case "registar_ocorrencia": {
      if (r.registada !== true) return base;
      const numero = str(r.numero);
      return {
        ...base,
        cartao: {
          tipo: "ocorrencia",
          numero,
          categoria: str(r.categoria),
          duplicada: r.duplicada === true,
          noMapa: r.localizada_no_mapa === true,
          sms,
        },
        feitos: juntarFeito(base.feitos, {
          chave: `ocorrencia:${numero}`,
          icone: "ocorrencia",
          titulo: numero ? `Ocorrência ${numero}` : "Ocorrência registada",
          detalhe: str(r.categoria) ?? "Na via pública",
        }),
      };
    }

    case "estado_processo": {
      const ps = lista(r.processos).map(obj).filter((p): p is Obj => !!p);
      if (r.encontrado !== true || !ps.length) return base;
      const p = ps[0];
      const numero = str(p.numero) ?? "";
      return {
        ...base,
        cartao: {
          tipo: "processo",
          numero,
          titulo: str(p.tipo) ?? "O seu processo",
          fase: str(p.fase) ?? "",
          diasUteis:
            typeof p.dias_uteis_restantes === "number"
              ? p.dias_uteis_restantes
              : null,
          faltam: lista(p.falta_da_sua_parte)
            .map(obj)
            .filter((f): f is Obj => !!f)
            .map((f) => ({ nome: String(f.nome ?? ""), prazo: str(f.prazo) })),
          outros: ps.length - 1,
        },
        feitos: juntarFeito(base.feitos, {
          chave: `processo:${numero}`,
          icone: "processo",
          titulo: `Processo ${numero}`,
          detalhe: str(p.fase) ? `Fase: ${p.fase}` : "Estado consultado",
        }),
      };
    }

    case "agendar_recolha": {
      const quando = str(r.quando);
      if (!quando) return base;
      const itens = lista(r.itens)
        .map(obj)
        .filter((i): i is Obj => !!i)
        .map((i) => ({ item: String(i.item ?? ""), qtd: Number(i.qtd ?? 1) }));
      return {
        ...base,
        cartao: {
          tipo: "recolha",
          quando,
          morada: str(r.morada) ?? "",
          itens,
          entidade: str(r.entidade),
        },
        feitos: juntarFeito(base.feitos, {
          chave: "recolha",
          icone: "recolha",
          titulo: "Recolha de monos",
          detalhe: `${quando}${itens.length ? ` · ${itensDitos(itens)}` : ""}`,
        }),
      };
    }

    case "marcar": {
      const quando = str(r.quando) ?? dataCurta(str(r.inicio));
      if (!quando) return base;
      const onde = [str(r.agenda), str(r.local)].filter(Boolean).join(" · ");
      return {
        ...base,
        link: str(r.link) ?? base.link,
        cartao: {
          tipo: "marcacao",
          quando,
          onde: onde || null,
          levar: lista(r.levar).map(String),
        },
        feitos: juntarFeito(base.feitos, {
          chave: "marcacao",
          icone: "marcacao",
          titulo: quando,
          detalhe: onde || "Atendimento marcado",
        }),
      };
    }

    case "passar_a_humano": {
      const ate = str(r.responder_ate);
      return {
        ...base,
        cartao: {
          tipo: "passagem",
          emCurso: false,
          foraDeHoras: r.fora_de_horas === true,
          responderAte: ate,
          dizer: str(r.dizer),
        },
        feitos: juntarFeito(base.feitos, {
          chave: "passagem",
          icone: "passagem",
          titulo: "Caso passado a um funcionário",
          detalhe: ate ? `Resposta até ${dataCurta(ate)}` : "Vai ter resposta",
        }),
      };
    }

    default:
      return base;
  }
}

export function reduzir(e: EstadoChamada, a: Acao): EstadoChamada {
  switch (a.tipo) {
    case "reiniciar":
      return ESTADO_INICIAL;
    case "mensagem":
      return a.papel === "user"
        ? { ...e, ultimaPessoa: a.texto }
        : { ...e, ultimaAgente: a.texto };
    case "pedido": {
      const n: EstadoChamada = { ...e, emCurso: a.ferramenta };
      if (a.ferramenta === "procurar_conhecimento")
        return { ...n, consulta: "a_consultar" };
      if (a.ferramenta === "passar_a_humano")
        return {
          ...n,
          cartao: {
            tipo: "passagem",
            emCurso: true,
            foraDeHoras: false,
            responderAte: null,
            dizer: null,
          },
        };
      if (a.ferramenta === "emergencia")
        return { ...n, cartao: { tipo: "emergencia" } };
      return n;
    }
    case "resposta": {
      const n: EstadoChamada = {
        ...e,
        emCurso: e.emCurso === a.ferramenta ? null : e.emCurso,
      };
      if (a.erro) {
        if (a.ferramenta === "procurar_conhecimento")
          return { ...n, consulta: null };
        if (a.ferramenta === "passar_a_humano" && n.cartao?.tipo === "passagem")
          return { ...n, cartao: null };
        return n;
      }
      const r = obj(lerResultado(a.resultado));
      if (!r) {
        // Sem o resultado completo: o cartão de passagem fica "feito".
        if (a.ferramenta === "passar_a_humano" && n.cartao?.tipo === "passagem")
          return { ...n, cartao: { ...n.cartao, emCurso: false } };
        if (a.ferramenta === "procurar_conhecimento")
          return { ...n, consulta: null };
        return n;
      }
      if (obj(r.erro)) {
        return a.ferramenta === "procurar_conhecimento"
          ? { ...n, consulta: null }
          : n;
      }
      return aplicarResultado(n, a.ferramenta, r);
    }
  }
}
