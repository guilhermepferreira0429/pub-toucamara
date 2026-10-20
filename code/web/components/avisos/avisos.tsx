"use client";

import { Ban, Eye, MapPin, Megaphone, Send, Users } from "lucide-react";
import { useState } from "react";
import { CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  Estado,
  numero,
  Pilula,
  quando,
  Rotulo,
  SemAcesso,
  useAcao,
  useDados,
  useMais,
  type Pagina,
} from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";

type TipoAviso = "obras" | "agua" | "residuos" | "transito" | "emergencia" | "outro";
type EstadoAviso = "rascunho" | "agendado" | "a_enviar" | "enviado" | "cancelado";
type Origem = "processo" | "ocorrencia" | "recolha" | "requerimento";

interface PreVisualizacao {
  destinatarios: number;
  por_origem: Record<Origem, number>;
  excluidos: { sem_telefone: number; recusaram_avisos: number; anonimizados: number };
  ignora_recusas: boolean;
  amostra: { nome: string; telefone: string; rua: string | null; origens: Origem[] }[];
  zona: { descricao: string; ruas_sem_coordenadas: string[] };
  desde: string;
  limite: number;
}

interface Aviso {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: TipoAviso;
  zona_descricao: string;
  ruas_sem_coordenadas: string[];
  desde: string;
  estado: EstadoAviso;
  destinatarios_previstos: number;
  enviar_em: string | null;
  agendado_para: string | null;
  criado_em: string;
  confirmado_em: string | null;
  terminado_em: string | null;
  cancelado_em: string | null;
  contagens: {
    destinatarios: number;
    por_enviar: number;
    enviados: number;
    entregues: number;
    falhados: number;
    excluidos: number;
    cancelados: number;
  };
}

const TIPOS: Record<TipoAviso, string> = {
  obras: "Obras",
  agua: "Água",
  residuos: "Resíduos",
  transito: "Trânsito",
  emergencia: "Emergência",
  outro: "Outro",
};

const ESTADOS: Record<EstadoAviso, { rotulo: string; tom: "neutro" | "ambar" | "verde" | "terracota" | "tinta" }> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" },
  agendado: { rotulo: "agendado", tom: "ambar" },
  a_enviar: { rotulo: "a enviar", tom: "ambar" },
  enviado: { rotulo: "enviado", tom: "verde" },
  cancelado: { rotulo: "cancelado", tom: "terracota" },
};

const ORIGENS: Record<Origem, string> = {
  processo: "processos",
  ocorrencia: "ocorrências",
  recolha: "recolhas",
  requerimento: "requerimentos",
};

type TipoZona = "ruas" | "ponto" | "poligono";

interface Formulario {
  titulo: string;
  mensagem: string;
  tipo: TipoAviso;
  zonaTipo: TipoZona;
  ruas: string;
  raio: string;
  lat: string;
  lng: string;
  pontos: string;
  descricao: string;
  desde: string;
  enviar_em: string;
}

const INICIAL: Formulario = {
  titulo: "",
  mensagem: "",
  tipo: "obras",
  zonaTipo: "ruas",
  ruas: "",
  raio: "150",
  lat: "",
  lng: "",
  pontos: "",
  descricao: "",
  desde: "",
  enviar_em: "",
};

function zonaDe(f: Formulario) {
  const descricao = f.descricao.trim() || undefined;
  if (f.zonaTipo === "ruas")
    return {
      tipo: "ruas",
      ruas: f.ruas.split("\n").map((x) => x.trim()).filter(Boolean),
      raio_m: Number(f.raio) || 150,
      descricao,
    };
  if (f.zonaTipo === "ponto")
    return { tipo: "ponto", lat: Number(f.lat), lng: Number(f.lng), raio_m: Number(f.raio) || 150, descricao };
  return {
    tipo: "poligono",
    pontos: f.pontos
      .split("\n")
      .map((l) => l.split(/[,;\s]+/).map(Number))
      .filter((p) => p.length >= 2 && p.every((x) => Number.isFinite(x)))
      .map(([lat, lng]) => ({ lat, lng })),
    descricao,
  };
}

