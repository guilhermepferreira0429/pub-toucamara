"use client";

import {
  Bot,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useState } from "react";
import { MUNICIPIO, MUNICIPIO_NOME } from "@/components/chamada/config";
import {
  Cabecalho,
  CartaoDestaque,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "@/components/municipe/moldura";
import { Botao } from "@/components/ui/botao";
import { api, ErroApi } from "@/lib/api";
import { copiar, urlApi } from "./url";

/*
 * Ligar a minha IA: a pessoa autoriza o seu assistente (Claude, ChatGPT...)
 * a tratar de coisas com a câmara em nome dela. Número de telemóvel →
 * código por SMS → endereço pessoal para colar no assistente. Sem isto, o
 * assistente só tem a informação pública.
 */

const ASSISTENTES = ["Claude", "ChatGPT", "Gemini", "Copilot", "Outro"] as const;
type Assistente = (typeof ASSISTENTES)[number];

const O_QUE_FAZ = [
  "Responder com a informação oficial da câmara, com a fonte",
  "Registar um buraco, um candeeiro apagado ou lixo na rua",
  "Marcar atendimento no balcão certo",
  "Dizer em que ponto está o seu processo",
  "Preencher um requerimento e mandar-lho por SMS",
];

const COMO_LIGAR: Record<Assistente, { passos: string[]; comando?: (url: string) => string }> = {
  Claude: {
    passos: [
      "No Claude, abra Definições e depois Conectores.",
      "Escolha Adicionar conector personalizado.",
      "Dê-lhe o nome da câmara e cole o endereço acima.",
    ],
    comando: (url) => `claude mcp add --transport http ${MUNICIPIO} ${url}`,
  },
  ChatGPT: {
    passos: [
      "No ChatGPT, abra Definições e depois Apps e conectores.",
      "Ligue o modo de programador e escolha Criar.",
      "Cole o endereço acima, sem autenticação.",
    ],
  },
  Gemini: {
    passos: [
      "Use um cliente que aceite servidores MCP (por exemplo, a CLI do Gemini).",
      "Acrescente um servidor MCP por HTTP com o endereço acima.",
    ],
  },
  Copilot: {
    passos: [
      "No Copilot Studio ou no VS Code, acrescente um servidor MCP por HTTP.",
      "Cole o endereço acima.",
    ],
  },
  Outro: {
    passos: [
      "No seu assistente, procure onde se acrescentam conectores ou servidores MCP.",
      "Escolha o tipo HTTP (Streamable HTTP) e cole o endereço acima.",
    ],
  },
};

interface Pedido {
  pedido: string;
  telefone: string;
  expira_em: string;
}

interface Ligacao {
  ligacao_id: string;
  assistente: string;
  chave: string;
  caminho_mcp: string;
}

type Passo =
  | { passo: "inicio" }
  | { passo: "codigo"; pedido: Pedido }
  | { passo: "ligado"; ligacao: Ligacao }
  | { passo: "desligado" };

function mensagem(e: unknown): string {
  return e instanceof ErroApi ? e.message : "Ocorreu um erro. Tente outra vez.";
}

export function LigarIa() {
  const [estado, setEstado] = useState<Passo>({ passo: "inicio" });
  const [assistente, setAssistente] = useState<Assistente>("Claude");
  const [telefone, setTelefone] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aCorrer, setACorrer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function correr(f: () => Promise<void>) {
    setACorrer(true);
    setErro(null);
    try {
      await f();
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setACorrer(false);
    }
  }

  const pedirCodigo = () =>
    correr(async () => {
      const pedido = await api<Pedido>("/v1/public/ias/pedir-codigo", {
        corpo: { municipio: MUNICIPIO, telefone, assistente },
      });
      setCodigo("");
      setEstado({ passo: "codigo", pedido });
    });

  const confirmar = (pedido: Pedido) =>
    correr(async () => {
      const ligacao = await api<Ligacao>("/v1/public/ias/confirmar", {
        corpo: { pedido: pedido.pedido, codigo },
      });
      setEstado({ passo: "ligado", ligacao });
    });

  const desligar = (chave: string) =>
    correr(async () => {
      await api("/v1/public/ias/desligar", { corpo: { chave } });
      setEstado({ passo: "desligado" });
    });

  return (
    <div className="flex w-full flex-col gap-7">
      <Topo direita="Ligar a minha IA" />

      {estado.passo === "ligado" ? (
        <Ligado
          ligacao={estado.ligacao}
          aCorrer={aCorrer}
          onDesligar={() => desligar(estado.ligacao.chave)}
        />
      ) : estado.passo === "desligado" ? (
        <>
          <Cabecalho
            meta="Desligado"
            titulo="O seu assistente já não fala em seu nome."
            sub="A chave deixou de funcionar. Pode voltar a ligar quando quiser."
          />
          <Botao
            tamanho="grande"
            className="w-full"
            onClick={() => setEstado({ passo: "inicio" })}
          >
            Ligar outra vez
          </Botao>
        </>
      ) : (
        <>
          <Cabecalho
            meta={`Câmara de ${MUNICIPIO_NOME}`}
            titulo="Peça ao seu assistente. Ele trata com a câmara."
            sub="Se usa o Claude, o ChatGPT ou outro assistente, pode ligá-lo à câmara. Ele passa a usar a informação oficial e pode tratar de coisas por si, com a sua autorização."
            grande
          />

          <CartaoDestaque rotulo="Exemplo" tom="tinta">
            <p className="text-[17px] leading-[1.4] font-semibold">
              «O caixote da minha rua não foi recolhido, trata disso.»
            </p>
            <p className="text-[14px] leading-[1.45] text-white/80">
              O assistente regista a ocorrência na câmara e recebe o número.
              O SMS com o link para a fotografia chega ao seu telemóvel.
            </p>
          </CartaoDestaque>

          <section className="flex flex-col gap-3" aria-labelledby="pode">
            <TituloSecao id="pode">O que o assistente pode fazer</TituloSecao>
            <ul className="flex flex-col gap-2">
              {O_QUE_FAZ.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[15px] text-tinta">
                  <Check className="mt-0.5 size-4.5 shrink-0 text-verde" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </section>

          {estado.passo === "inicio" ? (
            <section
              className="flex flex-col gap-4 rounded-2xl border border-linha bg-papel p-5"
              aria-labelledby="autorizar"
            >
              <TituloSecao id="autorizar">Autorizar o seu assistente</TituloSecao>
              <div className="flex flex-col gap-2">
                <Rotulo>Qual usa?</Rotulo>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Assistente">
                  {ASSISTENTES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={assistente === a}
                      onClick={() => setAssistente(a)}
                      className={`rounded-full border-[1.5px] px-3.5 py-2 text-[14px] font-semibold ${
                        assistente === a
                          ? "border-terracota bg-terracota-suave text-terracota-escuro"
                          : "border-linha text-tinta-2"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-2">
                <Rotulo>O seu telemóvel</Rotulo>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="912 345 678"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className="h-14 rounded-xl border-[1.5px] border-linha bg-creme px-4 text-[18px] text-tinta outline-none focus:border-terracota"
                />
                <span className="text-[13px] text-tinta-3">
                  É o número que fica ligado ao assistente: os SMS da câmara vão para aqui.
                </span>
              </label>
              {erro && <Nota icone={ShieldCheck} tom="terracota" papel="alert">{erro}</Nota>}
              <Botao
                tamanho="grande"
                className="w-full"
                icone={aCorrer ? LoaderCircle : MessageSquareText}
                disabled={aCorrer || telefone.trim().length < 9}
                onClick={pedirCodigo}
              >
                Enviar código por SMS
              </Botao>
            </section>
          ) : (
            <section
              className="flex flex-col gap-4 rounded-2xl border border-linha bg-papel p-5"
              aria-labelledby="codigo"
            >
              <TituloSecao id="codigo">Escreva o código</TituloSecao>
              <p className="text-[15px] text-tinta-2">
                Mandámos um código de 6 algarismos para {estado.pedido.telefone}. Vale 10 minutos.
              </p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                aria-label="Código"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                className="h-16 rounded-xl border-[1.5px] border-linha bg-creme text-center font-mono text-[28px] tracking-[10px] text-tinta outline-none focus:border-terracota"
              />
              {erro && <Nota icone={ShieldCheck} tom="terracota" papel="alert">{erro}</Nota>}
              <Botao
                tamanho="grande"
                className="w-full"
                icone={aCorrer ? LoaderCircle : KeyRound}
                disabled={aCorrer || codigo.length !== 6}
                onClick={() => confirmar(estado.pedido)}
              >
                Ligar o {assistente}
              </Botao>
              <Botao
                variante="discreto"
                onClick={() => setEstado({ passo: "inicio" })}
              >
                Mudar o número
              </Botao>
            </section>
          )}

          <Publico />
        </>
      )}
    </div>
  );
}

function Ligado({
  ligacao,
  aCorrer,
  onDesligar,
}: {
  ligacao: Ligacao;
  aCorrer: boolean;
  onDesligar: () => void;
}) {
  const url = urlApi(ligacao.caminho_mcp);
  const como = COMO_LIGAR[(ligacao.assistente as Assistente)] ?? COMO_LIGAR.Outro;
  return (
    <>
      <Cabecalho
        meta="Autorizado"
        titulo={`Falta só colar isto no ${ligacao.assistente}.`}
        sub="Este endereço é só seu. Quem o tiver pode tratar de coisas com a câmara em seu nome, por isso não o partilhe."
      />
      <CopiarCaixa rotulo="O seu endereço pessoal" texto={url} />
      <section className="flex flex-col gap-3" aria-labelledby="como">
        <TituloSecao id="como">Como ligar</TituloSecao>
        <ol className="flex flex-col gap-2.5">
          {como.passos.map((p, i) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-tinta">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-terracota text-[13px] font-bold text-white">
                {i + 1}
              </span>
              {p}
            </li>
          ))}
        </ol>
        {como.comando && (
          <CopiarCaixa rotulo="No Claude Code" texto={como.comando(url)} />
        )}
      </section>
      <Nota icone={ShieldCheck} tom="neutro">
        Antes de registar, marcar ou pagar, o assistente confirma consigo. Cada
        pedido fica registado na câmara. Recebeu um SMS a confirmar a ligação.
      </Nota>
      <Botao
        variante="secundario"
        tamanho="grande"
        className="w-full"
        icone={Unplug}
        disabled={aCorrer}
        onClick={onDesligar}
      >
        Desligar este assistente
      </Botao>
    </>
  );
}

/** Sem autorização: o endereço público, só com informação. */
function Publico() {
  const url = urlApi(`/v1/mcp/${MUNICIPIO}`);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="publico">
      <TituloSecao id="publico">Só quer informação?</TituloSecao>
      <p className="text-[15px] text-tinta-2">
        Sem autorização, o assistente pode consultar a informação oficial, saber
        que entidade trata de quê e simular taxas. Não age em seu nome.
      </p>
      <CopiarCaixa rotulo="Endereço público" texto={url} icone={Bot} />
    </section>
  );
}

function CopiarCaixa({
  rotulo,
  texto,
  icone: Icone = KeyRound,
}: {
  rotulo: string;
  texto: string;
  icone?: typeof KeyRound;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Rotulo>{rotulo}</Rotulo>
      <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-linha bg-papel p-2 pl-3">
        <Icone className="size-4 shrink-0 text-tinta-3" aria-hidden />
        <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-tinta">
          {texto}
        </code>
        <button
          type="button"
          onClick={async () => {
            if (await copiar(texto)) {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            }
          }}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-tinta px-3.5 text-[13px] font-semibold text-white"
        >
          {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
