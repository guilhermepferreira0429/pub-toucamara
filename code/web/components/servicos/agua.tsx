"use client";

import { RotateCcw, Siren } from "lucide-react";
import { useState } from "react";
import {
  Cartao,
  ErroLinha,
  Estado,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Filtros, PilulaDemonstracao } from "@/components/servicos/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Água e saneamento (V4 #6). A câmara não trata da água (em
 * Guimarães é a Vimágua): aqui vê-se o que o agente recolheu e encaminhou,
 * e o estado do envio à entidade gestora (adaptador SIMULADO), com reenvio.
 */

type Envio = "por_enviar" | "enviado" | "falhou";

interface Resumo {
  entidade: {
    nome: string;
    site_url: string | null;
    contactos: { tipo: string; rotulo: string | null; valor: string }[];
    por_omissao: boolean;
  };
  integracao: { nome: string; simulado: boolean };
  envio: Partial<Record<Envio, number>>;
  tipos: Partial<Record<string, number>>;
}

interface Pedido {
  id: string;
  numero: string;
  tipo: "leitura" | "fatura" | "avaria" | "rotura" | "falta_agua";
  morada: string;
  numero_cliente: string | null;
  leitura_m3: number | null;
  descricao: string | null;
  urgente: boolean;
  perigo_via: boolean;
  ocorrencia_numero: string | null;
  nome: string | null;
  telefone: string | null;
  canal: string;
  envio_estado: Envio;
  envio_tentativas: number;
  enviado_em: string | null;
  referencia_externa: string | null;
  envio_erro: string | null;
  envio_simulado: boolean;
  criado_em: string;
}

const TIPOS: Record<Pedido["tipo"], string> = {
  leitura: "Leitura do contador",
  fatura: "Fatura",
  avaria: "Avaria",
  rotura: "Rotura",
  falta_agua: "Falta de água",
};

const ENVIOS: Record<Envio, { rotulo: string; tom: "verde" | "ambar" | "terracota" }> = {
  enviado: { rotulo: "enviado", tom: "verde" },
  por_enviar: { rotulo: "por enviar", tom: "ambar" },
  falhou: { rotulo: "envio falhou", tom: "terracota" },
};