function Previsao({ p }: { p: PreVisualizacao }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-creme p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[40px] leading-none font-bold text-terracota">{numero(p.destinatarios)}</span>
        <span className="text-sm text-tinta-2">{p.destinatarios === 1 ? "pessoa recebe o aviso" : "pessoas recebem o aviso"}</span>
      </div>
      <p className="text-xs text-tinta-2">
        {p.zona.descricao} · moradas desde {quando(p.desde)} ·{" "}
        {(Object.keys(p.por_origem) as Origem[])
          .filter((o) => p.por_origem[o])
          .map((o) => `${numero(p.por_origem[o])} de ${ORIGENS[o]}`)
          .join(", ") || "sem origens"}
      </p>
      <p className="text-xs text-tinta-3">
        Ficam de fora: {numero(p.excluidos.sem_telefone)} sem telemóvel,{" "}
        {numero(p.excluidos.recusaram_avisos)} que recusaram avisos{p.ignora_recusas ? " (numa emergência recebem na mesma)" : ""},{" "}
        {numero(p.excluidos.anonimizados)} anonimizados.
      </p>
      {p.destinatarios > p.limite && (
        <p className="text-xs font-semibold text-ambar">
          Mais de {numero(p.limite)} destinatários: só a equipa Tou, Câmara? pode enviar. Reduza a zona.
        </p>
      )}
      {p.zona.ruas_sem_coordenadas.length > 0 && (
        <p className="text-xs text-ambar">
          Não encontrámos no mapa: {p.zona.ruas_sem_coordenadas.join(", ")} (contam só pelo nome da rua).
        </p>
      )}
      {p.amostra.length > 0 && (
        <details className="text-xs text-tinta-2">
          <summary className="cursor-pointer font-semibold text-tinta">Ver uma amostra</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {p.amostra.map((x, i) => (
              <li key={i}>
                {x.nome} · {x.telefone}
                {x.rua ? ` · ${x.rua}` : ""} · {x.origens.map((o) => ORIGENS[o]).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function NovoAviso({ onCriado }: { onCriado: (a: Aviso, sms: { exemplo: string; segmentos: number }) => void }) {
  const { pedido } = useSessao();
  const [f, setF] = useState<Formulario>(INICIAL);
  const [previa, setPrevia] = useState<PreVisualizacao | null>(null);
  const ver = useAcao();
  const criar = useAcao();
  const muda = (x: Partial<Formulario>) => {
    setF((a) => ({ ...a, ...x }));
    if ("zonaTipo" in x || "ruas" in x || "raio" in x || "lat" in x || "lng" in x || "pontos" in x || "desde" in x)
      setPrevia(null);
  };
  const desde = f.desde ? new Date(`${f.desde}T00:00:00`).toISOString() : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await criar.executar(() =>
          pedido<Aviso & { pre_visualizacao: PreVisualizacao; sms: { exemplo: string; segmentos: number } }>(
            "/v1/painel/avisos-zona",
            {
              corpo: {
                titulo: f.titulo.trim(),
                mensagem: f.mensagem.trim(),
                tipo: f.tipo,
                zona: zonaDe(f),
                desde,
                enviar_em: f.enviar_em ? new Date(f.enviar_em).toISOString() : undefined,
              },
            },
          ),
        );
        if (r) {
          setF(INICIAL);
          setPrevia(null);
          onCriado(r, r.sms);
        }
      }}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <Campo rotulo="Título">
          <input className={classeEntrada} required minLength={3} maxLength={120} value={f.titulo} onChange={(e) => muda({ titulo: e.target.value })} placeholder="Corte de água amanhã" />
        </Campo>
        <Campo rotulo="Tipo">
          <select className={classeEntrada} value={f.tipo} onChange={(e) => muda({ tipo: e.target.value as TipoAviso })}>
            {(Object.keys(TIPOS) as TipoAviso[]).map((t) => (
              <option key={t} value={t}>
                {TIPOS[t]}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Mensagem" ajuda={`${f.mensagem.length} / 480 · vai por SMS com um link para a página do aviso`}>
        <textarea className={`${classeEntrada} min-h-20`} required minLength={3} maxLength={480} value={f.mensagem} onChange={(e) => muda({ mensagem: e.target.value })} />
      </Campo>
      {f.tipo === "emergencia" && (
        <p className="rounded-xl bg-terracota-suave px-3 py-2 text-xs text-terracota-escuro">
          Emergência: sai a qualquer hora e chega também a quem recusou avisos.
        </p>
      )}

      <fieldset className="flex flex-col gap-3 rounded-xl border border-linha p-4">
        <legend className="px-1 text-[13px] font-semibold text-tinta">Zona</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Como indicar a zona">
          {(
            [
              ["ruas", "Ruas"],
              ["ponto", "Ponto e raio"],
              ["poligono", "Polígono"],
            ] as const
          ).map(([k, r]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.zonaTipo === k}
              onClick={() => muda({ zonaTipo: k })}
              className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
                f.zonaTipo === k ? "border-tinta bg-tinta text-white" : "border-linha bg-creme text-tinta-2"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {f.zonaTipo === "ruas" && (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
            <Campo rotulo="Ruas (uma por linha, até 10)">
              <textarea className={`${classeEntrada} min-h-20`} required value={f.ruas} onChange={(e) => muda({ ruas: e.target.value })} placeholder="Rua de Santo António" />
            </Campo>
            <Campo rotulo="Raio à volta (m)">
              <input type="number" min={20} max={2000} className={classeEntrada} value={f.raio} onChange={(e) => muda({ raio: e.target.value })} />
            </Campo>
          </div>
        )}
        {f.zonaTipo === "ponto" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Latitude">
              <input type="number" step="any" required className={classeEntrada} value={f.lat} onChange={(e) => muda({ lat: e.target.value })} />
            </Campo>
            <Campo rotulo="Longitude">
              <input type="number" step="any" required className={classeEntrada} value={f.lng} onChange={(e) => muda({ lng: e.target.value })} />
            </Campo>
            <Campo rotulo="Raio (m)">
              <input type="number" min={10} max={10000} required className={classeEntrada} value={f.raio} onChange={(e) => muda({ raio: e.target.value })} />
            </Campo>
          </div>
        )}
        {f.zonaTipo === "poligono" && (
          <Campo rotulo="Vértices (um por linha: latitude, longitude; pelo menos 3)">
            <textarea className={`${classeEntrada} min-h-24 font-mono text-xs`} required value={f.pontos} onChange={(e) => muda({ pontos: e.target.value })} placeholder={"41.4425, -8.2918\n41.4431, -8.2902\n41.4419, -8.2895"} />
          </Campo>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <Campo rotulo="Descrição da zona (opcional)">
            <input className={classeEntrada} maxLength={200} value={f.descricao} onChange={(e) => muda({ descricao: e.target.value })} />
          </Campo>
          <Campo rotulo="Moradas conhecidas desde" ajuda="Por omissão, os últimos 12 meses.">
            <input type="date" className={classeEntrada} value={f.desde} onChange={(e) => muda({ desde: e.target.value })} />
          </Campo>
          <Campo rotulo="Enviar a (opcional)" ajuda="Fora de emergências, só sai em horas decentes.">
            <input type="datetime-local" className={classeEntrada} value={f.enviar_em} onChange={(e) => muda({ enviar_em: e.target.value })} />
          </Campo>
        </div>
        <Botao
          variante="secundario"
          tamanho="pequeno"
          icone={Eye}
          className="w-fit"
          disabled={ver.aCorrer}
          onClick={async () => {
            const p = await ver.executar(() =>
              pedido<PreVisualizacao>("/v1/painel/avisos-zona/pre-visualizar", { corpo: { zona: zonaDe(f), desde } }),
            );
            if (p) setPrevia(p);
          }}
        >
          {ver.aCorrer ? "A contar…" : "Quantas pessoas recebem?"}
        </Botao>
        <ErroLinha erro={ver.erro} />
        {previa && <Previsao p={previa} />}
      </fieldset>

      <ErroLinha erro={criar.erro} />
      <div className="flex justify-end">
        <Botao type="submit" icone={Megaphone} disabled={criar.aCorrer}>
          {criar.aCorrer ? "A preparar…" : "Preparar aviso"}
        </Botao>
      </div>
      <p className="text-right text-xs text-tinta-3">
        Fica em rascunho. Só sai depois de confirmar o número de pessoas.
      </p>
    </form>
  );
}

function Confirmar({ aviso, onFeito }: { aviso: Aviso; onFeito: (a: Aviso) => void }) {
  const { pedido } = useSessao();
  const [n, setN] = useState("");
  const [esperado, setEsperado] = useState(aviso.destinatarios_previstos);
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido<Aviso>(`/v1/painel/avisos-zona/${aviso.id}/enviar`, { corpo: { confirmo_destinatarios: Number(n) } }),
        );
        if (r) onFeito(r);
      }}
    >
      <p className="text-sm text-tinta-2">
        «{aviso.titulo}» vai por SMS para <strong className="text-tinta">{numero(esperado)}</strong>{" "}
        {esperado === 1 ? "pessoa" : "pessoas"} em {aviso.zona_descricao}. Para confirmar, escreva o número exato.
      </p>
      <Campo rotulo="Número de pessoas">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          required
          className={classeEntrada}
          value={n}
          onChange={(e) => setN(e.target.value)}
          autoFocus
        />
      </Campo>
      <ErroLinha erro={acao.erro} />
      {acao.erro?.codigo === "confirmacao_diferente" && (
        <Botao
          variante="discreto"
          tamanho="pequeno"
          className="w-fit"
          onClick={() => {
            const d = acao.erro?.detalhes as { destinatarios?: number } | undefined;
            if (d?.destinatarios !== undefined) setEsperado(d.destinatarios);
            setN("");
            acao.limpar();
          }}
        >
          Rever com o número novo
        </Botao>
      )}
      <div className="flex justify-end">
        <Botao type="submit" icone={Send} disabled={acao.aCorrer || Number(n) !== esperado}>
          Confirmar e enviar
        </Botao>
      </div>
    </form>
  );
}

/** Avisos por zona: SMS só para quem é afetado (corte de água, obras, emergências). */
export function PaginaAvisos() {
  const { pedido, pode } = useSessao();
  const ver = pode("visao_geral");
  const escrever = pode("agente");
  const [estado, setEstado] = useState<"" | EstadoAviso>("");
  const [confirmar, setConfirmar] = useState<Aviso | null>(null);
  const [criado, setCriado] = useState<{ aviso: Aviso; sms: { exemplo: string; segmentos: number } } | null>(null);
  const base = ver ? `/v1/painel/avisos-zona?limite=30${estado ? `&estado=${estado}` : ""}` : null;
  const lista = useDados<Pagina<Aviso>>(base);
  const mais = useMais(base, lista);
  const cancelar = useAcao();

  if (!ver) {
    return (
      <>
        <CabecalhoPagina titulo="Avisos por zona" />
        <SemAcesso />
      </>
    );
  }
  const trocar = (a: Aviso) =>
    lista.mudar((d) => ({ ...d, itens: d.itens.map((x) => (x.id === a.id ? a : x)) }));

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Gestão", "Avisos"]}
        titulo="Avisos por zona"
        descricao="Um SMS só para quem é afetado: quem tem processos, ocorrências ou pedidos com morada na zona."
      />
      <div className="grid items-start gap-6 px-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <Cartao className="flex flex-col p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <h2 className="font-display text-[19px] font-bold text-tinta">Avisos</h2>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estado">
              {(["", "rascunho", "agendado", "enviado", "cancelado"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={estado === e}
                  onClick={() => setEstado(e)}
                  className={`rounded-[14px] border px-2.5 py-[5px] text-xs font-semibold ${
                    estado === e ? "border-tinta bg-tinta text-white" : "border-linha bg-creme text-tinta-2"
                  }`}
                >
                  {e ? ESTADOS[e].rotulo : "Todos"}
                </button>
              ))}
            </div>
          </div>
          <ErroLinha erro={cancelar.erro} className="mb-2" />
          <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={!lista.dados?.itens.length} textoVazio="Ainda não há avisos.">
            <ul>
              {lista.dados?.itens.map((a) => {
                const c = a.contagens;
                return (
                  <li key={a.id} className="flex flex-col gap-2 border-t border-linha py-3.5">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-semibold text-tinta">{a.titulo}</span>
                        <span className="flex items-center gap-1 text-xs text-tinta-3">
                          <MapPin className="size-3" aria-hidden />
                          {TIPOS[a.tipo]} · {a.zona_descricao} · criado {quando(a.criado_em)}
                        </span>
                      </span>
                      <Pilula tom={ESTADOS[a.estado].tom}>{ESTADOS[a.estado].rotulo}</Pilula>
                    </div>
                    <p className="text-[13px] text-tinta-2">{a.mensagem}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-2">
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden />
                        {numero(a.estado === "rascunho" ? a.destinatarios_previstos : c.destinatarios)} pessoas
                      </span>
                      {a.estado !== "rascunho" && a.estado !== "cancelado" && (
                        <span>
                          {numero(c.enviados)} enviados · {numero(c.entregues)} entregues
                          {c.falhados ? ` · ${numero(c.falhados)} falharam` : ""}
                          {c.por_enviar ? ` · ${numero(c.por_enviar)} por enviar` : ""}
                        </span>
                      )}
                      {a.agendado_para && a.estado === "agendado" && <span>sai {quando(a.agendado_para)}</span>}
                    </div>
                    {escrever && ["rascunho", "agendado", "a_enviar"].includes(a.estado) && (
                      <div className="flex gap-2">
                        {a.estado === "rascunho" && (
                          <Botao tamanho="pequeno" icone={Send} onClick={() => setConfirmar(a)}>
                            Enviar
                          </Botao>
                        )}
                        <Botao
                          variante="discreto"
                          tamanho="pequeno"
                          icone={Ban}
                          disabled={cancelar.aCorrer}
                          onClick={async () => {
                            if (!window.confirm(`Cancelar o aviso «${a.titulo}»?`)) return;
                            const r = await cancelar.executar(() =>
                              pedido<Aviso>(`/v1/painel/avisos-zona/${a.id}/cancelar`, { metodo: "POST" }),
                            );
                            if (r) trocar(r);
                          }}
                        >
                          Cancelar
                        </Botao>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {mais.haMais && (
              <Botao variante="discreto" tamanho="pequeno" className="w-fit" onClick={mais.mais} disabled={mais.aCorrer}>
                Ver mais
              </Botao>
            )}
          </Estado>
        </Cartao>

        {escrever ? (
          <Cartao className="flex flex-col gap-4 p-6">
            <h2 className="font-display text-[19px] font-bold text-tinta">Novo aviso</h2>
            {criado && (
              <div className="flex flex-col gap-2 rounded-xl bg-verde-suave p-4 text-[13px] text-tinta">
                <p className="font-semibold text-verde">Aviso preparado. Confirme o envio na lista.</p>
                <Rotulo>Assim fica o SMS ({criado.sms.segmentos} {criado.sms.segmentos === 1 ? "parte" : "partes"})</Rotulo>
                <p className="rounded-[14px_14px_14px_4px] bg-[#E9E9EB] px-3 py-2.5 text-[13px] whitespace-pre-line text-[#111111]">
                  {criado.sms.exemplo}
                </p>
              </div>
            )}
            <NovoAviso
              onCriado={(a, sms) => {
                setCriado({ aviso: a, sms });
                lista.recarregar();
              }}
            />
          </Cartao>
        ) : (
          <Cartao className="p-6 text-sm text-tinta-2">
            Só o chefe de divisão (ou a equipa Tou, Câmara?) prepara e envia avisos.
          </Cartao>
        )}
      </div>

      <Dialogo titulo="Confirmar envio" aberto={!!confirmar} onFechar={() => setConfirmar(null)}>
        {confirmar && (
          <Confirmar
            aviso={confirmar}
            onFeito={(a) => {
              setConfirmar(null);
              trocar(a);
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
