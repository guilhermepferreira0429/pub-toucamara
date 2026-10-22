"use client";

import { Clock, FlaskConical, MessageCircle, Syringe } from "lucide-react";
import { useState } from "react";
import { RetratoAnimal } from "@/components/servicos/retrato-animal";
import { BotaoLink } from "@/components/ui/botao";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  Nota,
  ROTA_CHAT,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * /adotar: os animais do canil/gatil municipal para adoção (sem login).
 * Sem fotografias externas: cada animal tem um retrato desenhado (cor do
 * pelo e ícone da espécie). Para marcar a visita: o chat ou a linha.
 */

interface Animal {
  id: string;
  nome: string;
  especie: "cao" | "gato";
  sexo: "macho" | "femea" | null;
  porte: "pequeno" | "medio" | "grande" | null;
  idade: string | null;
  descricao: string;
  cor: string | null;
  esterilizado: boolean;
  vacinado: boolean;
  com_chip: boolean;
  estado: "disponivel" | "reservado";
}

interface Adocao {
  municipio: { slug: string; nome: string };
  canil: { nome: string; horario_dito: string; demonstracao: boolean };
  animais: Animal[];
  demonstracao: boolean;
}

const PORTES = { pequeno: "pequeno", medio: "médio", grande: "grande" } as const;

function especieDita(a: Animal): string {
  if (a.especie === "gato") return a.sexo === "femea" ? "Gata" : "Gato";
  return a.sexo === "femea" ? "Cadela" : "Cão";
}

export function PaginaAdotar({ slug }: { slug: string }) {
  const { c, tentarOutraVez } = usePublico<Adocao>(`/v1/public/animais/${encodeURIComponent(slug)}/adocao`);
  const [especie, setEspecie] = useState<"todos" | "cao" | "gato">("todos");

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro") return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const d = c.dados;
  const lista = d.animais.filter((a) => especie === "todos" || a.especie === especie);
  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={d.municipio.nome} />
      <Cabecalho
        meta="Canil e gatil municipal"
        titulo="Adote um amigo"
        sub="Escolha um e marque uma visita: a equipa do canil apresenta-vos e explica como é a adoção."
        grande
      />
      {d.demonstracao && (
        <Nota icone={FlaskConical} papel="status">
          Estes animais são de demonstração: a lista real vem do canil municipal.
        </Nota>
      )}
      <div className="flex gap-2" role="group" aria-label="Espécie">
        {(
          [
            ["todos", "Todos"],
            ["cao", "Cães"],
            ["gato", "Gatos"],
          ] as const
        ).map(([v, t]) => (
          <button
            key={v}
            type="button"
            aria-pressed={especie === v}
            onClick={() => setEspecie(v)}
            className={`rounded-full border px-4 py-2 text-[15px] font-semibold ${
              especie === v ? "border-tinta bg-tinta text-white" : "border-linha bg-papel text-tinta-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {lista.length === 0 && <p className="text-[16px] text-tinta-2">Neste momento não há animais desta espécie para adoção.</p>}
      <ul className="flex flex-col gap-4">
        {lista.map((a) => (
          <li key={a.id} className="flex gap-4 rounded-2xl border border-linha bg-papel p-4">
            <RetratoAnimal especie={a.especie} cor={a.cor} tamanho={88} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-[22px] font-bold text-tinta">{a.nome}</h2>
                {a.estado === "reservado" && (
                  <span className="rounded-full bg-ambar-suave px-2.5 py-0.5 text-[12px] font-semibold text-ambar">reservado</span>
                )}
              </div>
              <p className="text-[14px] text-tinta-3">
                {especieDita(a)}
                {a.porte ? ` de porte ${PORTES[a.porte]}` : ""}
                {a.idade ? ` · ${a.idade}` : ""}
              </p>
              <p className="mt-1.5 text-[16px] leading-[1.45] text-tinta-2">{a.descricao}</p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-tinta-3">
                {a.vacinado && (
                  <span className="inline-flex items-center gap-1">
                    <Syringe className="size-3.5" aria-hidden /> vacinado
                  </span>
                )}
                {a.esterilizado && <span>esterilizado</span>}
                {a.com_chip && <span>com chip</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-2xl bg-creme-2 p-5">
        <p className="flex items-start gap-2 text-[15px] text-tinta-2">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="text-tinta">{d.canil.nome}</strong>: {d.canil.horario_dito}.
          </span>
        </p>
        <BotaoLink href={ROTA_CHAT} tamanho="grande" icone={MessageCircle} className="w-full">
          Marcar uma visita
        </BotaoLink>
        <p className="text-[13px] text-tinta-3">
          Também pode ligar para a linha da câmara e pedir ao assistente: «quero adotar um cão».
        </p>
      </div>
    </div>
  );
}