export function PaginaAgua() {
  const { pode } = useSessao();
  const [envio, setEnvio] = useState<Envio | "">("");
  const ok = pode("servicos_municipais");
  const resumo = useDados<Resumo>(ok ? "/v1/painel/agua" : null);
  const base = ok ? `/v1/painel/agua/pedidos${envio ? `?envio=${envio}` : ""}` : null;
  const d = useDados<Pagina<Pedido>>(base);
  const mais = useMais(base, d);

  if (!ok) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Água e saneamento"]} titulo="Água e saneamento" />
        <SemAcesso />
      </div>
    );
  }
  const r = resumo.dados;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Água e saneamento"]}
        titulo="Água e saneamento"
        descricao={`Quem trata da água é ${r?.entidade.nome ?? "a entidade gestora"}, não a câmara. O agente recolhe a leitura, o pedido sobre a fatura ou a avaria, dá sempre o contacto deles e envia o pedido. Roturas com água na rua passam também a ocorrência.`}
        acoes={r?.integracao.simulado ? <PilulaDemonstracao texto="envio simulado" /> : null}
      />
      <div className="grid gap-6 px-4 sm:px-10 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Filtros
            rotulo="Estado do envio"
            valor={envio}
            onMudar={setEnvio}
            contagens={r?.envio}
            opcoes={[
              ["", "Todos"],
              ["enviado", "Enviados"],
              ["falhou", "Falharam"],
              ["por_enviar", "Por enviar"],
            ]}
          />
          <div className="flex flex-col gap-3">
            <Estado
              aCarregar={d.aCarregar}
              erro={d.erro}
              vazio={d.dados?.itens.length === 0}
              textoVazio="Ainda não há pedidos. Experimente no chat: «quero dar a leitura do contador da água»."
            >
              {d.dados?.itens.map((p) => (
                <CartaoPedido
                  key={p.id}
                  p={p}
                  onMudou={() => {
                    d.recarregar();
                    resumo.recarregar();
                  }}
                />
              ))}
            </Estado>
            {mais.haMais && (
              <Botao variante="secundario" onClick={mais.mais} disabled={mais.aCorrer}>
                Ver mais
              </Botao>
            )}
          </div>
        </div>
        <aside className="flex flex-col gap-4">
          <Cartao className="p-5">
            <Rotulo>Entidade gestora</Rotulo>
            <p className="mt-1 font-display text-lg font-bold text-tinta">{r?.entidade.nome ?? "—"}</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-tinta-2">
              {r?.entidade.contactos.map((c) => (
                <li key={`${c.tipo}${c.valor}`}>
                  <span className="text-tinta-3">{c.rotulo ?? c.tipo}:</span> {c.valor}
                </li>
              ))}
              {r?.entidade.site_url && <li>{r.entidade.site_url.replace(/^https?:\/\//, "")}</li>}
            </ul>
            {r?.entidade.por_omissao && (
              <p className="mt-2 text-xs text-tinta-3">
                O município ainda não tem os contactos desta entidade no conhecimento: o agente só dá o site.
              </p>
            )}
          </Cartao>
          <Cartao className="p-5">
            <Rotulo>Integração</Rotulo>
            <p className="mt-1 text-sm font-semibold text-tinta">{r?.integracao.nome ?? "—"}</p>
            {r?.integracao.simulado && (
              <p className="mt-1 text-xs text-tinta-3">
                Simulada: nada sai para a entidade. A referência «VIM-SIM-…» é de demonstração. Os envios que falham repetem-se de 5 em 5 minutos.
              </p>
            )}
          </Cartao>
        </aside>
      </div>
    </div>
  );
}

function CartaoPedido({ p, onMudou }: { p: Pedido; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const reenviar = async () => {
    if (await acao.executar(() => pedido(`/v1/painel/agua/pedidos/${p.id}/reenviar`, { metodo: "POST" }))) onMudou();
  };
  return (
    <Cartao className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-tinta-3">
            {p.numero} · {quando(p.criado_em)} · {p.canal}
          </p>
          <h3 className="font-display text-lg font-bold text-tinta">
            {TIPOS[p.tipo]}
            {p.leitura_m3 !== null ? ` · ${p.leitura_m3.toLocaleString("pt-PT")} m³` : ""}
          </h3>
          <p className="text-sm text-tinta-2">{p.morada}</p>
          {p.descricao && <p className="mt-1 text-sm text-tinta-2">{p.descricao}</p>}
          <p className="mt-1 text-xs text-tinta-3">
            {p.nome ?? "sem nome"}
            {p.numero_cliente ? ` · cliente ${p.numero_cliente}` : ""}
            {p.ocorrencia_numero ? ` · ocorrência ${p.ocorrencia_numero} na câmara` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {p.urgente && (
            <Pilula tom="terracota" icone={Siren}>
              urgente
            </Pilula>
          )}
          <Pilula tom={ENVIOS[p.envio_estado].tom}>{ENVIOS[p.envio_estado].rotulo}</Pilula>
          {p.referencia_externa && <span className="font-mono text-xs text-tinta-3">{p.referencia_externa}</span>}
          {p.envio_simulado && <span className="text-[11px] text-tinta-3">envio simulado</span>}
        </div>
      </div>
      {p.envio_estado !== "enviado" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Botao tamanho="pequeno" variante="secundario" icone={RotateCcw} disabled={acao.aCorrer} onClick={reenviar}>
            Reenviar
          </Botao>
          <span className="text-xs text-tinta-3">
            {p.envio_tentativas} {p.envio_tentativas === 1 ? "tentativa" : "tentativas"}
            {p.envio_erro ? ` · ${p.envio_erro}` : ""}
          </span>
        </div>
      )}
      <ErroLinha erro={acao.erro} className="mt-3" />
    </Cartao>
  );
}
