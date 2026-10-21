"use client";

import { BadgeCheck, CalendarDays, Clock, Download, MapPin, ShieldAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { QrSvg } from "@/components/ui/qr-svg";
import { API_URL } from "@/lib/api";
import {
  ACarregar,
  Cabecalho,
  CartaoDestaque,
  ErroCarregar,
  LinkInvalido,
  ModoTeste,
  Nota,
  Rotulo,
  TituloSecao,
  Topo,
} from "./moldura";
import { usePublico } from "./use-publico";

/*
 * A licença com QR (o link do SMS e o que o QR abre): qualquer pessoa, um
 * vizinho ou a polícia municipal, confirma aqui se a licença é válida.
 */

interface LicencaPublica {
  numero: string;
  municipio: string;
  estado: "a_pagar" | "por_aprovar" | "para_tecnico" | "emitida" | "recusada";
  valida: boolean;
  expirada: boolean;
  titular: string | null;
  atividade: string;
  descricao: string;
  morada: string;
  dia: string;
  horario: string;
  condicoes: string[];
  emitida_em: string | null;
  fonte: string;
  modo_teste: boolean;
  regras_de_demonstracao: boolean;
  pdf: boolean;
}

const semSubscricao = () => () => {};

export function PaginaLicenca({ codigo }: { codigo: string }) {
  const { c, tentarOutraVez } = usePublico<LicencaPublica>(
    `/v1/public/licencas/${encodeURIComponent(codigo)}`,
  );
  const url = useSyncExternalStore(
    semSubscricao,
    () => window.location.href,
    () => "",
  );

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const l = c.dados;
  const emitida = l.estado === "emitida";
  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={l.numero} mono />
      <Cabecalho
        meta={`Câmara Municipal de ${l.municipio}`}
        titulo="Licença especial de ruído"
        sub={l.descricao}
      />

      {emitida ? (
        <CartaoDestaque
          rotulo={l.valida ? "Verificada pela câmara" : "Já passou"}
          tom={l.valida ? "verde" : "tinta"}
        >
          <p className="flex items-center gap-2 font-display text-[26px] leading-tight font-bold">
            <BadgeCheck className="size-7" aria-hidden />
            {l.valida ? "Licença válida" : "Licença expirada"}
          </p>
          <p className="text-[15px] text-white/85">
            {l.titular ? `Em nome de ${l.titular.replace(/\.$/, "")}. ` : ""}
            {l.atividade}.
          </p>
        </CartaoDestaque>
      ) : (
        <Nota icone={ShieldAlert} tom={l.estado === "recusada" ? "terracota" : "ambar"} papel="status">
          {l.estado === "recusada"
            ? "Esta licença não foi concedida."
            : "Esta licença ainda não foi emitida: não autoriza o evento."}
        </Nota>
      )}

      <ul className="flex flex-col gap-3 rounded-2xl border border-linha bg-papel p-5 text-[16px] text-tinta">
        <li className="flex gap-3">
          <CalendarDays className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          <span className="first-letter:uppercase">{l.dia}</span>
        </li>
        <li className="flex gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          {l.horario}
        </li>
        <li className="flex gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-terracota" aria-hidden />
          {l.morada}
        </li>
      </ul>

      <section className="flex flex-col gap-3" aria-labelledby="condicoes">
        <TituloSecao id="condicoes">Condições</TituloSecao>
        <ul className="flex flex-col gap-2">
          {l.condicoes.map((x) => (
            <li key={x} className="flex gap-2.5 text-[15px] leading-[1.45] text-tinta">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-terracota" />
              {x}
            </li>
          ))}
        </ul>
      </section>

      {emitida && url && (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-linha bg-papel p-5">
          <Rotulo>Mostre este código se lho pedirem</Rotulo>
          <QrSvg texto={url} className="w-56" />
          <span className="font-mono text-[13px] text-tinta-3">{codigo.toUpperCase()}</span>
        </section>
      )}

      {l.pdf && (
        <a
          href={`${API_URL}/v1/public/licencas/${encodeURIComponent(codigo)}/pdf`}
          className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
        >
          <Download className="size-5" aria-hidden />
          Descarregar a licença (PDF)
        </a>
      )}

      <div className="flex flex-wrap gap-2">
        {l.modo_teste && <ModoTeste texto="pagamento de teste" />}
        <ModoTeste texto="assinatura simulada" />
        {l.regras_de_demonstracao && <ModoTeste texto="regras de demonstração" />}
      </div>
      <p className="text-[13px] leading-[1.45] text-tinta-3">
        Base: {l.fonte}. Verificada pelas regras da câmara no momento do pedido
        {l.emitida_em ? " e aprovada por um funcionário" : ""}.
      </p>
    </div>
  );
}
