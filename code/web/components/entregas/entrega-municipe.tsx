"use client";

import {
  Check,
  CircleAlert,
  Clock,
  FileText,
  Info,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { api, API_URL } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { dataLonga, hora } from "@/components/municipe/formatar";
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
} from "@/components/municipe/moldura";
import { mensagemDe, usePublico } from "@/components/municipe/use-publico";
import { AvisoSimulacao } from "./aviso-simulacao";
import type { EntregaPublica, ResumoPedido } from "./tipos";

/** Erros do regresso da autenticação (?erro=codigo). */
const ERROS_RETORNO: Record<string, string> = {
  pedido_autenticacao_invalido:
    "A autenticação demorou demasiado ou não era deste pedido. Carregue outra vez em autorizar.",
  outra_pessoa:
    "Quem se autenticou não é o requerente deste pedido. Só o próprio pode autorizar a entrega.",
  sem_nif: "A autenticação não devolveu o NIF. Tente outra vez.",
  autenticacao_por_configurar:
    "A autenticação com Chave Móvel Digital ainda não está disponível nesta câmara.",
  autenticacao_por_ligar:
    "A autenticação com Chave Móvel Digital ainda não está disponível nesta câmara.",
  pedido_alterado:
    "O pedido mudou depois de o confirmar, por isso não o entregámos. Fale outra vez com o agente.",
};

export function ResumoDoPedido({ resumo }: { resumo: ResumoPedido }) {
  return (
    <section
      aria-labelledby="resumo-pedido"
      className="flex w-full flex-col gap-2 rounded-xl border border-linha bg-white p-4"
    >
      <h2
        id="resumo-pedido"
        className="font-serif text-[13px] font-bold tracking-[1px] text-tinta uppercase"
      >
        {resumo.tipo.nome}
      </h2>
      <dl className="flex flex-col">
        {resumo.requerente && (
          <div className="flex flex-col gap-0.5 border-t border-linha py-2 first:border-t-0">
            <dt className="text-[12px] text-tinta-3">Requerente</dt>
            <dd className="font-serif text-[15px] text-tinta">{resumo.requerente}</dd>
          </div>
        )}
        {resumo.campos.map((c) => (
          <div
            key={c.rotulo}
            className="flex flex-col gap-0.5 border-t border-linha py-2 first:border-t-0"
          >
            <dt className="text-[12px] text-tinta-3">{c.rotulo}</dt>
            <dd className="font-serif text-[15px] leading-[1.4] text-tinta">{c.valor}</dd>
          </div>
        ))}
      </dl>
      {resumo.documentos.em_falta.length > 0 && (
        <p className="flex items-start gap-2 border-t border-linha pt-2 text-[14px] text-ambar">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Ainda falta entregar:</span>{" "}
            {resumo.documentos.em_falta.join(", ")}. Pode entregar depois, pelo link do
            processo.
          </span>
        </p>
      )}
    </section>
  );
}

