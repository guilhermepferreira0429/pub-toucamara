"use client";

import {
  Check,
  CircleDashed,
  FileCheck,
  FileClock,
  FilePenLine,
  FileX,
  Languages,
  PenLine,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CartaoEntregaEmNome } from "@/components/entregas/cartao-entrega";
import { useEffect, useRef, useState } from "react";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { sse } from "@/lib/api";
import { municipioEscolhido, useSessao } from "@/lib/sessao";
import { diaHora } from "./formatos";
import type { CampoRequerimento } from "./tipos";
import {
  ACarregar,
  BotaoPainel,
  Cartao,
  Chip,
  ErroEmLinha,
  LinkPainel,
  paraErro,
  RotuloSeccao,
} from "./ui";

/*
 * Requerimento ao vivo no painel (estilo do frame cq963, "07 Chamada ·
 * Requerimento ao vivo", em ecrã largo): os campos enchem-se enquanto o
 * agente fala com o munícipe, por SSE (GET com Authorization).
 */

interface DocItem {
  id: string;
  nome: string;
}

interface EstadoVivo {
  id: string;
  estado: "a_preencher" | "pronto" | "assinado" | "entregue" | "cancelado";
  tipo: { codigo: string; nome: string };
  idioma_conversa: string | null;
  campos: CampoRequerimento[];
  campos_originais: { chave: string; rotulo: string; valor: string | null }[] | null;
  campos_em_falta: { chave: string; rotulo: string }[];
  proxima_pergunta: string | null;
  documentos: {
    tem: DocItem[];
    por_verificar: DocItem[];
    faltam: (DocItem & { obrigatorio: boolean; ultima_verificacao: string })[];
  };
  assinatura: { tipo: string | null; simulada: boolean; assinado_em: string | null };
  processo: { numero: string } | null;
  conversa_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

type Ligacao = "a_ligar" | "ao_vivo" | "terminada" | "erro";

const ESTADO_TEXTO: Record<EstadoVivo["estado"], string> = {
  a_preencher: "A preencher",
  pronto: "Pronto a assinar",
  assinado: "Assinado",
  entregue: "Entregue · processo criado",
  cancelado: "Cancelado",
};

export function RequerimentoAoVivo() {
  const { id } = useParams<{ id: string }>();
  const { token, pode } = useSessao();
  const permitido = pode("conversas");
  const [dados, setDados] = useState<EstadoVivo | null>(null);
  const [ligacao, setLigacao] = useState<Ligacao>("a_ligar");
  const [erro, setErro] = useState<string | null>(null);
  const [mudados, setMudados] = useState<string[]>([]);
  const [tentativa, setTentativa] = useState(0);
  const anterior = useRef<EstadoVivo | null>(null);

  useEffect(() => {
    if (!token || !permitido) return;
    const ac = new AbortController();
    const municipio = municipioEscolhido();
    (async () => {
      try {
        for await (const ev of sse(`/v1/painel/requerimentos/${id}/ao-vivo`, {
          token,
          municipio,
          sinal: ac.signal,
        })) {
          if (ev.evento === "ping") continue;
          const novo = ev.dados as EstadoVivo;
          if (!novo || typeof novo !== "object" || !("campos" in novo)) continue;
          const antes = anterior.current;
          const diff = antes
            ? novo.campos
                .filter((c) => c.valor !== antes.campos.find((x) => x.chave === c.chave)?.valor)
                .map((c) => c.chave)
            : [];
          anterior.current = novo;
          setDados(novo);
          setMudados(diff);
          setLigacao("ao_vivo");
        }
        if (!ac.signal.aborted) setLigacao("terminada");
      } catch (e) {
        if (ac.signal.aborted) return;
        setErro(paraErro(e).message);
        setLigacao("erro");
      }
    })();
    return () => ac.abort();
  }, [id, token, permitido, tentativa]);

  // A marca de "acabou de chegar" dura uns segundos.
  useEffect(() => {
    if (!mudados.length) return;
    const t = setTimeout(() => setMudados([]), 2500);
    return () => clearTimeout(t);
  }, [mudados]);

  function religar() {
    setErro(null);
    setLigacao("a_ligar");
    setTentativa((t) => t + 1);
  }

  if (!permitido) {
    return (
      <div className="pt-10">
        <Aviso titulo="Sem acesso às conversas.">
          O requerimento ao vivo faz parte das conversas, que o seu perfil não inclui.
        </Aviso>
      </div>
    );
  }

  const aoVivo = ligacao === "ao_vivo" && dados?.estado === "a_preencher";
  const preenchidos = dados?.campos.filter((c) => c.valor !== null && c.valor !== "").length ?? 0;
  const total = dados?.campos.length ?? 0;
  const proxima = dados?.campos_em_falta[0]?.chave ?? null;

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Atendimento", "Requerimento ao vivo"]}
        titulo={dados ? `Requerimento · ${dados.tipo.nome}` : "Requerimento ao vivo"}
        descricao={
          <span className="flex items-center gap-2" aria-live="polite">
            <span
              aria-hidden
              className={`size-[7px] rounded-full ${
                aoVivo ? "animate-pulse bg-[#C62F1F]" : ligacao === "erro" ? "bg-terracota" : "bg-tinta-3"
              }`}
            />
            <span className="text-xs font-semibold text-tinta-2">
              {ligacao === "a_ligar"
                ? "A ligar…"
                : ligacao === "erro"
                  ? "Ligação perdida"
                  : aoVivo
                    ? `Ao vivo · atualizado ${diaHora(dados?.atualizado_em)}`
                    : dados
                      ? ESTADO_TEXTO[dados.estado]
                      : "Terminado"}
            </span>
          </span>
        }
        acoes={
          <>
            {(ligacao === "erro" || (ligacao === "terminada" && dados?.estado === "a_preencher")) && (
              <BotaoPainel icone={RefreshCw} onClick={religar}>
                Voltar a ligar
              </BotaoPainel>
            )}
            {dados?.conversa_id && (
              <LinkPainel href={`/painel/conversas/${dados.conversa_id}`}>Ver a conversa</LinkPainel>
            )}
          </>
        }
      />

      <div className="px-10">
        {erro && !dados ? (
          <Aviso titulo="Não foi possível abrir o requerimento." tom="erro">
            {erro}
          </Aviso>
        ) : !dados ? (
          <ACarregar texto="A ligar ao requerimento…" />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-4">
              <section
                aria-label="Campos do requerimento"
                className="overflow-hidden rounded-[20px_20px_20px_6px] border border-linha bg-papel"
              >
                <div className="flex items-center gap-2.5 bg-terracota px-[18px] py-3">
                  <FilePenLine className="size-[18px] text-white" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white">
                      {dados.estado === "a_preencher" ? "A preencher com o munícipe" : ESTADO_TEXTO[dados.estado]}
                    </p>
                    <p className="text-[11px] text-white/80">Formulário oficial · {dados.tipo.nome.toLowerCase()}</p>
                  </div>
                  <p className="text-[13px] font-bold text-white" aria-label={`${preenchidos} de ${total} campos preenchidos`}>
                    {preenchidos} de {total}
                  </p>
                </div>
                <ul aria-live="polite" aria-relevant="text">
                  {dados.campos.map((c) => {
                    const temValor = c.valor !== null && c.valor !== "";
                    const aPerguntar = !temValor && c.chave === proxima && dados.estado === "a_preencher";
                    const novo = mudados.includes(c.chave);
                    return (
                      <li
                        key={c.chave}
                        className={`flex items-center gap-2.5 border-t border-linha px-[18px] py-2.5 transition-colors duration-700 ${
                          aPerguntar ? "bg-terracota-suave" : novo ? "bg-verde-suave" : ""
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="text-[11px] text-tinta-3">
                            {c.rotulo}
                            {!c.obrigatorio ? " (opcional)" : ""}
                          </span>
                          {temValor ? (
                            <span className="text-sm font-semibold text-tinta">{c.valor}</span>
                          ) : aPerguntar ? (
                            <span className="flex items-center gap-1 text-sm font-semibold text-terracota-escuro">
                              a perguntar…
                              <span aria-hidden className="h-5 w-0.5 animate-pulse bg-terracota" />
                            </span>
                          ) : (
                            <span className="text-sm text-tinta-3">por preencher</span>
                          )}
                        </div>
                        {temValor ? (
                          <Check className="size-[18px] shrink-0 text-verde" aria-label="preenchido" />
                        ) : (
                          <CircleDashed className="size-[18px] shrink-0 text-tinta-3" aria-hidden />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {dados.proxima_pergunta && dados.estado === "a_preencher" && (
                <div className="flex flex-col gap-1 rounded-[4px_16px_16px_16px] border border-linha bg-papel px-3.5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-terracota-escuro">
                    Agente · próxima pergunta
                  </p>
                  <p className="text-[15px] text-tinta">{dados.proxima_pergunta}</p>
                </div>
              )}

              {dados.campos_originais && (
                <Cartao className="flex flex-col gap-2 p-4">
                  <RotuloSeccao className="flex items-center gap-1.5">
                    <Languages className="size-3.5" aria-hidden />
                    Como foi dito{dados.idioma_conversa ? ` (${dados.idioma_conversa})` : ""}
                  </RotuloSeccao>
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {dados.campos_originais.map((c) => (
                      <li key={c.chave}>
                        <span className="text-tinta-3">{c.rotulo}: </span>
                        <span className="text-tinta">{c.valor}</span>
                      </li>
                    ))}
                  </ul>
                </Cartao>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {dados.estado !== "a_preencher" && <CartaoEntregaEmNome requerimentoId={id} />}
              <Cartao className="flex flex-col gap-2 p-5">
                <RotuloSeccao>Documentos</RotuloSeccao>
                <ul className="flex flex-col">
                  {dados.documentos.tem.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 border-b border-linha py-2 text-[13px] text-tinta last:border-b-0">
                      <FileCheck className="size-[15px] text-verde" aria-hidden />
                      {d.nome}
                      <span className="sr-only">: verificado</span>
                    </li>
                  ))}
                  {dados.documentos.por_verificar.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 border-b border-linha py-2 text-[13px] text-tinta last:border-b-0">
                      <FileClock className="size-[15px] text-tinta-3" aria-hidden />
                      {d.nome}
                      <span className="text-[11px] text-tinta-3">a verificar</span>
                    </li>
                  ))}
                  {dados.documentos.faltam.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 border-b border-linha py-2 text-[13px] text-tinta last:border-b-0">
                      <FileX className={`size-[15px] ${d.obrigatorio ? "text-ambar" : "text-tinta-3"}`} aria-hidden />
                      {d.nome}
                      <span className="text-[11px] text-tinta-3">
                        {d.ultima_verificacao && d.ultima_verificacao !== "em_falta"
                          ? d.ultima_verificacao.replace(/_/g, " ")
                          : d.obrigatorio
                            ? "em falta"
                            : "opcional"}
                      </span>
                    </li>
                  ))}
                  {!dados.documentos.tem.length &&
                    !dados.documentos.por_verificar.length &&
                    !dados.documentos.faltam.length && (
                      <li className="text-[13px] text-tinta-3">Este tipo não pede documentos.</li>
                    )}
                </ul>
              </Cartao>

              <Cartao className="flex flex-col gap-2 p-5">
                <RotuloSeccao>Assinatura</RotuloSeccao>
                {dados.assinatura.assinado_em ? (
                  <p className="flex items-center gap-2 text-[13px] text-tinta">
                    <PenLine className="size-4 text-verde" aria-hidden />
                    Assinado a {diaHora(dados.assinatura.assinado_em)}
                    {dados.assinatura.simulada && (
                      <Chip tom="neutro" pequeno>simulada</Chip>
                    )}
                  </p>
                ) : (
                  <p className="text-[13px] text-tinta-3">
                    Ainda por assinar. O munícipe assina no link que recebe por SMS.
                  </p>
                )}
                {dados.processo && (
                  <p className="text-[13px] text-tinta">
                    Processo <strong>{dados.processo.numero}</strong> criado.{" "}
                    <Link
                      href={`/painel/processos?texto=${encodeURIComponent(dados.processo.numero)}`}
                      className="font-semibold text-terracota-escuro hover:underline"
                    >
                      Abrir nos processos
                    </Link>
                  </p>
                )}
              </Cartao>

              {ligacao === "terminada" && dados.estado === "a_preencher" && (
                <p className="text-xs text-tinta-3">
                  A ligação ao vivo terminou (dura até 30 minutos). Use «Voltar a ligar» para continuar a ver.
                </p>
              )}
              <ErroEmLinha erro={erro} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
