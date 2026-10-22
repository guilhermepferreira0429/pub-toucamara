"use client";

import {
  BellRing,
  BookOpen,
  CalendarClock,
  Camera,
  CircleCheck,
  FileQuestion,
  FolderOpen,
  Images,
  Info,
  ListChecks,
  LoaderCircle,
  PenLine,
  Quote,
  Send,
  TriangleAlert,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { Botao } from "@/components/ui/botao";
import {
  ErroFicheiroCarta,
  prepararFicheiroCarta,
} from "@/components/cartas/ficheiro-carta";
import { api } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  ModoTeste,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

/*
 * /carta/[codigo] — "Não percebi esta carta da câmara". O link do SMS (na
 * chamada), do chat e da app: tirar a fotografia (se ainda não chegou), a
 * explicação em linguagem simples, o prazo calculado, o que acontece se não
 * fizer nada, o processo e o rascunho da resposta para rever e confirmar.
 * Telemóvel primeiro, letra grande, um passo de cada vez.
 */

interface Excerto {
  valor: string | null;
  excerto: string | null;
}

interface Prazo {
  estado: "calculado" | "sem_prazo" | "falta_data";
  inicio: string | null;
  inicio_origem: "notificacao" | "rececao_dita" | "data_documento" | null;
  data_limite: string | null;
  dias: number | null;
  unidade: "uteis" | "corridos" | null;
  faltam_dias_uteis: number | null;
  faltam_dias: number | null;
  terminou: boolean;
  regra: string;
  fontes: string[];
}

type TipoResposta = "pronuncia" | "prorrogacao" | "elementos" | "pagamento";

interface Resposta {
  id: string;
  tipo: TipoResposta;
  rotulo: string;
  texto: string;
  estado: "rascunho" | "entregue";
  numero_entrada: string | null;
  entregue_em: string | null;
  pagamento: {
    entidade: string | null;
    referencia: string | null;
    valor_cent: number | null;
    pagar_ate: string | null;
    estado: string | null;
    modo_teste: boolean;
  } | null;
}

export interface CartaPublica {
  codigo: string;
  link: string;
  municipio: string;
  estado: "a_espera" | "lida" | "ilegivel" | "respondida";
  demonstracao: boolean;
  ia_disponivel: boolean;
  leituras_restantes: number;
  leitura: {
    da_camara: boolean;
    entidade_emissora: string | null;
    tipo: string;
    tipo_rotulo: string;
    assunto: string;
    explicacao: string;
    o_que_e: string;
    referencia: Excerto;
    data_documento: Excerto;
    data_notificacao: Excerto;
    prazo_lido: {
      encontrado: boolean;
      dias: number | null;
      base_legal: string | null;
      excerto: string | null;
    };
    pedido: { o_que: string; excerto: string }[];
    valores: { descricao: string; valor_cent: number; referencia_mb: string | null; excerto: string }[];
    consequencias: { texto: string; excerto: string | null; origem: "carta" | "regra_geral" }[];
    motivo_ilegivel: string | null;
    termos: { termo: string; explicacao: string; fonte_legal: string | null; demonstracao: boolean }[];
  } | null;
  prazo: Prazo | null;
  prazo_frase: string | null;
  pergunta_rececao: boolean;
  data_rececao_dita: string | null;
  processo: {
    numero: string;
    assunto: string;
    fase_rotulo: string;
    fase_em_palavras: string;
    linha_do_tempo: { em: string; descricao: string }[];
    faltam: string[];
    pode_enviar_documentos: boolean;
    link: string;
  } | null;
  precisa_identificacao: boolean;
  encaminhamento: {
    entidade: string;
    dizer: string;
    encaminhar: {
      contacto?: { valor: string; rotulo: string | null; horario: string | null } | null;
    } | null;
  } | null;
  respostas_possiveis: { tipo: TipoResposta; rotulo: string }[];
  respostas: Resposta[];
  lembrar: boolean;
  lembrete_dias_uteis: number;
  aviso: string;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** '2026-11-05' → '5 de novembro'. */
function dia(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

const euros = (c: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(c / 100);

function hojeIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

/** "Na carta: «…»": de onde veio, para a pessoa confirmar. */
function NaCarta({ excerto }: { excerto: string | null }) {
  if (!excerto) return null;
  return (
    <blockquote className="flex gap-2 rounded-xl border-l-4 border-linha bg-creme-2 px-3 py-2 text-[14px] leading-[1.45] text-tinta-2">
      <Quote className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
      <span>
        <span className="sr-only">Na carta: </span>«{excerto}»
      </span>
    </blockquote>
  );
}

export function PaginaCarta({ codigo }: { codigo: string }) {
  const caminho = `/v1/public/cartas/${encodeURIComponent(codigo)}`;
  const { c, definir, tentarOutraVez } = usePublico<CartaPublica>(caminho);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const carta = c.dados;
  const l = carta.leitura;
  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={l?.referencia.valor ?? "A sua carta"} mono={!!l?.referencia.valor} />
      {carta.estado === "a_espera" || (carta.estado === "ilegivel" && l) ? (
        <EnviarCarta carta={carta} caminho={caminho} aoLer={definir} />
      ) : l ? (
        <Explicacao carta={carta} caminho={caminho} definir={definir} />
      ) : null}
      <MaisDuvidas nota={carta.aviso} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tirar a fotografia                                                   */
/* ------------------------------------------------------------------ */

function EnviarCarta({
  carta,
  caminho,
  aoLer,
}: {
  carta: CartaPublica;
  caminho: string;
  aoLer: (c: CartaPublica) => void;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [aLer, setALer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const outra = carta.estado === "ilegivel";

  async function enviar(f: File | undefined) {
    if (!f) return;
    setErro(null);
    setALer(true);
    try {
      const corpo = await prepararFicheiroCarta(f);
      aoLer(await api<CartaPublica>(`${caminho}/ficheiro`, { corpo }));
    } catch (e) {
      setErro(e instanceof ErroFicheiroCarta ? e.message : mensagemDe(e));
    } finally {
      setALer(false);
    }
  }

  return (
    <>
      <Cabecalho
        meta={`Câmara Municipal de ${carta.municipio}`}
        titulo={outra ? "Tire outra fotografia à carta." : "Não percebeu uma carta? Mostre-nos."}
        sub="Tire uma fotografia à carta (ou escolha o PDF). Explicamos o que quer dizer, até quando tem para responder e ajudamos a preparar a resposta."
      />
      {outra && carta.leitura?.motivo_ilegivel && (
        <Nota icone={TriangleAlert} tom="terracota" papel="alert">
          {carta.leitura.motivo_ilegivel}
        </Nota>
      )}
      <ul className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-5 text-[15px] text-tinta">
        <li>• A carta toda, de cima a baixo, com boa luz.</li>
        <li>• Sem reflexos nem dedos por cima do texto.</li>
        <li>• Se tiver várias folhas, a folha com o prazo e o assunto.</li>
      </ul>
      <input
        ref={camara}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void enviar(f);
        }}
      />
      <input
        ref={galeria}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void enviar(f);
        }}
      />
      {aLer ? (
        <div role="status" className="flex flex-col items-center gap-3 rounded-2xl bg-creme-2 py-8 text-tinta-2">
          <LoaderCircle className="size-8 animate-spin text-terracota" aria-hidden />
          <p className="text-[16px]">A ler a carta… pode demorar uns segundos.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Botao tamanho="grande" icone={Camera} className="w-full" onClick={() => camara.current?.click()}>
            Tirar fotografia
          </Botao>
          <Botao
            tamanho="grande"
            variante="secundario"
            icone={Images}
            className="w-full"
            onClick={() => galeria.current?.click()}
          >
            Escolher fotografia ou PDF
          </Botao>
        </div>
      )}
      {erro && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        A fotografia serve só para lermos a carta. Não guardamos o seu NIF nem
        outros dados pessoais que lá apareçam.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A explicação                                                         */
/* ------------------------------------------------------------------ */

function Explicacao({
  carta,
  caminho,
  definir,
}: {
  carta: CartaPublica;
  caminho: string;
  definir: (c: CartaPublica) => void;
}) {
  const l = carta.leitura!;
  if (!l.da_camara) {
    const contacto = carta.encaminhamento?.encaminhar?.contacto ?? null;
    return (
      <>
        <Cabecalho meta="A sua carta" titulo="Esta carta não é da câmara." sub={l.explicacao} />
        <CartaoDestaque tom="tinta" rotulo="Quem a mandou">
          <p className="font-display text-[24px] font-bold leading-tight">
            {carta.encaminhamento?.entidade ?? l.entidade_emissora ?? "Outra entidade"}
          </p>
          <p className="text-[15px] text-white/90">
            Só quem mandou a carta pode tratar dela. A câmara não consegue responder por si.
          </p>
          {contacto && (
            <p className="text-[15px] font-semibold">
              {contacto.rotulo ? `${contacto.rotulo}: ` : ""}
              {contacto.valor}
              {contacto.horario ? ` · ${contacto.horario}` : ""}
            </p>
          )}
        </CartaoDestaque>
      </>
    );
  }
  return (
    <>
      <Cabecalho
        meta={`Câmara Municipal de ${carta.municipio}`}
        titulo={l.tipo_rotulo}
        sub={l.assunto}
      />
      {carta.demonstracao && (
        <span className="self-start">
          <ModoTeste texto="leitura de demonstração" />
        </span>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="o-que-e">
        <TituloSecao id="o-que-e">O que quer dizer</TituloSecao>
        <p className="text-[18px] leading-[1.5] text-tinta">{l.explicacao}</p>
        <p className="text-[15px] leading-[1.5] text-tinta-2">{l.o_que_e}</p>
      </section>

      <BlocoPrazo carta={carta} caminho={caminho} definir={definir} />

      {l.pedido.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="pedem">
          <TituloSecao id="pedem">O que lhe pedem</TituloSecao>
          <ul className="flex flex-col gap-3">
            {l.pedido.map((p) => (
              <li key={p.o_que} className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
                <p className="flex gap-2 text-[16px] text-tinta">
                  <ListChecks className="mt-1 size-5 shrink-0 text-terracota" aria-hidden />
                  {p.o_que}
                </p>
                <NaCarta excerto={p.excerto} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {l.valores.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="valores">
          <TituloSecao id="valores">Valores na carta</TituloSecao>
          {l.valores.map((v) => (
            <div key={v.excerto} className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
              <p className="text-[16px] text-tinta">
                <b>{euros(v.valor_cent)}</b> · {v.descricao}
              </p>
              {v.referencia_mb && <p className="text-[14px] text-tinta-2">Pagamento: {v.referencia_mb}</p>}
              <NaCarta excerto={v.excerto} />
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="se-nada">
        <TituloSecao id="se-nada">Se não fizer nada</TituloSecao>
        {l.consequencias.map((x) => (
          <div key={x.texto} className="flex flex-col gap-2">
            <p className="flex gap-2 text-[16px] text-tinta">
              <TriangleAlert className="mt-1 size-5 shrink-0 text-ambar" aria-hidden />
              {x.texto}
            </p>
            {x.origem === "carta" ? (
              <NaCarta excerto={x.excerto} />
            ) : (
              <p className="text-[13px] text-tinta-3">
                A carta não o diz: é o que acontece em regra. Confirme com a câmara.
              </p>
            )}
          </div>
        ))}
      </section>

      {l.termos.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="palavras">
          <TituloSecao id="palavras">Palavras difíceis da carta</TituloSecao>
          <dl className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-4">
            {l.termos.map((t) => (
              <div key={t.termo} className="flex flex-col gap-0.5">
                <dt className="flex items-center gap-2 text-[16px] font-bold text-tinta">
                  <BookOpen className="size-4 text-terracota" aria-hidden />
                  {t.termo}
                </dt>
                <dd className="text-[15px] leading-[1.45] text-tinta-2">
                  {t.explicacao}
                  {t.fonte_legal ? <span className="block text-[12px] text-tinta-3">{t.fonte_legal}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {carta.processo && <BlocoProcesso p={carta.processo} />}
      {carta.precisa_identificacao && (
        <Nota icone={Info} tom="neutro">
          Esta carta é de um processo da câmara. Para a ligarmos ao seu processo,
          identifique-se no chat ou por telefone.
        </Nota>
      )}

      <BlocoResposta carta={carta} caminho={caminho} definir={definir} />
      <BlocoLembrete carta={carta} caminho={caminho} definir={definir} />
    </>
  );
}

function BlocoPrazo({
  carta,
  caminho,
  definir,
}: {
  carta: CartaPublica;
  caminho: string;
  definir: (c: CartaPublica) => void;
}) {
  const p = carta.prazo;
  const l = carta.leitura!;
  const idData = useId();
  const [data, setData] = useState(carta.data_rececao_dita ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!data) return;
    setErro(null);
    setAGuardar(true);
    try {
      definir(await api<CartaPublica>(`${caminho}/rececao`, { corpo: { data } }));
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="prazo">
      <TituloSecao id="prazo">Até quando tem</TituloSecao>
      {p?.estado === "calculado" && p.data_limite ? (
        <CartaoDestaque tom={p.terminou ? "tinta" : "terracota"} rotulo="Prazo para responder">
          <p className="flex items-center gap-2 font-display text-[28px] leading-tight font-bold">
            <CalendarClock className="size-7 shrink-0" aria-hidden />
            {p.terminou ? `Terminou a ${dia(p.data_limite)}` : `Até ${dia(p.data_limite)}`}
          </p>
          {!p.terminou && p.faltam_dias_uteis !== null && (
            <p className="text-[17px] font-semibold">
              {p.faltam_dias === 0
                ? "Termina hoje."
                : `Faltam ${p.faltam_dias_uteis} ${p.faltam_dias_uteis === 1 ? "dia útil" : "dias úteis"}.`}
            </p>
          )}
          <p className="text-[14px] leading-[1.45] text-white/90">{p.regra}</p>
          {p.inicio && (
            <p className="text-[13px] text-white/80">
              A contar de {dia(p.inicio)}
              {p.inicio_origem === "rececao_dita" ? " (o dia em que disse que a recebeu)" : ""}.
            </p>
          )}
        </CartaoDestaque>
      ) : (
        <Nota icone={Info} tom="ambar" papel="status">
          {p?.estado === "falta_data"
            ? `A carta dá ${p.dias} dias ${p.unidade === "corridos" ? "seguidos" : "úteis"} a contar do dia em que a recebeu. Diga-nos esse dia e calculamos a data-limite.`
            : "Não encontrámos um prazo escrito na carta, por isso não lhe damos uma data. Se a carta disser “no prazo de … dias”, diga-nos em que dia a recebeu, ou confirme com a câmara."}
        </Nota>
      )}
      <NaCarta excerto={l.prazo_lido.excerto} />
      {p && p.fontes.length > 0 && (
        <p className="text-[12px] text-tinta-3">Base: {p.fontes.join(" · ")}</p>
      )}
      {carta.estado !== "respondida" && (
        <form onSubmit={guardar} className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
          <label htmlFor={idData} className="text-[15px] font-semibold text-tinta">
            {p?.estado === "calculado" ? "Recebeu a carta noutro dia?" : "Em que dia recebeu a carta?"}
          </label>
          <div className="flex gap-2">
            <input
              id={idData}
              type="date"
              max={hojeIso()}
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="h-12 min-w-0 flex-1 rounded-xl border border-linha bg-creme px-3 text-[16px] text-tinta"
            />
            <Botao type="submit" disabled={!data || aGuardar}>
              {aGuardar ? "A calcular…" : "Calcular"}
            </Botao>
          </div>
          {erro && (
            <p role="alert" className="text-[14px] text-terracota-escuro">
              {erro}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function BlocoProcesso({ p }: { p: NonNullable<CartaPublica["processo"]> }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="processo">
      <TituloSecao id="processo">O seu processo</TituloSecao>
      <div className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-4">
        <p className="flex items-center gap-2 text-[16px] font-bold text-tinta">
          <FolderOpen className="size-5 text-terracota" aria-hidden />
          {p.numero} · {p.assunto}
        </p>
        <p className="text-[15px] text-tinta-2">O seu processo {p.fase_em_palavras}.</p>
        {p.linha_do_tempo.length > 0 && (
          <ol className="flex flex-col gap-1.5 border-l-2 border-linha pl-3">
            {p.linha_do_tempo.map((e) => (
              <li key={`${e.em}${e.descricao}`} className="text-[14px] text-tinta-2">
                <span className="text-tinta-3">
                  {new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" }).format(new Date(e.em))}
                </span>{" "}
                · {e.descricao}
              </li>
            ))}
          </ol>
        )}
        <a
          href={p.link}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-[15px] font-semibold text-tinta hover:bg-tinta/5"
        >
          {p.pode_enviar_documentos ? "Ver o processo e enviar documentos" : "Ver o processo"}
        </a>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Preparar e entregar a resposta                                       */
/* ------------------------------------------------------------------ */

const PERGUNTA: Partial<Record<TipoResposta, string>> = {
  pronuncia: "Por palavras suas: porque não concorda? Escreva como falaria. Nós pomos em linguagem formal.",
  prorrogacao: "Porque precisa de mais tempo? (por exemplo: estou à espera de um documento)",
};

function BlocoResposta({
  carta,
  caminho,
  definir,
}: {
  carta: CartaPublica;
  caminho: string;
  definir: (c: CartaPublica) => void;
}) {
  const [escolha, setEscolha] = useState<TipoResposta | null>(null);
  const [argumentos, setArgumentos] = useState("");
  const [aPreparar, setAPreparar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idArgs = useId();
  const rascunhos = carta.respostas;

  async function preparar(tipo: TipoResposta) {
    setErro(null);
    setAPreparar(true);
    try {
      const r = await api<{ carta: CartaPublica }>(`${caminho}/respostas`, {
        corpo: { tipo, argumentos: argumentos.trim() || undefined },
      });
      definir(r.carta);
      setEscolha(null);
      setArgumentos("");
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setAPreparar(false);
    }
  }

  if (!carta.respostas_possiveis.length && !rascunhos.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="responder">
      <TituloSecao id="responder">Responder à câmara</TituloSecao>
      {rascunhos.map((r) => (
        <Rascunho key={r.id} r={r} caminho={caminho} definir={definir} />
      ))}
      {carta.respostas_possiveis.length > 0 && (
        <>
          <p className="text-[15px] text-tinta-2">
            Preparamos o texto consigo. Lê, muda o que quiser e só depois confirma.
          </p>
          <div className="flex flex-col gap-2">
            {carta.respostas_possiveis.map((o) => (
              <Botao
                key={o.tipo}
                tamanho="grande"
                variante={escolha === o.tipo ? "principal" : "secundario"}
                icone={PenLine}
                className="w-full"
                aria-pressed={escolha === o.tipo}
                disabled={aPreparar}
                onClick={() => (PERGUNTA[o.tipo] ? setEscolha(o.tipo) : void preparar(o.tipo))}
              >
                {o.rotulo}
              </Botao>
            ))}
          </div>
          {escolha && PERGUNTA[escolha] && (
            <div className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
              <label htmlFor={idArgs} className="text-[15px] font-semibold text-tinta">
                {PERGUNTA[escolha]}
              </label>
              <textarea
                id={idArgs}
                rows={5}
                value={argumentos}
                maxLength={3000}
                onChange={(e) => setArgumentos(e.target.value)}
                className="rounded-xl border border-linha bg-creme p-3 text-[16px] leading-[1.45] text-tinta"
              />
              <Botao tamanho="grande" className="w-full" disabled={aPreparar} onClick={() => void preparar(escolha)}>
                {aPreparar ? "A preparar…" : "Preparar o rascunho"}
              </Botao>
            </div>
          )}
        </>
      )}
      {erro && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}
    </section>
  );
}

function Rascunho({
  r,
  caminho,
  definir,
}: {
  r: Resposta;
  caminho: string;
  definir: (c: CartaPublica) => void;
}) {
  const [texto, setTexto] = useState(r.texto);
  const [confirmo, setConfirmo] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idTexto = useId();
  const idConfirmo = useId();
  const mudou = texto.trim() !== r.texto.trim();

  async function guardar() {
    setErro(null);
    setAEnviar(true);
    try {
      definir(
        await api<CartaPublica>(`${caminho}/respostas/${r.id}`, {
          metodo: "PATCH",
          corpo: { texto },
        }),
      );
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setAEnviar(false);
    }
  }

  async function entregar() {
    setErro(null);
    setAEnviar(true);
    try {
      if (mudou) {
        await api(`${caminho}/respostas/${r.id}`, { metodo: "PATCH", corpo: { texto } });
      }
      const x = await api<{ carta: CartaPublica }>(`${caminho}/respostas/${r.id}/entregar`, {
        metodo: "POST",
      });
      definir(x.carta);
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setAEnviar(false);
    }
  }

  if (r.estado === "entregue") {
    return (
      <section className="flex w-full flex-col gap-1.5 rounded-[20px_20px_20px_6px] bg-verde-suave p-[18px]">
        <p className="flex items-center gap-2 font-display text-[20px] font-bold text-verde">
          <CircleCheck className="size-6" aria-hidden />
          Resposta entregue
        </p>
        <p className="text-[15px] text-tinta">
          {r.rotulo}. Número de entrada {r.numero_entrada}.
        </p>
        <span className="self-start">
          <ModoTeste texto="entrega simulada · sem valor legal" />
        </span>
      </section>
    );
  }

  if (r.tipo === "pagamento") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-linha bg-papel p-4">
        <Rotulo>Pagar</Rotulo>
        <p className="text-[16px] leading-[1.5] text-tinta">{r.texto}</p>
        {r.pagamento?.modo_teste && (
          <span className="self-start">
            <ModoTeste />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-4">
      <label htmlFor={idTexto} className="flex items-center gap-2 text-[16px] font-bold text-tinta">
        <FileQuestion className="size-5 text-terracota" aria-hidden />
        Rascunho: {r.rotulo}
      </label>
      <p className="text-[14px] text-tinta-2">
        Leia com calma. Pode mudar o texto aqui. Complete o que está entre [ ].
      </p>
      <textarea
        id={idTexto}
        rows={14}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="rounded-xl border border-linha bg-creme p-3 font-mono text-[14px] leading-[1.5] text-tinta"
      />
      {mudou && (
        <Botao variante="secundario" disabled={aEnviar} onClick={() => void guardar()}>
          Guardar alterações
        </Botao>
      )}
      <label htmlFor={idConfirmo} className="flex items-start gap-3 text-[15px] text-tinta">
        <input
          id={idConfirmo}
          type="checkbox"
          checked={confirmo}
          onChange={(e) => setConfirmo(e.target.checked)}
          className="mt-1 size-5 accent-terracota"
        />
        Li o texto e quero que seja entregue à câmara em meu nome.
      </label>
      <Botao
        tamanho="grande"
        icone={Send}
        className="w-full"
        disabled={!confirmo || aEnviar || texto.includes("[O seu nome]")}
        onClick={() => void entregar()}
      >
        {aEnviar ? "A entregar…" : "Confirmar e entregar"}
      </Botao>
      {texto.includes("[O seu nome]") && (
        <p className="text-[13px] text-tinta-3">Escreva o seu nome no lugar de [O seu nome].</p>
      )}
      <span className="self-start">
        <ModoTeste texto="entrega simulada" />
      </span>
      {erro && (
        <p role="alert" className="text-[14px] text-terracota-escuro">
          {erro}
        </p>
      )}
    </div>
  );
}

function BlocoLembrete({
  carta,
  caminho,
  definir,
}: {
  carta: CartaPublica;
  caminho: string;
  definir: (c: CartaPublica) => void;
}) {
  const [aGuardar, setAGuardar] = useState(false);
  if (carta.estado === "respondida" || carta.prazo?.estado !== "calculado" || carta.prazo.terminou) {
    return null;
  }
  async function mudar(lembrar: boolean) {
    setAGuardar(true);
    try {
      definir(await api<CartaPublica>(`${caminho}/lembrete`, { corpo: { lembrar } }));
    } finally {
      setAGuardar(false);
    }
  }
  return (
    <label className="flex items-start gap-3 rounded-2xl bg-creme-2 p-4 text-[15px] text-tinta">
      <input
        type="checkbox"
        checked={carta.lembrar}
        disabled={aGuardar}
        onChange={(e) => void mudar(e.target.checked)}
        className="mt-1 size-5 accent-terracota"
      />
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 font-semibold">
          <BellRing className="size-4 text-terracota" aria-hidden />
          Lembrar-me antes do fim do prazo
        </span>
        <span className="text-[14px] text-tinta-2">
          Avisamos {carta.lembrete_dias_uteis} dias úteis antes, se ainda não tiver respondido.
        </span>
      </span>
    </label>
  );
}
