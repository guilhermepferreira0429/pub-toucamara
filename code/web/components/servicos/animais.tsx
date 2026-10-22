"use client";

import { ExternalLink, Plus, Siren } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  dia,
  Dialogo,
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
import { Filtros, PilulaDemonstracao, Separadores } from "@/components/servicos/comum";
import { RetratoAnimal } from "@/components/servicos/retrato-animal";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Animais (V4 #9): os animais do canil/gatil para adoção (os que
 * aparecem em /adotar), os pedidos de visita para adotar (confirmar a hora
 * por SMS) e os animais perdidos, encontrados e na via.
 */

type EstadoAnimal = "disponivel" | "reservado" | "adotado";
type EstadoVisita = "pedida" | "confirmada" | "realizada" | "adotou" | "cancelada";
type EstadoReporte = "aberto" | "recolhido" | "devolvido" | "resolvido";

interface Animal {
  id: string;
  nome: string;
  especie: "cao" | "gato";
  sexo: string | null;
  porte: string | null;
  idade: string | null;
  descricao: string;
  cor: string | null;
  esterilizado: boolean;
  vacinado: boolean;
  estado: EstadoAnimal;
  entrada_em: string;
  demonstracao: boolean;
}

interface Resumo {
  animais: Animal[];
  contagens: { visitas_pedidas: number; reportados_abertos: number; urgentes_abertos: number };
  canil: { nome: string; horario_dito: string; demonstracao: boolean };
}

interface Visita {
  id: string;
  numero: string;
  nome: string;
  telefone: string | null;
  canal: string;
  dia: string;
  periodo: "manha" | "tarde";
  observacoes: string | null;
  estado: EstadoVisita;
  animal: string | null;
  animal_dito: string | null;
  criado_em: string;
}

interface Reportado {
  id: string;
  numero: string;
  tipo: string;
  tipo_dito: string;
  especie: string;
  nome_animal: string | null;
  descricao: string;
  morada: string;
  urgente: boolean;
  com_chip: boolean | null;
  estado: EstadoReporte;
  ocorrencia_numero: string | null;
  parecidos: number;
  criado_em: string;
}

const ESTADOS_ANIMAL: Record<EstadoAnimal, { rotulo: string; tom: "verde" | "ambar" | "neutro" }> = {
  disponivel: { rotulo: "para adoção", tom: "verde" },
  reservado: { rotulo: "reservado", tom: "ambar" },
  adotado: { rotulo: "adotado", tom: "neutro" },
};
const ESTADOS_VISITA: Record<EstadoVisita, { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" }> = {
  pedida: { rotulo: "por confirmar", tom: "terracota" },
  confirmada: { rotulo: "confirmada", tom: "ambar" },
  realizada: { rotulo: "realizada", tom: "neutro" },
  adotou: { rotulo: "adotou", tom: "verde" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};
const ESTADOS_REPORTE: Record<EstadoReporte, string> = {
  aberto: "em aberto",
  recolhido: "recolhido pelo canil",
  devolvido: "devolvido ao dono",
  resolvido: "resolvido",
};
const ESPECIES: Record<string, string> = { cao: "cão", gato: "gato", outro: "outro" };
const PORTES: Record<string, string> = { pequeno: "pequeno", medio: "médio", grande: "grande" };

export function PaginaAnimais() {
  const { pode } = useSessao();
  const [vista, setVista] = useState<"animais" | "visitas" | "reportados">("animais");
  const resumo = useDados<Resumo>(pode("servicos_municipais") ? "/v1/painel/animais" : null);

  if (!pode("servicos_municipais")) {
    return (
      <div className="pb-10">
        <CabecalhoPagina migalhas={["Serviços", "Animais"]} titulo="Animais" />
        <SemAcesso />
      </div>
    );
  }
  const r = resumo.dados;
  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Serviços", "Animais"]}
        titulo="Canil e animais"
        descricao="Os animais para adoção (os mesmos da página pública), as visitas pedidas ao agente e os animais perdidos, encontrados, feridos ou agressivos. O registo e a vacina são do SIAC, nacional: o agente só informa."
        acoes={
          <>
            {r?.canil.demonstracao && <PilulaDemonstracao texto="canil e animais de demonstração" />}
            <a
              href="/adotar"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-sm font-semibold text-tinta hover:bg-tinta/5"
            >
              <ExternalLink className="size-4" aria-hidden /> Ver /adotar
            </a>
          </>
        }
      />
      <Separadores
        rotulo="Vista"
        valor={vista}
        onMudar={setVista}
        opcoes={[
          ["animais", `Animais${r ? ` · ${r.animais.filter((a) => a.estado !== "adotado").length}` : ""}`],
          ["visitas", `Visitas para adotar${r?.contagens.visitas_pedidas ? ` · ${r.contagens.visitas_pedidas}` : ""}`],
          ["reportados", `Perdidos e encontrados${r?.contagens.reportados_abertos ? ` · ${r.contagens.reportados_abertos}` : ""}`],
        ]}
      />
      <div className="px-4 sm:px-10">
        {vista === "animais" && (
          <Estado aCarregar={resumo.aCarregar} erro={resumo.erro}>
            {r && <Animais r={r} onMudou={resumo.recarregar} />}
          </Estado>
        )}
        {vista === "visitas" && <Visitas onMudou={resumo.recarregar} />}
        {vista === "reportados" && <Reportados onMudou={resumo.recarregar} />}
      </div>
    </div>
  );
}

