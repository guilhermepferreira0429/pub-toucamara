"use client";

import {
  Calculator,
  Calendar,
  Check,
  ClipboardList,
  Clock,
  Copy,
  CreditCard,
  Droplets,
  ExternalLink,
  FileText,
  Globe,
  HandCoins,
  Landmark,
  Mail,
  MapPin,
  MessageSquareText,
  Package,
  Phone,
  Send,
  Siren,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Etiqueta } from "@/components/ui/botao";
import { FonteOficial } from "@/components/ui/marca";
import type { Cartao } from "./tipos";

/* ------------------------------------------------------------------ */
/* Leitura segura dos dados (vêm do resultado das ferramentas)          */
/* ------------------------------------------------------------------ */

type Dados = Record<string, unknown>;
const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Dados =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Dados) : {};
const lista = (v: unknown): Dados[] => (Array.isArray(v) ? v.map(obj) : []);
const textos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];

const euros = (cent: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    cent / 100,
  );

const dataCurta = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" }).format(d);
};

/** Ações que os cartões pedem ao chat. */
export interface AcoesCartao {
  /** Manda uma mensagem em nome da pessoa (p. ex. "Envie assim"). */
  enviar: (texto: string) => void;
  /** Põe o cursor no campo de escrita (p. ex. "Mudar algo"). */
  escrever: (texto?: string) => void;
  ocupado: boolean;
}

/* ------------------------------------------------------------------ */
/* Peças comuns                                                         */
/* ------------------------------------------------------------------ */

const CAIXA =
  "flex w-full flex-col rounded-[4px_18px_18px_18px] border bg-papel";

function Linha({
  icone: Icone,
  children,
}: {
  icone: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5 border-b border-linha py-[9px] last:border-b-0">
      <Icone className="mt-0.5 size-4 shrink-0 text-tinta-2" aria-hidden />
      <span className="min-w-0 flex-1 text-sm leading-[1.4] text-tinta">{children}</span>
    </li>
  );
}

