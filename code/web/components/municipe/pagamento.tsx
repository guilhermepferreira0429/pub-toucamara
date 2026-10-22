"use client";

import {
  Check,
  CircleCheck,
  Copy,
  FlaskConical,
  Info,
  Landmark,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { contagem, dataLonga, euros } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Rotulo,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

type EstadoPedido = "por_aceitar" | "pago" | "expirado" | "cancelado";

interface PagamentoPublico {
  municipio: string;
  guia_numero: string | null;
  valor_cent: number;
  valor_texto: string;
  linhas: { codigo: string; descricao: string; quantidade: number; valor_cent: number }[];
  metodo: "multibanco" | "mbway" | "cartao" | null;
  mb_entidade: string | null;
  mb_referencia: string | null;
  pagar_ate: string | null;
  estado: "pendente" | "pago" | "expirado" | "cancelado";
  pago_em: string | null;
  modo_teste: boolean;
  mbway: {
    telemovel: string;
    estado: EstadoPedido;
    expira_em: string;
    segundos_restantes: number;
    validade_minutos: number;
    pedidos_feitos: number;
    pedidos_restantes: number;
    pode_reenviar: boolean;
  } | null;
}

type Metodo = "mbway" | "multibanco";

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto.replace(/\s/g, ""));
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // sem permissão: a pessoa copia à mão
        }
      }}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-linha bg-white px-3 text-[13px] font-semibold text-tinta hover:bg-creme-2"
    >
      {copiado ? <Check className="size-4 text-verde" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
      <span className="sr-only"> {rotulo}</span>
    </button>
  );
}