function Comprovativo({ e }: { e: EntregaPublica }) {
  const c = e.comprovativo!;
  return (
    <div className="flex w-full flex-col gap-4">
      <CartaoDestaque rotulo="Número de entrada" tom="verde">
        <p className="font-mono text-[26px] font-bold tracking-[0.5px]">
          {c.numero_entrada}
        </p>
        <p className="text-[15px] text-white/90">
          Entregue a {dataLonga(c.recebido_em)}, às {hora(c.recebido_em)}.
          {e.processo ? ` Processo ${e.processo.numero}.` : ""}
        </p>
      </CartaoDestaque>
      {c.simulado && (
        <AvisoSimulacao detalhe="Este comprovativo é de demonstração. A entrega real só será possível depois da autenticação com a Chave Móvel Digital (credenciação na AMA)." />
      )}
      <section
        aria-labelledby="docs-entregues"
        className="flex w-full flex-col gap-2 rounded-2xl border border-linha bg-papel px-4 py-3.5"
      >
        <Rotulo id="docs-entregues">O que foi entregue</Rotulo>
        <ul className="flex flex-col gap-1.5">
          {c.documentos.map((d) => (
            <li key={d} className="flex items-center gap-2 text-[15px] text-tinta">
              <Check className="size-4 shrink-0 text-verde" aria-hidden />
              {d}
            </li>
          ))}
        </ul>
      </section>
      <a
        href={`${API_URL}${c.pdf}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
      >
        <FileText className="size-5" aria-hidden />
        Abrir o comprovativo (PDF)
      </a>
    </div>
  );
}

/** A página do link do SMS: rever o pedido e autorizar a entrega em nome da pessoa. */
export function EntregaMunicipe({ token }: { token: string }) {
  const caminho = `/v1/public/entregas/${encodeURIComponent(token)}`;
  const { c, tentarOutraVez } = usePublico<EntregaPublica>(caminho);
  const erroRetorno = useSearchParams().get("erro");
  const [consentimento, setConsentimento] = useState(false);
  const [aCorrer, setACorrer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idConsentimento = useId();
  const idErro = useId();

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const e = c.dados;

  async function autorizar() {
    if (!consentimento) {
      setErro("Marque a caixa a autorizar a entrega em seu nome.");
      return;
    }
    setACorrer(true);
    setErro(null);
    try {
      const r = await api<{ url: string }>(`${caminho}/autenticar`, {
        corpo: { consentimento: true },
      });
      window.location.assign(r.url);
    } catch (x) {
      setErro(mensagemDe(x));
      setACorrer(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={e.municipio} />

      {e.estado === "entregue" ? (
        <Cabecalho
          meta={e.resumo.tipo.nome}
          titulo="O seu pedido foi entregue."
          sub="Guarde o número de entrada. Avisamos por SMS quando houver novidades."
        />
      ) : e.estado === "expirado" ? (
        <Cabecalho
          meta={e.resumo.tipo.nome}
          titulo="Este link já expirou."
          sub="Por segurança, o link para autorizar só vale algum tempo. O seu pedido continua guardado: peça ao agente para o entregar outra vez."
        />
      ) : e.estado === "cancelado" ? (
        <Cabecalho
          meta={e.resumo.tipo.nome}
          titulo="Esta entrega foi cancelada."
          sub="Nada foi entregue. Se quiser, fale outra vez com o agente."
        />
      ) : e.estado === "falhou" || e.estado === "autorizado" ? (
        <Cabecalho
          meta={e.resumo.tipo.nome}
          titulo="Autorizou a entrega."
          sub={e.erro ?? "Estamos a entregar o seu pedido."}
        />
      ) : (
        <Cabecalho
          meta={e.resumo.tipo.nome}
          titulo="Entregamos o pedido por si?"
          sub="Confira o pedido. Se estiver tudo certo, autorize a entrega com a Chave Móvel Digital."
        />
      )}

      {erroRetorno && e.estado === "a_espera_autorizacao" && (
        <Nota icone={Info} tom="terracota" papel="alert">
          {ERROS_RETORNO[erroRetorno] ?? "A autenticação não correu bem. Tente outra vez."}
        </Nota>
      )}

      {e.comprovativo ? (
        <Comprovativo e={e} />
      ) : (
        <>
          {e.simulado && e.estado === "a_espera_autorizacao" && <AvisoSimulacao />}
          <ResumoDoPedido resumo={e.resumo} />
        </>
      )}

      {e.estado === "a_espera_autorizacao" && (
        <div className="flex w-full flex-col gap-4">
          <p className="flex items-center gap-2 text-[14px] text-tinta-2">
            <Clock className="size-4 shrink-0" aria-hidden />
            Este link vale até {dataLonga(e.expira_em)}, às {hora(e.expira_em)}.
          </p>
          <div className="flex items-start gap-3 rounded-2xl border border-linha bg-papel p-4">
            <input
              id={idConsentimento}
              type="checkbox"
              checked={consentimento}
              onChange={(x) => {
                setConsentimento(x.target.checked);
                if (x.target.checked) setErro(null);
              }}
              aria-describedby={erro ? idErro : undefined}
              className="mt-0.5 size-6 shrink-0 accent-terracota focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
            />
            <label htmlFor={idConsentimento} className="text-[16px] leading-[1.45] text-tinta">
              Autorizo a câmara a entregar este pedido em meu nome no balcão online.
            </label>
          </div>
          {erro && (
            <p id={idErro} role="alert" className="flex items-start gap-2 text-[15px] text-terracota-escuro">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {erro}
            </p>
          )}
          <Botao
            tamanho="grande"
            icone={KeyRound}
            className="w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
            disabled={aCorrer || !e.pode_autorizar}
            onClick={autorizar}
          >
            {aCorrer
              ? "A abrir…"
              : e.autenticacao.simulada
                ? "Autorizar com Chave Móvel Digital (simulada)"
                : "Autorizar com Chave Móvel Digital"}
          </Botao>
          {!e.pode_autorizar && (
            <Nota icone={Info} tom="terracota" papel="status">
              Houve demasiadas tentativas falhadas. Peça ao agente um link novo.
            </Nota>
          )}
        </div>
      )}

      {e.autorizacao && (
        <Nota icone={ShieldCheck} tom={e.autorizacao.simulada ? "ambar" : "verde"} papel="status">
          Autorizado a {dataLonga(e.autorizacao.em)}, às {hora(e.autorizacao.em)}
          {e.autorizacao.nome ? `, por ${e.autorizacao.nome}` : ""}
          {e.autorizacao.nif_mascarado ? ` (NIF ${e.autorizacao.nif_mascarado})` : ""}.
          {e.autorizacao.simulada && " Autenticação simulada: sem validade legal."}
        </Nota>
      )}

      <MaisDuvidas
        titulo={e.estado === "entregue" ? "Alguma dúvida?" : "Alguma coisa não está certa?"}
        nota="Pode corrigir o pedido pelo telefone ou no chat antes de autorizar."
      />
    </div>
  );
}