function Animais({ r, onMudou }: { r: Resumo; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [novo, setNovo] = useState(false);
  const mudar = async (id: string, estado: EstadoAnimal) => {
    if (await acao.executar(() => pedido(`/v1/painel/animais/${id}`, { metodo: "PATCH", corpo: { estado } }))) onMudou();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-2">
          {r.canil.nome} · {r.canil.horario_dito}
        </p>
        <Botao icone={Plus} onClick={() => setNovo(true)}>
          Novo animal
        </Botao>
      </div>
      <ErroLinha erro={acao.erro} />
      {r.animais.length === 0 && <p className="text-sm text-tinta-3">Ainda não há animais (Preparar demo ou Novo animal).</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {r.animais.map((a) => (
          <Cartao key={a.id} className={`flex gap-4 p-4 ${a.estado === "adotado" ? "opacity-60" : ""}`}>
            <RetratoAnimal especie={a.especie} cor={a.cor} tamanho={72} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-tinta">{a.nome}</h3>
                <Pilula tom={ESTADOS_ANIMAL[a.estado].tom}>{ESTADOS_ANIMAL[a.estado].rotulo}</Pilula>
              </div>
              <p className="text-xs text-tinta-3">
                {ESPECIES[a.especie]}
                {a.porte ? ` · porte ${PORTES[a.porte] ?? a.porte}` : ""}
                {a.idade ? ` · ${a.idade}` : ""} · no canil desde {dia(a.entrada_em)}
              </p>
              <p className="mt-1 text-sm text-tinta-2">{a.descricao}</p>
              <label className="mt-2 flex items-center gap-2 text-xs text-tinta-3">
                Estado
                <select
                  className="rounded-lg border border-linha bg-creme px-2 py-1 text-xs text-tinta"
                  value={a.estado}
                  disabled={acao.aCorrer}
                  onChange={(e) => void mudar(a.id, e.target.value as EstadoAnimal)}
                >
                  <option value="disponivel">para adoção</option>
                  <option value="reservado">reservado</option>
                  <option value="adotado">adotado</option>
                </select>
              </label>
            </div>
          </Cartao>
        ))}
      </div>
      <NovoAnimal
        aberto={novo}
        onFechar={() => setNovo(false)}
        onCriado={() => {
          setNovo(false);
          onMudou();
        }}
      />
    </div>
  );
}

function NovoAnimal({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [f, setF] = useState({ nome: "", especie: "cao", porte: "medio", idade: "", descricao: "", cor: "#b7793f" });
  const criar = async () => {
    const r = await acao.executar(() =>
      pedido("/v1/painel/animais", {
        metodo: "POST",
        corpo: { ...f, idade: f.idade || undefined, vacinado: true, esterilizado: true },
      }),
    );
    if (r) {
      setF({ nome: "", especie: "cao", porte: "medio", idade: "", descricao: "", cor: "#b7793f" });
      onCriado();
    }
  };
  return (
    <Dialogo titulo="Novo animal para adoção" aberto={aberto} onFechar={onFechar}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome">
          <input className={classeEntrada} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Espécie">
          <select className={classeEntrada} value={f.especie} onChange={(e) => setF({ ...f, especie: e.target.value })}>
            <option value="cao">Cão</option>
            <option value="gato">Gato</option>
          </select>
        </Campo>
        <Campo rotulo="Porte">
          <select className={classeEntrada} value={f.porte} onChange={(e) => setF({ ...f, porte: e.target.value })}>
            <option value="pequeno">Pequeno</option>
            <option value="medio">Médio</option>
            <option value="grande">Grande</option>
          </select>
        </Campo>
        <Campo rotulo="Idade (aproximada)">
          <input className={classeEntrada} value={f.idade} placeholder="cerca de 2 anos" onChange={(e) => setF({ ...f, idade: e.target.value })} />
        </Campo>
        <Campo rotulo="Descrição" className="sm:col-span-2">
          <textarea className={`${classeEntrada} min-h-20`} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        <Campo rotulo="Cor da ilustração">
          <input type="color" className="h-10 w-16 rounded-lg border border-linha" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} />
        </Campo>
      </div>
      <ErroLinha erro={acao.erro} className="mt-3" />
      <div className="mt-4 flex justify-end gap-2">
        <Botao variante="discreto" onClick={onFechar}>
          Cancelar
        </Botao>
        <Botao disabled={acao.aCorrer || f.nome.trim().length < 2 || f.descricao.trim().length < 5} onClick={criar}>
          Acrescentar
        </Botao>
      </div>
    </Dialogo>
  );
}

function Visitas({ onMudou }: { onMudou: () => void }) {
  const [estado, setEstado] = useState<EstadoVisita | "">("");
  const base = `/v1/painel/animais/visitas${estado ? `?estado=${estado}` : ""}`;
  const d = useDados<Pagina<Visita>>(base);
  const mais = useMais(base, d);
  return (
    <div>
      <Filtros
        rotulo="Estado"
        valor={estado}
        onMudar={setEstado}
        opcoes={[
          ["", "Todas"],
          ["pedida", "Por confirmar"],
          ["confirmada", "Confirmadas"],
          ["adotou", "Adotaram"],
          ["cancelada", "Canceladas"],
        ]}
      />
      <div className="flex flex-col gap-3">
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.itens.length === 0} textoVazio="Ainda não há pedidos de visita.">
          {d.dados?.itens.map((v) => (
            <CartaoVisita
              key={v.id}
              v={v}
              onMudou={() => {
                d.recarregar();
                onMudou();
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
  );
}

function CartaoVisita({ v, onMudou }: { v: Visita; onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [confirmar, setConfirmar] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const mudar = async (estado: EstadoVisita, msg?: string) => {
    const r = await acao.executar(() =>
      pedido(`/v1/painel/animais/visitas/${v.id}`, { metodo: "PATCH", corpo: { estado, ...(msg ? { mensagem: msg } : {}) } }),
    );
    if (r) {
      setConfirmar(false);
      onMudou();
    }
  };
  return (
    <Cartao className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-semibold text-tinta-3">{v.numero}</p>
          <h3 className="font-display text-lg font-bold text-tinta">
            {dia(v.dia)}, {v.periodo === "manha" ? "de manhã" : "à tarde"}
          </h3>
          <p className="text-sm text-tinta-2">
            {v.nome} · {v.animal ? `quer conhecer ${v.animal}` : v.animal_dito ? `disse «${v.animal_dito}»` : "ainda não escolheu"} · pedido{" "}
            {quando(v.criado_em)}
          </p>
          {v.observacoes && <p className="mt-1 text-sm text-tinta-2">{v.observacoes}</p>}
        </div>
        <Pilula tom={ESTADOS_VISITA[v.estado].tom}>{ESTADOS_VISITA[v.estado].rotulo}</Pilula>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {v.estado === "pedida" && (
          <Botao tamanho="pequeno" onClick={() => setConfirmar(true)}>
            Confirmar hora
          </Botao>
        )}
        {(v.estado === "pedida" || v.estado === "confirmada") && (
          <>
            <Botao variante="secundario" tamanho="pequeno" disabled={acao.aCorrer} onClick={() => mudar("adotou")}>
              Adotou
            </Botao>
            <Botao variante="discreto" tamanho="pequeno" disabled={acao.aCorrer} onClick={() => mudar("realizada")}>
              Visita feita
            </Botao>
            <Botao variante="discreto" tamanho="pequeno" disabled={acao.aCorrer} onClick={() => mudar("cancelada")}>
              Desmarcar
            </Botao>
          </>
        )}
      </div>
      <ErroLinha erro={acao.erro} className="mt-3" />
      <Dialogo titulo="Confirmar a visita" aberto={confirmar} onFechar={() => setConfirmar(false)}>
        <Campo rotulo="Hora e local (vai por SMS)" ajuda={v.telefone ? undefined : "Sem telemóvel: fica só registado."}>
          <input className={classeEntrada} value={mensagem} placeholder="Às 10:30, na receção do canil." onChange={(e) => setMensagem(e.target.value)} />
        </Campo>
        <ErroLinha erro={acao.erro} className="mt-3" />
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="discreto" onClick={() => setConfirmar(false)}>
            Cancelar
          </Botao>
          <Botao disabled={acao.aCorrer || mensagem.trim().length < 3} onClick={() => mudar("confirmada", mensagem.trim())}>
            Confirmar e avisar
          </Botao>
        </div>
      </Dialogo>
    </Cartao>
  );
}

function Reportados({ onMudou }: { onMudou: () => void }) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const [tipo, setTipo] = useState<string>("");
  const base = `/v1/painel/animais/reportados${tipo ? `?tipo=${tipo}` : ""}`;
  const d = useDados<Pagina<Reportado>>(base);
  const mais = useMais(base, d);
  const mudar = async (id: string, estado: EstadoReporte) => {
    if (await acao.executar(() => pedido(`/v1/painel/animais/reportados/${id}`, { metodo: "PATCH", corpo: { estado } }))) {
      d.recarregar();
      onMudou();
    }
  };
  return (
    <div>
      <Filtros
        rotulo="Tipo"
        valor={tipo}
        onMudar={setTipo}
        opcoes={[
          ["", "Todos"],
          ["perdido", "Perdidos"],
          ["encontrado", "Encontrados"],
          ["abandonado", "Abandonados"],
          ["ferido", "Feridos"],
          ["agressivo", "Agressivos"],
        ]}
      />
      <ErroLinha erro={acao.erro} className="mb-3" />
      <div className="flex flex-col gap-3">
        <Estado aCarregar={d.aCarregar} erro={d.erro} vazio={d.dados?.itens.length === 0} textoVazio="Ainda não há avisos.">
          {d.dados?.itens.map((a) => (
            <Cartao key={a.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-tinta-3">
                    {a.numero} · {quando(a.criado_em)}
                  </p>
                  <h3 className="font-display text-lg font-bold text-tinta first-letter:uppercase">
                    {a.tipo_dito} · {ESPECIES[a.especie] ?? a.especie}
                    {a.nome_animal ? ` «${a.nome_animal}»` : ""}
                  </h3>
                  <p className="text-sm text-tinta-2">{a.descricao}</p>
                  <p className="text-xs text-tinta-3">
                    {a.morada}
                    {a.com_chip ? " · tem chip" : ""}
                    {a.ocorrencia_numero ? ` · ocorrência ${a.ocorrencia_numero}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {a.urgente && (
                    <Pilula tom="terracota" icone={Siren}>
                      urgente
                    </Pilula>
                  )}
                  {a.parecidos > 0 && <Pilula tom="ambar">{a.parecidos === 1 ? "1 aviso parecido" : `${a.parecidos} avisos parecidos`}</Pilula>}
                  <label className="flex items-center gap-2 text-xs text-tinta-3">
                    <Rotulo className="!text-[10px]">Estado</Rotulo>
                    <select
                      className="rounded-lg border border-linha bg-creme px-2 py-1 text-xs text-tinta"
                      value={a.estado}
                      disabled={acao.aCorrer}
                      onChange={(e) => void mudar(a.id, e.target.value as EstadoReporte)}
                    >
                      {(Object.keys(ESTADOS_REPORTE) as EstadoReporte[]).map((e) => (
                        <option key={e} value={e}>
                          {ESTADOS_REPORTE[e]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </Cartao>
          ))}
        </Estado>
        {mais.haMais && (
          <Botao variante="secundario" onClick={mais.mais} disabled={mais.aCorrer}>
            Ver mais
          </Botao>
        )}
      </div>
    </div>
  );
}