/** Contagem decrescente do pedido MB WAY, a partir de `segundos_restantes`. */
function Contagem({ segundos, onFim }: { segundos: number; onFim: () => void }) {
  const [restante, setRestante] = useState(segundos);
  const fimRef = useRef(onFim);
  useEffect(() => {
    fimRef.current = onFim;
  }, [onFim]);
  useEffect(() => {
    const fim = Date.now() + segundos * 1000;
    const t = setInterval(() => {
      const r = Math.max(0, Math.round((fim - Date.now()) / 1000));
      setRestante(r);
      if (r === 0) {
        clearInterval(t);
        fimRef.current();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [segundos]);
  const c = contagem(restante);
  // Leitores de ecrã: só de minuto a minuto (e nos últimos 30 s), não a cada segundo.
  const anunciar = restante % 60 === 0 || restante === 30;
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <span
        className="font-mono text-[40px] font-bold tracking-[-1px] text-tinta tabular-nums"
        aria-hidden
      >
        {c.curto}
      </span>
      <span className="sr-only" aria-live="polite">
        {anunciar ? `Faltam ${c.dito}.` : ""}
      </span>
      <span className="text-[14px] text-tinta-2">para aceitar na app MB WAY</span>
    </div>
  );
}

function Opcao({
  nome,
  valor,
  escolhido,
  onEscolher,
  titulo,
  detalhe,
  extra,
  children,
}: {
  nome: string;
  valor: Metodo;
  escolhido: boolean;
  onEscolher: (m: Metodo) => void;
  titulo: string;
  detalhe?: string;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex w-full flex-col gap-3 rounded-2xl border bg-papel p-4 ${escolhido ? "border-terracota" : "border-linha"}`}
    >
      <label className="flex min-h-7 cursor-pointer items-center gap-2.5">
        <input
          type="radio"
          name={nome}
          value={valor}
          checked={escolhido}
          onChange={() => onEscolher(valor)}
          className="size-5 shrink-0 accent-terracota"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-bold text-tinta">{titulo}</span>
          {detalhe && <span className="text-[13px] text-tinta-3">{detalhe}</span>}
        </span>
        {extra}
      </label>
      {escolhido && children}
    </div>
  );
}

/** V2 · Pagar taxa (link do SMS, pelo código). */
export function Pagamento({ codigo }: { codigo: string }) {
  const base = `/v1/public/pagamentos/${encodeURIComponent(codigo)}`;
  const { c, definir, recarregar, tentarOutraVez } = usePublico<PagamentoPublico>(base);
  const [escolha, setEscolha] = useState<Metodo | null>(null);
  const [telemovel, setTelemovel] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [expirouAgora, setExpirouAgora] = useState<string | null>(null);
  const idTel = useId();
  const grupo = useId();

  const porAceitar =
    c.estado === "ok" &&
    c.dados.mbway?.estado === "por_aceitar" &&
    expirouAgora !== c.dados.mbway.expira_em;

  // À espera do MB WAY: vê de 5 em 5 segundos se já foi pago.
  useEffect(() => {
    if (!porAceitar) return;
    const t = setInterval(() => void recarregar(), 5000);
    return () => clearInterval(t);
  }, [porAceitar, recarregar]);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const r = c.dados;
  const mb = r.mbway;
  const estadoMbway: EstadoPedido | null = mb
    ? porAceitar
      ? "por_aceitar"
      : mb.estado === "por_aceitar"
        ? "expirado"
        : mb.estado
    : null;
  const metodo: Metodo =
    escolha ??
    (r.modo_teste && (r.metodo === "mbway" || estadoMbway === "por_aceitar")
      ? "mbway"
      : r.mb_referencia || !r.modo_teste
        ? "multibanco"
        : "mbway");

  async function acao(caminho: string, corpo?: unknown) {
    setOcupado(true);
    setErro(null);
    try {
      definir(await api<PagamentoPublico>(`${base}${caminho}`, { metodo: "POST", corpo }));
      return true;
    } catch (e) {
      setErro(mensagemDe(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function escolher(m: Metodo) {
    setEscolha(m);
    setErro(null);
    // Trocar para Multibanco cancela o pedido MB WAY que está à espera.
    if (m === "multibanco" && porAceitar && r.modo_teste) {
      void acao("/metodo", { metodo: "multibanco" });
    }
  }

  const cabecalho = (
    <Topo direita={r.guia_numero ? `Guia ${r.guia_numero}` : r.municipio} />
  );

  if (r.estado === "pago") {
    return (
      <div className="flex w-full flex-col gap-6">
        {cabecalho}
        <CartaoDestaque tom="verde" className="gap-3.5 rounded-[28px_28px_28px_8px] px-[22px] py-7">
          <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-white">
            <CircleCheck className="size-7 text-verde" />
          </span>
          <h1 className="font-display text-[34px] leading-[1.05] font-bold tracking-[-1px]">
            Pagamento recebido.
          </h1>
          <p className="text-[16px] leading-[1.5] text-white/90">
            {euros(r.valor_cent)}
            {r.pago_em ? `, pagos a ${dataLonga(r.pago_em)}` : ""}. Não precisa de fazer
            mais nada: a câmara já sabe.
          </p>
        </CartaoDestaque>
        {r.modo_teste && (
          <Nota icone={FlaskConical} tom="ambar">
            <strong className="font-semibold">Modo de teste:</strong> este pagamento foi
            simulado. Não foi cobrado dinheiro.
          </Nota>
        )}
        <MaisDuvidas nota={null} />
      </div>
    );
  }

  if (r.estado !== "pendente") {
    return (
      <div className="flex w-full flex-col gap-6">
        {cabecalho}
        <Cabecalho
          titulo={r.estado === "expirado" ? "O prazo para pagar já passou." : "Este pagamento foi cancelado."}
          sub={
            r.estado === "expirado"
              ? "A referência já não serve. Ligue-nos ou escreva no chat e enviamos uma nova."
              : "Não tem de pagar nada por este link. Se tiver dúvidas, fale connosco."
          }
        />
        <MaisDuvidas titulo="Precisa de ajuda?" nota={null} />
      </div>
    );
  }

  const digitos = telemovel.replace(/\D/g, "");
  const telemovelValido = /^9\d{8}$/.test(digitos.replace(/^351/, ""));

  return (
    <div className="flex w-full flex-col gap-5">
      {cabecalho}
      <Cabecalho titulo="Falta só pagar a taxa." sub="Pode pagar já, pelo telemóvel ou numa caixa Multibanco." />

      {r.modo_teste && (
        <Nota icone={FlaskConical} tom="ambar">
          <strong className="font-semibold">Modo de teste:</strong> é uma demonstração.
          Nenhum dinheiro é cobrado.
        </Nota>
      )}

      <CartaoDestaque rotulo="Valor a pagar" className="gap-1">
        <p className="font-display text-[44px] leading-none font-extrabold tracking-[-1.5px]">
          {euros(r.valor_cent)}
        </p>
        <p className="pt-1 text-[14px] text-white/90">
          {[r.guia_numero && `Guia n.º ${r.guia_numero}`, r.pagar_ate && `pagar até ${dataLonga(r.pagar_ate)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {r.linhas.length > 0 && (
          <details className="pt-2 text-[14px]">
            <summary className="cursor-pointer font-semibold text-white">
              Ver o que está incluído
            </summary>
            <ul className="flex flex-col gap-1 pt-2 text-white/90">
              {r.linhas.map((l) => (
                <li key={l.codigo} className="flex justify-between gap-3">
                  <span>
                    {l.descricao}
                    {l.quantidade !== 1 ? ` × ${String(l.quantidade).replace(".", ",")}` : ""}
                  </span>
                  <span className="shrink-0 font-semibold">{euros(l.valor_cent)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CartaoDestaque>

      <fieldset className="flex w-full flex-col gap-2.5">
        <legend className="pb-2.5">
          <Rotulo>Como quer pagar</Rotulo>
        </legend>

        {r.modo_teste && (
          <Opcao
            nome={grupo}
            valor="mbway"
            escolhido={metodo === "mbway"}
            onEscolher={escolher}
            titulo="MB WAY"
            extra={<span className="text-[13px] font-semibold text-verde">o mais rápido</span>}
          >
            {estadoMbway === "por_aceitar" && mb ? (
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-[1.45] text-tinta">
                  Enviámos o pedido para o telemóvel <strong className="font-semibold">{mb.telemovel}</strong>.
                  Abra a app MB WAY e aceite.
                </p>
                <Contagem
                  key={mb.expira_em}
                  segundos={mb.segundos_restantes}
                  onFim={() => setExpirouAgora(mb.expira_em)}
                />
                <Botao
                  tamanho="grande"
                  icone={Smartphone}
                  className="w-full"
                  disabled={ocupado}
                  onClick={() => void acao("/mbway/aceitar")}
                >
                  Aceitar na app (simulação)
                </Botao>
                <p className="text-[13px] text-tinta-3">
                  Em modo de teste não há app: este botão faz de conta que aceitou.
                </p>
              </div>
            ) : mb && (estadoMbway === "expirado" || estadoMbway === "cancelado") && r.metodo === "mbway" ? (
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-[1.45] text-tinta">
                  {estadoMbway === "expirado"
                    ? `O pedido para ${mb.telemovel} passou dos ${mb.validade_minutos} minutos e já não serve.`
                    : `O pedido para ${mb.telemovel} foi cancelado.`}
                </p>
                {mb.pode_reenviar ? (
                  <>
                    <Botao
                      tamanho="grande"
                      icone={RotateCcw}
                      className="w-full"
                      disabled={ocupado}
                      onClick={() => {
                        setExpirouAgora(null);
                        void acao("/mbway/reenviar");
                      }}
                    >
                      Enviar outro pedido
                    </Botao>
                    <p className="text-[13px] text-tinta-3">
                      {mb.pedidos_restantes === 1
                        ? "Pode pedir só mais uma vez."
                        : `Pode pedir mais ${mb.pedidos_restantes} vezes.`}
                    </p>
                  </>
                ) : (
                  <p className="text-[15px] text-tinta-2">
                    Já não dá para pedir outra vez. Pague com a referência Multibanco.
                  </p>
                )}
              </div>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!telemovelValido) {
                    setErro("Escreva os 9 números do telemóvel, a começar por 9.");
                    return;
                  }
                  setExpirouAgora(null);
                  void acao("/metodo", { metodo: "mbway", telemovel: digitos.replace(/^351/, "") });
                }}
              >
                <label htmlFor={idTel} className="text-[14px] font-semibold text-tinta-2">
                  Telemóvel com MB WAY
                </label>
                <div className="flex h-12 items-center gap-2 rounded-xl border border-linha bg-creme px-3 focus-within:border-terracota">
                  <span className="text-[15px] font-semibold text-tinta-2" aria-hidden>
                    +351
                  </span>
                  <input
                    id={idTel}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="912 345 678"
                    value={telemovel}
                    onChange={(e) => setTelemovel(e.target.value)}
                    className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-semibold text-tinta outline-none placeholder:font-normal placeholder:text-tinta-3"
                  />
                </div>
                <Botao
                  type="submit"
                  tamanho="grande"
                  icone={Smartphone}
                  className="w-full"
                  disabled={ocupado}
                >
                  Pagar {euros(r.valor_cent)} com MB WAY
                </Botao>
              </form>
            )}
          </Opcao>
        )}

        <Opcao
          nome={grupo}
          valor="multibanco"
          escolhido={metodo === "multibanco"}
          onEscolher={escolher}
          titulo="Referência Multibanco"
          detalhe="Numa caixa Multibanco ou no homebanking"
        >
          {r.mb_entidade && r.mb_referencia ? (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col rounded-xl bg-creme px-3.5 py-1">
                {[
                  { k: "Entidade", v: r.mb_entidade },
                  { k: "Referência", v: r.mb_referencia },
                  { k: "Valor", v: euros(r.valor_cent) },
                ].map((x) => (
                  <div key={x.k} className="flex items-center justify-between gap-3 border-b border-linha py-2.5 last:border-b-0">
                    <div className="flex flex-col">
                      <dt className="text-[13px] text-tinta-3">{x.k}</dt>
                      <dd className="font-mono text-[19px] font-semibold text-tinta">{x.v}</dd>
                    </div>
                    {x.k !== "Valor" && <Copiar texto={x.v} rotulo={x.k} />}
                  </div>
                ))}
              </dl>
              {r.modo_teste && (
                <>
                  <Botao
                    tamanho="grande"
                    icone={Landmark}
                    className="w-full"
                    disabled={ocupado}
                    onClick={() => void acao("/simular-pagamento")}
                  >
                    Simular o pagamento
                  </Botao>
                  <p className="text-[13px] text-tinta-3">
                    Referência de teste: não funciona numa caixa a sério. Este botão faz de
                    conta que pagou.
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="text-[15px] text-tinta-2">
              Ainda não há referência Multibanco para este pagamento. Ligue-nos ou escreva
              no chat.
            </p>
          )}
        </Opcao>
      </fieldset>

      {erro && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {erro}
        </Nota>
      )}
      <MaisDuvidas titulo="Dúvidas sobre o pagamento?" nota={null} />
    </div>
  );
}