function BotaoCartao({
  icone: Icone,
  children,
  tom = "contorno",
  ...resto
}: {
  icone?: LucideIcon;
  tom?: "contorno" | "cheio" | "tinta";
} & React.ComponentProps<"button">) {
  const tons = {
    contorno: "border-[1.5px] border-tinta text-tinta hover:bg-tinta/5",
    cheio: "bg-terracota text-white hover:bg-terracota-escuro",
    tinta: "bg-tinta text-white hover:bg-tinta/90",
  } as const;
  return (
    <button
      type="button"
      className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tons[tom]}`}
      {...resto}
    >
      {Icone && <Icone className="size-3.5" aria-hidden />}
      {children}
    </button>
  );
}

function LinkCartao({
  href,
  icone: Icone = ExternalLink,
  children,
}: {
  href: string;
  icone?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border-[1.5px] border-tinta px-3 text-[13px] font-semibold text-tinta transition-colors hover:bg-tinta/5"
    >
      <Icone className="size-3.5" aria-hidden />
      {children}
    </a>
  );
}

function Feito({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px] self-start rounded-[11px] bg-verde-suave px-[9px] py-1 text-[11px] font-semibold text-verde">
      <Check className="size-3" aria-hidden />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Fonte oficial                                                        */
/* ------------------------------------------------------------------ */

function CartaoFonte({ cartao }: { cartao: Extract<Cartao, { tipo: "fonte" }> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {cartao.fontes.map((f) => (
        <FonteOficial
          key={`${f.url}#${f.referencia ?? ""}`}
          documento={f.referencia ? `${f.titulo}, ${f.referencia}` : f.titulo}
          data={f.entidade || undefined}
          url={f.url}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 112                                                                  */
/* ------------------------------------------------------------------ */

export function CartaoEmergencia({ texto }: { texto?: string | null }) {
  return (
    <div
      role="alert"
      className="flex w-full flex-col gap-2.5 rounded-2xl bg-[#c62f1f] p-4 text-white"
    >
      <p className="flex items-center gap-2 font-display text-lg font-bold">
        <Siren className="size-[18px]" aria-hidden />
        Isto é uma emergência
      </p>
      <p className="text-sm leading-[1.45] text-white/90">
        {texto ?? "Ligue já para o 112. Não espere por esta conversa."}
      </p>
      <a
        href="tel:112"
        className="inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-white text-base font-extrabold text-[#c62f1f] focus-visible:outline-white"
      >
        <Phone className="size-[17px]" aria-hidden />
        Ligar 112
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contacto de outra entidade (encaminhar)                              */
/* ------------------------------------------------------------------ */

const ROTULO_CONTACTO: Record<string, string> = {
  telefone: "Telefone",
  avarias: "Avarias",
  email: "Email",
  morada: "Morada",
  balcao: "Balcão",
  site: "Site",
};

function hrefContacto(tipo: string, valor: string): string | null {
  if (tipo === "telefone" || tipo === "avarias") return `tel:${valor.replace(/[^\d+]/g, "")}`;
  if (tipo === "email") return `mailto:${valor}`;
  if (tipo === "site") return /^https?:\/\//.test(valor) ? valor : `https://${valor}`;
  if (tipo === "morada" || tipo === "balcao")
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(valor)}`;
  return null;
}

const ICONE_CONTACTO: Record<string, LucideIcon> = {
  telefone: Phone,
  avarias: Phone,
  email: Mail,
  site: Globe,
  morada: MapPin,
  balcao: MapPin,
};

const ACAO_CONTACTO: Record<string, string> = {
  telefone: "Ligar",
  avarias: "Ligar",
  email: "Escrever",
  site: "Abrir",
  morada: "Mapa",
  balcao: "Mapa",
};

function CartaoContacto({ dados }: { dados: Dados }) {
  if (dados.encontrada !== true) return null;
  if (dados.emergencia === true) {
    return <CartaoEmergencia />;
  }
  const entidade = obj(dados.entidade);
  const nome = txt(entidade.nome);
  if (!nome) return null;
  const contactos = [obj(dados.contacto), ...lista(dados.outros_contactos)].filter(
    (c) => txt(c.valor) && txt(c.tipo),
  );
  const destaque = contactos.findIndex((c) => c.tipo === "avarias");
  const iDestaque =
    destaque >= 0
      ? destaque
      : contactos.findIndex((c) => c.tipo === "telefone");
  const agua = /agua|água|saneamento/i.test(`${txt(entidade.tipo) ?? ""} ${nome}`);
  const IconeEntidade = agua ? Droplets : Landmark;

  return (
    <div className={`${CAIXA} gap-2.5 rounded-[4px_16px_16px_16px] border-linha p-3.5`}>
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-white ${agua ? "bg-[#2a7ab8]" : "bg-tinta"}`}
          aria-hidden
        >
          <IconeEntidade className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-bold text-tinta">{nome}</span>
          {txt(entidade.descricao) && (
            <span className="text-[11px] text-tinta-3">{txt(entidade.descricao)}</span>
          )}
        </span>
      </div>
      {contactos.map((c, i) => {
        const tipo = txt(c.tipo) ?? "telefone";
        const valor = txt(c.valor) ?? "";
        const rotulo = [txt(c.rotulo) ?? ROTULO_CONTACTO[tipo] ?? tipo, txt(c.horario)]
          .filter(Boolean)
          .join(", ");
        const href = hrefContacto(tipo, valor);
        const forte = i === iDestaque;
        const Icone = ICONE_CONTACTO[tipo] ?? Phone;
        const conteudo = (
          <>
            <Icone className={`size-[15px] shrink-0 ${forte ? "text-white" : "text-tinta"}`} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`text-[11px] ${forte ? "text-white/80" : "text-tinta-3"}`}>
                {rotulo}
                {c.aberto_agora === false && " · fechado agora"}
              </span>
              <span
                className={`break-words text-[15px] font-bold ${forte ? "text-white" : "text-tinta"}`}
              >
                {valor}
              </span>
            </span>
            {href && (
              <span
                className={`text-xs font-bold ${forte ? "text-white" : "text-terracota-escuro"}`}
              >
                {ACAO_CONTACTO[tipo] ?? "Abrir"}
              </span>
            )}
          </>
        );
        const classe = `flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 ${forte ? "bg-terracota" : "bg-creme"}`;
        return href ? (
          <a
            key={`${tipo}-${valor}`}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className={`${classe} transition-opacity hover:opacity-90`}
            aria-label={`${ACAO_CONTACTO[tipo] ?? "Abrir"}: ${nome}, ${rotulo}, ${valor}`}
          >
            {conteudo}
          </a>
        ) : (
          <div key={`${tipo}-${valor}`} className={classe}>
            {conteudo}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marcação / recolha                                                   */
/* ------------------------------------------------------------------ */

function CartaoMarcacao({
  ferramenta,
  dados,
  acoes,
}: {
  ferramenta: string;
  dados: Dados;
  acoes: AcoesCartao;
}) {
  const recolha = ferramenta === "agendar_recolha";
  const quando = txt(dados.quando);
  const jaExistia = dados.ja_existia === true;
  const titulo = recolha
    ? jaExistia
      ? "A recolha já estava marcada"
      : "Recolha marcada"
    : jaExistia
      ? "Já estava marcado"
      : "Está marcado";
  const levar = textos(dados.levar);
  const itens = lista(dados.itens)
    .map((x) => {
      const item = txt(x.item);
      const qtd = num(x.qtd);
      return item ? (qtd && qtd > 1 ? `${qtd} × ${item}` : item) : null;
    })
    .filter((x): x is string => !!x);
  const link = txt(dados.link);

  return (
    <div className={`${CAIXA} gap-3.5 border-verde p-[18px]`}>
      <p className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-verde" aria-hidden>
          <Check className="size-[18px] text-white" />
        </span>
        <span className="font-display text-xl font-bold tracking-[-0.3px] text-tinta">
          {titulo}
        </span>
      </p>
      <ul className="flex flex-col">
        {quando && (
          <Linha icone={Calendar}>
            <span className="block font-semibold first-letter:uppercase">{quando}</span>
          </Linha>
        )}
        {recolha ? (
          <>
            {txt(dados.morada) && <Linha icone={MapPin}>{txt(dados.morada)}</Linha>}
            {itens.length > 0 && <Linha icone={Package}>{itens.join(", ")}</Linha>}
            {txt(dados.entidade) && (
              <Linha icone={Landmark}>Recolha feita por {txt(dados.entidade)}</Linha>
            )}
          </>
        ) : (
          <>
            {(txt(dados.agenda) || txt(dados.local)) && (
              <Linha icone={MapPin}>
                {txt(dados.agenda)}
                {txt(dados.agenda) && txt(dados.local) && <br />}
                {txt(dados.local)}
              </Linha>
            )}
            {levar.length > 0 && <Linha icone={FileText}>Leve: {levar.join(", ")}</Linha>}
          </>
        )}
      </ul>
      {dados.sms_enviado === true ? (
        <Feito>Enviado por SMS</Feito>
      ) : (
        <BotaoCartao
          icone={MessageSquareText}
          disabled={acoes.ocupado}
          onClick={() =>
            acoes.enviar(
              recolha
                ? "Mande-me a recolha por SMS, por favor."
                : "Mande-me a marcação por SMS, por favor.",
            )
          }
        >
          Receber por SMS
        </BotaoCartao>
      )}
      {link && <LinkCartao href={link}>Ver ou desmarcar</LinkCartao>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simulação de taxas                                                   */
/* ------------------------------------------------------------------ */

const UNIDADE: Record<string, [string, string]> = {
  m2: ["m²", "m²"],
  dia: ["dia", "dias"],
  pagina: ["página", "páginas"],
  fogo: ["fogo", "fogos"],
  mesa: ["mesa", "mesas"],
};

function CartaoSimulacao({ dados }: { dados: Dados }) {
  const linhas = lista(dados.linhas);
  const total = num(dados.total_cent);
  const emFalta = lista(dados.em_falta);
  const fonte = obj(dados.fonte);
  const lidaEm = dataCurta(txt(fonte.lida_em));
  return (
    <div className={`${CAIXA} gap-2.5 border-linha p-4`}>
      <p className="flex items-center gap-2 text-sm font-bold text-tinta">
        <Calculator className="size-4 text-terracota-escuro" aria-hidden />
        Simulação da taxa
      </p>
      <dl className="flex flex-col">
        {linhas.map((l, i) => {
          const desc = txt(l.descricao) ?? txt(l.codigo) ?? "Taxa";
          const q = num(l.quantidade);
          const u = UNIDADE[txt(l.unidade) ?? ""];
          const detalhe = u && q !== null ? `: ${q.toLocaleString("pt-PT")} ${q === 1 ? u[0] : u[1]}` : "";
          const v = num(l.valor_cent);
          return (
            <div
              key={`${txt(l.codigo) ?? i}-${i}`}
              className="flex justify-between gap-3 border-b border-linha py-1.5 text-[13px]"
            >
              <dt className="text-tinta-2">
                {desc}
                {detalhe}
              </dt>
              <dd className="shrink-0 font-semibold text-tinta">{v !== null ? euros(v) : "—"}</dd>
            </div>
          );
        })}
        {total !== null && (
          <div className="flex items-center justify-between pt-1.5">
            <dt className="text-sm font-bold text-tinta">
              {dados.completa === false ? "Total até agora" : "Total"}
            </dt>
            <dd className="font-display text-[26px] font-bold text-terracota-escuro">
              {euros(total)}
            </dd>
          </div>
        )}
      </dl>
      {emFalta.length > 0 && (
        <p className="rounded-[10px] bg-ambar-suave px-3 py-2 text-xs leading-[1.45] text-ambar">
          Falta saber:{" "}
          {emFalta
            .map((f) => txt(f.pergunta) ?? txt(f.descricao))
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {txt(fonte.titulo) && (
        <FonteOficial
          documento={txt(fonte.titulo) ?? ""}
          data={lidaEm ? `Verificada a ${lidaEm}` : undefined}
          url={txt(fonte.url)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagamento                                                            */
/* ------------------------------------------------------------------ */

function CartaoPagamento({ dados }: { dados: Dados }) {
  const valor = num(dados.valor_cent);
  const metodo = txt(dados.metodo);
  const estado = txt(dados.estado);
  const mbway = obj(dados.mbway);
  const link = txt(dados.link);
  const pagarAte = txt(dados.pagar_ate_dito) ?? dataCurta(txt(dados.pagar_ate));
  const linhas: [string, string | null][] = [
    ["Entidade", txt(dados.entidade)],
    ["Referência", txt(dados.referencia)],
    ["Valor", valor !== null ? euros(valor) : null],
  ];
  return (
    <div className={`${CAIXA} gap-3 border-linha p-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-tinta">
          <CreditCard className="size-4 text-terracota-escuro" aria-hidden />
          {metodo === "mbway" ? "Pagamento MB WAY" : "Pagamento por Multibanco"}
        </p>
        {estado === "pago" ? (
          <Etiqueta tom="verde">Pago</Etiqueta>
        ) : estado === "expirado" || estado === "cancelado" ? (
          <Etiqueta tom="ambar">{estado === "expirado" ? "Expirado" : "Cancelado"}</Etiqueta>
        ) : dados.modo_teste === true ? (
          <Etiqueta>Teste</Etiqueta>
        ) : null}
      </div>
      {metodo === "mbway" && txt(mbway.telemovel) ? (
        <p className="text-sm leading-[1.45] text-tinta">
          Pedido enviado para <strong>{txt(mbway.telemovel)}</strong>. Aceite na app MB WAY
          {num(mbway.validade_minutos) ? ` nos próximos ${num(mbway.validade_minutos)} minutos` : ""}.
          {valor !== null && (
            <span className="mt-1 block font-display text-[22px] font-bold text-terracota-escuro">
              {euros(valor)}
            </span>
          )}
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-creme p-3">
          {linhas
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[13px] text-tinta-2">{k}</dt>
                <dd className="text-right font-mono text-[15px] font-bold tabular-nums text-tinta">
                  {v}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {pagarAte && estado !== "pago" && (
        <p className="text-xs text-tinta-2">Pagar até {pagarAte}.</p>
      )}
      {dados.sms_enviado === true && <Feito>Enviado por SMS</Feito>}
      {link && estado !== "pago" && <LinkCartao href={link}>Pagar online</LinkCartao>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rascunho (reclamação, email, pedido)                                 */
/* ------------------------------------------------------------------ */

const TIPO_RASCUNHO: Record<string, string> = {
  reclamacao: "Reclamação",
  email: "Email",
  pedido: "Pedido",
};

function CartaoRascunho({ dados, acoes }: { dados: Dados; acoes: AcoesCartao }) {
  const [copiado, setCopiado] = useState(false);
  const texto = txt(dados.texto) ?? "";
  const assunto = txt(dados.assunto);
  const destinatario = txt(dados.destinatario);
  const rotulo = [TIPO_RASCUNHO[txt(dados.tipo) ?? ""] ?? "Rascunho", destinatario && `para ${destinatario}`]
    .filter(Boolean)
    .join(" · ");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(assunto ? `${assunto}\n\n${texto}` : texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão: a pessoa pode selecionar o texto
    }
  }

  return (
    <div className={`${CAIXA} gap-2.5 border-terracota p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-tinta-3">
          {rotulo}
        </span>
        <button
          type="button"
          onClick={copiar}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-tinta-3 hover:text-tinta"
          aria-label={copiado ? "Texto copiado" : "Copiar o texto"}
        >
          {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      {assunto && <p className="text-[13px] font-semibold text-tinta">{assunto}</p>}
      <p className="whitespace-pre-line text-[13px] leading-normal text-tinta">{texto}</p>
      {txt(dados.proximo_passo) && (
        <p className="text-xs text-tinta-3">{txt(dados.proximo_passo)}</p>
      )}
      <div className="flex gap-2">
        <BotaoCartao
          tom="cheio"
          icone={Send}
          disabled={acoes.ocupado}
          onClick={() => acoes.enviar("Está bem assim, pode enviar.")}
        >
          Enviar assim
        </BotaoCartao>
        <BotaoCartao onClick={() => acoes.escrever("Mude isto no texto: ")}>
          Mudar algo
        </BotaoCartao>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Requerimento (iniciar → preencher → concluir, juntos num cartão)     */
/* ------------------------------------------------------------------ */

function CartaoRequerimento({ dados }: { dados: Dados }) {
  if (dados.encontrado === false) return null;
  const nome = txt(obj(dados.tipo).nome) ?? "Requerimento";
  const campos = lista(dados.campos);
  const emFalta = textos(dados.campos_em_falta);
  const preenchidos = campos.length
    ? Array.isArray(dados.campos_em_falta)
      ? campos.length - emFalta.length
      : campos.filter((c) => c.ja_preenchido === true).length
    : null;
  const docs = obj(dados.documentos);
  const docsFaltam = textos(dados.documentos_em_falta).length
    ? textos(dados.documentos_em_falta)
    : textos(docs.faltam);
  const estado = txt(dados.estado);
  const pronto = estado === "pronto" || estado === "assinado" || estado === "entregue";
  const link = txt(dados.link);
  const idioma = txt(dados.idioma);
  const outraLingua = idioma && !idioma.toLowerCase().startsWith("pt");

  return (
    <div className={`${CAIXA} gap-2.5 border-linha p-4`}>
      {outraLingua && (
        <p className="flex flex-wrap gap-1 self-start rounded-[10px] bg-creme-2 p-[3px] text-[10px]">
          <span className="rounded-lg px-[9px] py-[5px] font-medium text-tinta-2">
            Na sua língua aqui
          </span>
          <span className="rounded-lg bg-papel px-[9px] py-[5px] font-bold text-tinta">
            A câmara recebe em português
          </span>
        </p>
      )}
      <p className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
        <span className="font-serif text-[15px] font-semibold uppercase leading-[1.4] text-tinta">
          {nome}
        </span>
      </p>
      {preenchidos !== null && !pronto && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-tinta-2">
            {preenchidos} de {campos.length} respostas preenchidas
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-creme-2" aria-hidden>
            <span
              className="block h-full rounded-full bg-verde transition-[width]"
              style={{ width: `${Math.round((preenchidos / Math.max(1, campos.length)) * 100)}%` }}
            />
          </span>
        </div>
      )}
      {docsFaltam.length > 0 && (
        <p className="text-xs leading-[1.45] text-tinta-2">
          <strong className="font-semibold text-tinta">Documentos em falta:</strong>{" "}
          {docsFaltam.join(", ")}
        </p>
      )}
      {pronto ? (
        <Feito>
          {estado === "entregue" ? "Entregue" : "Pronto"}
          {dados.sms_enviado === true ? " · enviado por SMS" : ""}
        </Feito>
      ) : (
        <span className="self-start text-[11px] font-semibold text-tinta-3">A preencher</span>
      )}
      {link && <LinkCartao href={link}>Abrir o requerimento</LinkCartao>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ocorrência                                                           */
/* ------------------------------------------------------------------ */

function CartaoOcorrencia({ dados }: { dados: Dados }) {
  if (dados.registada !== true) return null;
  const numero = txt(dados.numero);
  const duplicada = dados.duplicada === true;
  const linkFoto = txt(dados.link_foto);
  return (
    <div className={`${CAIXA} gap-3 border-linha p-4`}>
      <p className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-tinta" aria-hidden>
          <TriangleAlert className="size-4 text-white" />
        </span>
        <span className="flex flex-col">
          <span className="text-[15px] font-bold text-tinta">
            {duplicada ? "Já estava registada" : "Ocorrência registada"}
          </span>
          {numero && (
            <span className="font-mono text-[13px] font-semibold text-verde">N.º {numero}</span>
          )}
        </span>
      </p>
      {txt(dados.categoria) && (
        <p className="rounded-xl bg-creme p-3 text-[13px] leading-[1.45] text-tinta">
          {txt(dados.categoria)}
          {dados.localizada_no_mapa === true && (
            <span className="mt-1 flex items-center gap-1 text-xs text-tinta-2">
              <MapPin className="size-3" aria-hidden /> Localizada no mapa
            </span>
          )}
        </p>
      )}
      {dados.sms_enviado === true && <Feito>Número enviado por SMS</Feito>}
      {linkFoto && <LinkCartao href={linkFoto}>Juntar uma fotografia</LinkCartao>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Passagem a um funcionário (passar_a_humano)                          */
/* ------------------------------------------------------------------ */

const dataHora = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat("pt-PT", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
};

function CartaoPassagem({ dados }: { dados: Dados }) {
  const ate = dataHora(txt(dados.responder_ate));
  const dizer = txt(dados.dizer);
  if (!ate && !dizer) return null;
  return (
    <div className={`${CAIXA} gap-2.5 border-linha p-4`}>
      <p className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-tinta" aria-hidden>
          <UserRound className="size-4 text-white" />
        </span>
        <span className="text-[15px] font-bold text-tinta">Passado a um funcionário</span>
      </p>
      {dizer && <p className="text-[13px] leading-[1.45] text-tinta">{dizer}</p>}
      {ate && (
        <p className="flex items-center gap-1.5 text-xs text-tinta-2">
          <Clock className="size-3.5" aria-hidden />
          <span className="first-letter:uppercase">Resposta até {ate}</span>
        </p>
      )}
      {dados.fora_de_horas === true && (
        <span className="self-start rounded-[11px] bg-ambar-suave px-[9px] py-1 text-[11px] font-semibold text-ambar">
          Fora do horário de atendimento
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vagas para atendimento marcado (ver_vagas)                           */
/* ------------------------------------------------------------------ */

function CartaoVagas({ dados, acoes }: { dados: Dados; acoes: AcoesCartao }) {
  if (dados.precisa_escolher === true) {
    const agendas = lista(dados.agendas).filter((a) => txt(a.nome));
    if (!agendas.length) return null;
    return (
      <div className={`${CAIXA} gap-2.5 border-linha p-4`}>
        <p className="flex items-center gap-2 text-sm font-bold text-tinta">
          <Calendar className="size-4 text-terracota-escuro" aria-hidden />
          Para que serviço?
        </p>
        <div className="flex flex-col gap-1.5">
          {agendas.map((a) => (
            <BotaoCartao
              key={txt(a.agenda_id) ?? txt(a.nome)}
              disabled={acoes.ocupado}
              onClick={() => acoes.enviar(`Quero marcar para ${txt(a.nome)}.`)}
            >
              {txt(a.nome)}
            </BotaoCartao>
          ))}
        </div>
      </div>
    );
  }
  const agenda = obj(dados.agenda);
  const vagas = lista(dados.vagas).filter((v) => txt(v.inicio) && txt(v.dito));
  return (
    <div className={`${CAIXA} gap-2.5 border-linha p-4`}>
      <p className="flex items-center gap-2 text-sm font-bold text-tinta">
        <Calendar className="size-4 text-terracota-escuro" aria-hidden />
        {txt(agenda.nome) ?? "Vagas"}
      </p>
      {txt(agenda.local) && (
        <p className="flex items-center gap-1.5 text-xs text-tinta-2">
          <MapPin className="size-3.5" aria-hidden />
          {txt(agenda.local)}
        </p>
      )}
      {vagas.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {vagas.map((v) => (
            <BotaoCartao
              key={txt(v.inicio)}
              disabled={acoes.ocupado}
              onClick={() => acoes.enviar(`Prefiro ${txt(v.dito)}.`)}
            >
              <span className="first-letter:uppercase">{txt(v.dito)}</span>
            </BotaoCartao>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-tinta-2">
          {txt(dados.mensagem) ?? "Não há vagas nestes dias."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado de processos (estado_processo)                                */
/* ------------------------------------------------------------------ */

function CartaoProcesso({ dados }: { dados: Dados }) {
  // A identificação por SMS aparece à parte (IdentificacaoSms).
  if (dados.precisa_identificacao === true) return null;
  const processos = lista(dados.processos).filter((p) => txt(p.numero));
  if (!processos.length) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      {processos.map((p) => {
        const falta = lista(p.falta_da_sua_parte)
          .map((f) => {
            const nome = txt(f.nome);
            const prazo = dataCurta(txt(f.prazo));
            return nome ? (prazo ? `${nome} (até ${prazo})` : nome) : null;
          })
          .filter((x): x is string => !!x);
        const prazo = dataCurta(txt(p.prazo_fim));
        const dias = num(p.dias_uteis_restantes);
        return (
          <div key={txt(p.numero)} className={`${CAIXA} gap-2 border-linha p-4`}>
            <p className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[13px] font-semibold text-tinta">{txt(p.numero)}</span>
                {txt(p.tipo) && <span className="text-xs text-tinta-2">{txt(p.tipo)}</span>}
              </span>
            </p>
            {txt(p.fase) && <Etiqueta className="self-start">{txt(p.fase)}</Etiqueta>}
            {prazo && (
              <p className="text-xs text-tinta-2">
                Prazo da câmara: {prazo}
                {dias !== null && dias >= 0 ? ` (${dias} dias úteis)` : ""}
              </p>
            )}
            {falta.length > 0 && (
              <p className="rounded-[10px] bg-ambar-suave px-3 py-2 text-xs leading-[1.45] text-ambar">
                Falta da sua parte: {falta.join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Apoios (que_apoios_tenho, pedir_apoio)                               */
/* ------------------------------------------------------------------ */

function CartaoApoios({ ferramenta, dados }: { ferramenta: string; dados: Dados }) {
  if (ferramenta === "pedir_apoio") {
    const numero = txt(dados.numero);
    if (dados.pedido !== true || !numero) return null;
    const docs = textos(dados.documentos);
    return (
      <div className={`${CAIXA} gap-2 border-linha p-4`}>
        <p className="flex items-start gap-2">
          <HandCoins className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="font-mono text-[13px] font-semibold text-tinta">{numero}</span>
            <span className="text-xs text-tinta-2">Pedido de apoio</span>
          </span>
        </p>
        {dados.ja_existia === true ? (
          <Etiqueta className="self-start">já tinha pedido</Etiqueta>
        ) : (
          <Feito>Pedido feito</Feito>
        )}
        {docs.length > 0 && (
          <ul className="flex flex-col">
            {docs.map((d) => (
              <Linha key={d} icone={FileText}>
                {d}
              </Linha>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const tem = lista(dados.tem_direito).filter((x) => txt(x.nome));
  const talvez = lista(dados.talvez)
    .map((x) => txt(x.nome))
    .filter((x): x is string => !!x);
  // Enquanto pergunta o que falta, sem apoios ainda: nada a mostrar.
  if (!tem.length && dados.respondido !== true) return null;
  const link = txt(dados.link);
  return (
    <div className={`${CAIXA} gap-2 border-linha p-4`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-tinta">
        <HandCoins className="size-4 shrink-0 text-terracota-escuro" aria-hidden />
        {tem.length ? "Pode ter direito a" : "Apoios"}
      </p>
      {tem.length > 0 ? (
        <ul className="flex flex-col">
          {tem.map((x) => (
            <Linha key={txt(x.apoio) ?? txt(x.nome)} icone={Check}>
              <span className="font-semibold">{txt(x.nome)}</span>
              {txt(x.valor) && <span className="block text-xs text-tinta-2">{txt(x.valor)}</span>}
            </Linha>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tinta-2">Não encontrámos nenhum apoio a que tenha direito.</p>
      )}
      {talvez.length > 0 && <p className="text-xs text-tinta-2">Talvez também: {talvez.join(", ")}</p>}
      {dados.valores_de_demonstracao === true && (
        <Etiqueta className="self-start">valores de demonstração</Etiqueta>
      )}
      {link && dados.respondido === true && <LinkCartao href={link}>Ver a lista e o que entregar</LinkCartao>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** O cartão certo para cada tipo (os desconhecidos não aparecem). */
export function CartaoChat({ cartao, acoes }: { cartao: Cartao; acoes: AcoesCartao }) {
  switch (cartao.tipo) {
    case "fonte":
      return <CartaoFonte cartao={cartao} />;
    case "emergencia":
      return <CartaoEmergencia />;
    case "contacto":
      return <CartaoContacto dados={cartao.dados} />;
    case "marcacao":
      return <CartaoMarcacao ferramenta={cartao.ferramenta} dados={cartao.dados} acoes={acoes} />;
    case "simulacao":
      return <CartaoSimulacao dados={cartao.dados} />;
    case "pagamento":
      return <CartaoPagamento dados={cartao.dados} />;
    case "rascunho":
      return <CartaoRascunho dados={cartao.dados} acoes={acoes} />;
    case "requerimento":
      return <CartaoRequerimento dados={cartao.dados} />;
    case "ocorrencia":
      return <CartaoOcorrencia dados={cartao.dados} />;
    case "passagem":
      return <CartaoPassagem dados={cartao.dados} />;
    case "vagas":
      return <CartaoVagas dados={cartao.dados} acoes={acoes} />;
    case "processo":
      return <CartaoProcesso dados={cartao.dados} />;
    case "apoios":
      return <CartaoApoios ferramenta={cartao.ferramenta} dados={cartao.dados} />;
    default:
      return null;
  }
}
