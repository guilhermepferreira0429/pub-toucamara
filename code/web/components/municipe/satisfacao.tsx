"use client";

import { Check, Send } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Botao } from "@/components/ui/botao";
import { api } from "@/lib/api";
import { TituloSecao } from "./moldura";
import { mensagemDe } from "./use-publico";

interface Estado {
  respondida: boolean;
  nota: number | null;
}

const NOTAS: { nota: number; rotulo: string }[] = [
  { nota: 1, rotulo: "Nada" },
  { nota: 2, rotulo: "Pouco" },
  { nota: 3, rotulo: "Em parte" },
  { nota: 4, rotulo: "Quase tudo" },
  { nota: 5, rotulo: "Totalmente" },
];

const MAX_COMENTARIO = 1000;

/**
 * "Ficou resolvido?" no fim da página do resumo (peça 7): sem SMS a mais, o
 * código do link chega. Uma resposta por conversa; se já respondeu, só
 * agradece. Se o pedido falhar a ler o estado, a pergunta não aparece.
 */
export function Satisfacao({ codigo }: { codigo: string }) {
  const caminho = `/v1/public/resumos/${encodeURIComponent(codigo)}/satisfacao`;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idComentario = useId();
  const idAjuda = useId();

  useEffect(() => {
    let ativo = true;
    api<Estado>(caminho)
      .then((e) => {
        if (ativo) setEstado(e);
      })
      .catch(() => {
        // Sem estado não se pergunta: a página do resumo continua a servir.
      });
    return () => {
      ativo = false;
    };
  }, [caminho]);

  if (!estado) return null;

  if (estado.respondida) {
    return (
      <section
        aria-live="polite"
        className="flex w-full items-center gap-3 rounded-[20px] border border-linha bg-papel p-5"
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-verde-suave"
        >
          <Check className="size-5 text-verde" />
        </span>
        <p className="text-[16px] leading-[1.4] text-tinta">
          <span className="font-semibold">Obrigado pela sua resposta.</span> Ajuda a câmara a
          atender melhor.
        </p>
      </section>
    );
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (nota === null || aEnviar) return;
    setAEnviar(true);
    setErro(null);
    try {
      const r = await api<Estado>(caminho, {
        corpo: { nota, comentario: comentario.trim() || null },
      });
      setEstado(r);
    } catch (x) {
      setErro(mensagemDe(x));
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="flex w-full flex-col gap-4 rounded-[20px] border border-linha bg-papel p-5"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="pb-3">
          <TituloSecao>Ficou resolvido?</TituloSecao>
          <span className="block pt-1 text-[15px] leading-[1.45] text-tinta-2">
            De 1 (nada) a 5 (totalmente).
          </span>
        </legend>
        <div className="grid grid-cols-5 gap-2">
          {NOTAS.map((n) => {
            const escolhida = nota === n.nota;
            return (
              <label
                key={n.nota}
                className={`flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border-[1.5px] px-1 py-2 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-terracota ${
                  escolhida
                    ? "border-tinta bg-tinta text-white"
                    : "border-linha bg-white text-tinta hover:border-tinta"
                }`}
              >
                <input
                  type="radio"
                  name="nota"
                  value={n.nota}
                  checked={escolhida}
                  onChange={() => setNota(n.nota)}
                  className="sr-only"
                />
                <span className="font-display text-[26px] leading-none font-bold">{n.nota}</span>
                <span
                  className={`text-[11px] leading-tight ${escolhida ? "text-white/85" : "text-tinta-2"}`}
                >
                  {n.rotulo}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {nota !== null && (
        <div className="flex flex-col gap-2">
          <label htmlFor={idComentario} className="text-[16px] font-semibold text-tinta">
            O que podia ter corrido melhor?{" "}
            <span className="font-normal text-tinta-2">(opcional)</span>
          </label>
          <textarea
            id={idComentario}
            aria-describedby={idAjuda}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            maxLength={MAX_COMENTARIO}
            rows={3}
            className="w-full resize-y rounded-2xl border-[1.5px] border-linha bg-white p-3.5 text-[16px] leading-[1.45] text-tinta focus:border-tinta focus:outline-none"
          />
          <p id={idAjuda} className="text-[13px] text-tinta-2">
            Não escreva dados pessoais (NIF, morada). Só a câmara lê.
          </p>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-[14px] font-medium text-terracota-escuro">
          {erro}
        </p>
      )}

      <Botao
        type="submit"
        tamanho="grande"
        icone={Send}
        disabled={nota === null || aEnviar}
        className="w-full"
      >
        {aEnviar ? "A enviar…" : "Enviar resposta"}
      </Botao>
    </form>
  );
}
