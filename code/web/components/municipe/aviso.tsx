"use client";

import type { LucideIcon } from "lucide-react";
import {
  BellOff,
  Car,
  Construction,
  Droplets,
  Info,
  Megaphone,
  MapPin,
  Siren,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { dataLonga, hora } from "./formatar";
import {
  ACarregar,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Topo,
  TituloSecao,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";

type TipoAviso = "obras" | "agua" | "residuos" | "transito" | "emergencia" | "outro";

interface AvisoPublico {
  municipio: string;
  titulo: string;
  mensagem: string;
  tipo: TipoAviso;
  emergencia: boolean;
  zona: string;
  enviado_em: string | null;
  cancelado: boolean;
  recebe_avisos: boolean;
  sair: { metodo: "POST"; caminho: string; nota: string };
}

const TIPOS: Record<TipoAviso, { nome: string; icone: LucideIcon }> = {
  obras: { nome: "Obras", icone: Construction },
  agua: { nome: "Água", icone: Droplets },
  residuos: { nome: "Lixo e recolhas", icone: Trash2 },
  transito: { nome: "Trânsito", icone: Car },
  emergencia: { nome: "Emergência", icone: Siren },
  outro: { nome: "Aviso", icone: Megaphone },
};

/** Aviso por zona (link do SMS, pelo código): o aviso e "deixar de receber". */
export function Aviso({ codigo }: { codigo: string }) {
  const { c, definir, tentarOutraVez } = usePublico<AvisoPublico>(
    `/v1/public/avisos/${encodeURIComponent(codigo)}`,
  );
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saiu, setSaiu] = useState<string | null>(null);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const a = c.dados;
  const tipo = TIPOS[a.tipo] ?? TIPOS.outro;
  const Icone = tipo.icone;

  async function sair() {
    setOcupado(true);
    setErro(null);
    try {
      // O caminho vem da API (`sair.caminho`, já com /v1).
      const r = await api<{ recebe_avisos: boolean; mensagem: string }>(a.sair.caminho, {
        metodo: "POST",
      });
      definir({ ...a, recebe_avisos: r.recebe_avisos });
      setSaiu(r.mensagem);
      setConfirmar(false);
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={a.municipio} />

      <div className="flex w-full flex-col gap-3">
        <span
          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold ${a.emergencia ? "bg-terracota text-white" : "bg-terracota-suave text-terracota-escuro"}`}
        >
          <Icone className="size-4" aria-hidden />
          {a.emergencia ? "Aviso de emergência" : `Aviso da câmara · ${tipo.nome}`}
        </span>
        <h1 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.8px] text-tinta">
          {a.titulo}
        </h1>
        {a.enviado_em && (
          <p className="text-[14px] text-tinta-3">
            Enviado a {dataLonga(a.enviado_em)}, às {hora(a.enviado_em)}
          </p>
        )}
      </div>

      {a.cancelado && (
        <Nota icone={Info} tom="ambar" papel="status">
          <strong className="font-semibold">Este aviso foi cancelado.</strong> Já não se
          aplica.
        </Nota>
      )}

      <section
        className={`flex w-full flex-col gap-3 rounded-[24px_24px_24px_6px] p-5 ${a.emergencia ? "bg-terracota text-white" : "border border-linha bg-papel text-tinta"} ${a.cancelado ? "opacity-70" : ""}`}
      >
        <p className="text-[18px] leading-[1.5] whitespace-pre-line">{a.mensagem}</p>
        <p
          className={`flex items-start gap-2 border-t pt-3 text-[15px] leading-[1.4] ${a.emergencia ? "border-white/30 text-white/90" : "border-linha text-tinta-2"}`}
        >
          <MapPin className="mt-0.5 size-[18px] shrink-0" aria-hidden />
          <span>
            <span className="sr-only">Zona: </span>
            {a.zona}
          </span>
        </p>
      </section>

      <MaisDuvidas
        titulo="Tem perguntas sobre este aviso?"
        nota={null}
      />

      <section className="flex w-full flex-col gap-3 border-t border-linha pt-6" aria-labelledby="receber">
        <TituloSecao id="receber">Avisos por SMS</TituloSecao>
        <div aria-live="polite">
          {saiu && (
            <Nota icone={BellOff} tom="verde">
              {saiu}
            </Nota>
          )}
        </div>
        {a.recebe_avisos ? (
          confirmar ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] leading-[1.45] text-tinta">{a.sair.nota}</p>
              {erro && (
                <Nota icone={Info} tom="terracota" papel="alert">
                  {erro}
                </Nota>
              )}
              <Botao
                tamanho="grande"
                icone={BellOff}
                className="w-full"
                disabled={ocupado}
                onClick={() => void sair()}
              >
                {ocupado ? "A gravar…" : "Sim, deixar de receber"}
              </Botao>
              <Botao
                tamanho="grande"
                variante="secundario"
                className="w-full"
                onClick={() => setConfirmar(false)}
              >
                Continuar a receber
              </Botao>
            </div>
          ) : (
            <>
              <p className="text-[15px] leading-[1.45] text-tinta-2">
                Avisamos por SMS quando há obras, cortes de água, mudanças no lixo ou no
                trânsito perto de si.
              </p>
              <Botao
                variante="secundario"
                icone={BellOff}
                className="h-12 w-full text-[16px]"
                onClick={() => setConfirmar(true)}
              >
                Deixar de receber avisos
              </Botao>
            </>
          )
        ) : (
          !saiu && (
            <p className="text-[15px] leading-[1.45] text-tinta-2">
              Já não recebe avisos de obras, água, lixo e trânsito. Os avisos de emergência
              continuam a chegar, por segurança.
            </p>
          )
        )}
      </section>
    </div>
  );
}
