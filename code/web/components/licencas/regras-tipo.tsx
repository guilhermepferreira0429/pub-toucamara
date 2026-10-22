"use client";

import { ArrowDown, ArrowUp, Code2, Database, FlaskConical, Minus, Pencil, Plus, Save } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  Cartao,
  classeEntrada,
  Dialogo,
  ErroLinha,
  euros,
  Interruptor,
  numero,
  Pilula,
  Rotulo,
  useAcao,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * As regras em código de um tipo de licença, como o agente as aplica, e o
 * editor com "Simular": antes de gravar, a câmara vê o que a regra nova
 * faria aos pedidos antigos (quem deixava de ser aprovado na hora, quem
 * passava a ser, quanto mudava a receita das taxas e exemplos concretos).
 */

export type TipoLicenca =
  | "ruido"
  | "ocupacao_via"
  | "esplanada"
  | "distico_residente"
  | "publicidade"
  | "recinto_improvisado";

export interface CampoRegra {
  chave: string;
  rotulo: string;
  tipo: "hora" | "inteiro" | "decimal" | "euros" | "booleano" | "opcoes" | "lista_euros";
  unidade?: string;
  opcoes?: Record<string, string>;
}

export type Config = Record<string, unknown> & {
  aprovacao: "funcionario" | "automatica";
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
};

export interface InfoTipo {
  tipo: TipoLicenca;
  nome: string;
  codigo: string;
  ferramenta: string;
  config: Config;
  atualizado_em: string | null;
  campos: CampoRegra[];
  pedidos: number;
  historico: { pedidos: number; demonstracao: number };
  /** Tem validade: avisa antes de expirar e renova-se pelo agente. */
  renovavel?: boolean;
}

interface Exemplo {
  id: string;
  referencia: string;
  pedido_em: string;
  resumo: string;
  demonstracao: boolean;
  antes: { decisao: string; aprovado: boolean; taxa_cent: number };
  depois: { decisao: string; aprovado: boolean; taxa_cent: number };
  porque: string[];
}

interface Simulacao {
  nome: string;
  anos: number;
  total: number;
  mudam: number;
  deixam_de_ser_aprovados: number;
  passam_a_ser_aprovados: number;
  mudam_de_taxa: number;
  aprovados: { antes: number; depois: number };
  receita: { antes_cent: number; depois_cent: number; diferenca_cent: number };
  por_regra: { id: string; passam_a_falhar: number; deixam_de_falhar: number }[];
  periodo: { de: string; ate: string } | null;
  pedidos_de_demonstracao: number;
  exemplos: Exemplo[];
  nota: string;
}

export function valorDito(c: CampoRegra, v: unknown): string {
  switch (c.tipo) {
    case "euros":
      return euros(v as number);
    case "lista_euros":
      return (v as number[]).map((x) => euros(x)).join(" · ");
    case "booleano":
      return v ? "sim" : "não";
    case "opcoes":
      return (v as string[]).map((x) => c.opcoes?.[x] ?? x).join(", ");
    case "inteiro":
    case "decimal":
      return `${c.tipo === "decimal" ? numero(v as number, 2).replace(/,00$/, "") : numero(v as number)}${c.unidade ? ` ${c.unidade}` : ""}`;
    default:
      return String(v);
  }
}

/** O cartão das regras de um tipo (à direita no painel). */
export function RegrasTipo({ info, onMudou }: { info: InfoTipo; onMudou: () => void }) {
  const { pode } = useSessao();
  const [editar, setEditar] = useState(false);
  const c = info.config;
  return (
    <Cartao className="flex h-fit flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-terracota" aria-hidden />
          <Rotulo>Regras em código · {info.nome.toLowerCase()}</Rotulo>
        </div>
        {pode("agente") && (
          <Botao tamanho="pequeno" variante="discreto" icone={Pencil} onClick={() => setEditar(true)}>
            Mudar
          </Botao>
        )}
      </div>
      <dl className="flex flex-col divide-y divide-linha text-sm">
        {info.campos.map((campo) => (
          <div key={campo.chave} className="flex justify-between gap-3 py-2">
            <dt className="text-tinta-2">{campo.rotulo}</dt>
            <dd className="text-right font-mono font-semibold text-tinta">{valorDito(campo, c[campo.chave])}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-tinta-2">Depois de pago</dt>
          <dd className="font-mono font-semibold text-tinta">
            {c.aprovacao === "automatica" ? "emite sozinha" : "um funcionário aprova"}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-tinta-3">Base: {c.fonte.titulo}.</p>
      {c.demonstracao && <Pilula tom="ambar">valores de demonstração · confirmar com o regulamento</Pilula>}
      <p className="text-xs text-tinta-3">
        Fora destas regras o pedido não é recusado: vai para um técnico, com o que falhou à vista. O agente usa a
        ferramenta <span className="font-mono">{info.ferramenta}</span>.
      </p>
      {pode("agente") && (
        <p className="text-xs text-tinta-3">
          Em &laquo;Mudar&raquo; pode testar a regra nova contra os pedidos antigos antes de a gravar.
        </p>
      )}
      <Dialogo
        titulo={`Regras · ${info.nome}`}
        aberto={editar}
        onFechar={() => setEditar(false)}
        largura="max-w-4xl"
      >
        <EditarRegras
          info={info}
          onGuardado={() => {
            setEditar(false);
            onMudou();
          }}
          onHistorico={onMudou}
        />
      </Dialogo>
    </Cartao>
  );
}

function EditarRegras({
  info,
  onGuardado,
  onHistorico,
}: {
  info: InfoTipo;
  onGuardado: () => void;
  onHistorico: () => void;
}) {
  const { pedido } = useSessao();
  const [c, setC] = useState<Config>(info.config);
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [carregados, setCarregados] = useState<number | null>(null);
  const acao = useAcao();
  const muda = (x: Partial<Config>) => {
    setC((a) => ({ ...a, ...x }));
    setSim(null);
  };
  const base = `/v1/painel/licencas`;

  const simular = async () => {
    const r = await acao.executar(() =>
      pedido<Simulacao>(`${base}/regras/${info.tipo}/simular`, { metodo: "POST", corpo: c }),
    );
    if (r) setSim(r);
  };
  const carregarDemo = async () => {
    const r = await acao.executar(() =>
      pedido<{ criados: number; ja_havia: number }>(`${base}/historico/${info.tipo}/demonstracao`, {
        metodo: "POST",
      }),
    );
    if (r) {
      setCarregados(r.criados || r.ja_havia);
      onHistorico();
      await simular();
    }
  };
  const gravar = async () => {
    const r = await acao.executar(() => pedido(`${base}/regras/${info.tipo}`, { metodo: "PUT", corpo: c }));
    if (r !== undefined) onGuardado();
  };
  const semHistorico = info.historico.pedidos === 0 && carregados === null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {info.campos.map((campo) => (
          <CampoEditavel key={campo.chave} campo={campo} valor={c[campo.chave]} onMudar={(v) => muda({ [campo.chave]: v })} />
        ))}
        <label className="flex items-center justify-between rounded-[12px] bg-creme px-4 py-3 sm:col-span-2">
          <span className="text-sm font-semibold text-tinta">Emitir sozinha depois de pago</span>
          <Interruptor
            ligado={c.aprovacao === "automatica"}
            onMudar={(v) => muda({ aprovacao: v ? "automatica" : "funcionario" })}
            rotulo="Emitir sozinha"
          />
        </label>
        <label className="flex items-center justify-between rounded-[12px] bg-creme px-4 py-3 sm:col-span-2">
          <span className="text-sm font-semibold text-tinta">Valores de demonstração (por confirmar)</span>
          <Interruptor ligado={c.demonstracao} onMudar={(v) => muda({ demonstracao: v })} rotulo="Demonstração" />
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-linha bg-creme/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-tinta">Testar antes de aprovar</span>
            <span className="text-xs text-tinta-3">
              Corre estas regras, sem gravar, contra os pedidos dos últimos anos
              {info.historico.pedidos + info.pedidos > 0
                ? ` (${numero(info.historico.pedidos + info.pedidos)} pedidos${
                    info.historico.demonstracao ? `, ${numero(info.historico.demonstracao)} de demonstração` : ""
                  })`
                : ""}
              .
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {semHistorico && (
              <Botao tamanho="pequeno" variante="secundario" icone={Database} disabled={acao.aCorrer} onClick={carregarDemo}>
                Carregar pedidos de demonstração
              </Botao>
            )}
            <Botao tamanho="pequeno" variante="secundario" icone={FlaskConical} disabled={acao.aCorrer} onClick={simular}>
              Simular
            </Botao>
          </div>
        </div>
        {carregados !== null && (
          <p className="text-xs text-tinta-3">{numero(carregados)} pedidos antigos de demonstração carregados (inventados).</p>
        )}
        {sim && <ResultadoSimulacao s={sim} />}
      </div>

      <ErroLinha erro={acao.erro} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {!sim && <span className="text-xs text-tinta-3">Simule primeiro para ver o que muda.</span>}
        <Botao icone={Save} disabled={acao.aCorrer || !sim} onClick={gravar}>
          Gravar regras
        </Botao>
      </div>
    </div>
  );
}

function CampoEditavel({
  campo,
  valor,
  onMudar,
}: {
  campo: CampoRegra;
  valor: unknown;
  onMudar: (v: unknown) => void;
}) {
  const rotulo = campo.unidade ? `${campo.rotulo} (${campo.unidade})` : campo.rotulo;
  switch (campo.tipo) {
    case "hora":
      return (
        <Campo rotulo={rotulo}>
          <input type="time" className={classeEntrada} value={valor as string} onChange={(e) => onMudar(e.target.value)} />
        </Campo>
      );
    case "inteiro":
    case "decimal":
    case "euros": {
      const fator = campo.tipo === "euros" ? 100 : 1;
      return (
        <Campo rotulo={campo.tipo === "euros" ? `${campo.rotulo} (€)` : rotulo}>
          <input
            type="number"
            min={0}
            step={campo.tipo === "inteiro" ? 1 : 0.01}
            className={classeEntrada}
            value={(valor as number) / fator}
            onChange={(e) => {
              const n = Number(e.target.value);
              onMudar(campo.tipo === "decimal" ? n : Math.round(n * fator));
            }}
          />
        </Campo>
      );
    }
    case "booleano":
      return (
        <label className="flex items-center justify-between gap-3 rounded-[12px] bg-creme px-4 py-3">
          <span className="text-sm font-semibold text-tinta">{campo.rotulo}</span>
          <Interruptor ligado={!!valor} onMudar={onMudar} rotulo={campo.rotulo} />
        </label>
      );
    case "opcoes": {
      const lista = valor as string[];
      return (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-2 text-[13px] font-semibold text-tinta">{campo.rotulo}</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(campo.opcoes ?? {}).map(([k, v]) => {
              const marcado = lista.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => onMudar(marcado ? lista.filter((x) => x !== k) : [...lista, k])}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
                    marcado ? "border-terracota bg-terracota-suave text-terracota-escuro" : "border-linha text-tinta-2"
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </fieldset>
      );
    }
    case "lista_euros": {
      const lista = valor as number[];
      return (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-2 text-[13px] font-semibold text-tinta">{campo.rotulo} (€)</legend>
          <div className="flex flex-wrap items-center gap-2">
            {lista.map((v, i) => (
              <label key={i} className="flex items-center gap-1.5 text-xs text-tinta-3">
                {i + 1}.º
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className={`${classeEntrada} w-24`}
                  value={v / 100}
                  onChange={(e) => onMudar(lista.map((x, j) => (j === i ? Math.round(Number(e.target.value) * 100) : x)))}
                />
              </label>
            ))}
            <Botao
              tamanho="pequeno"
              variante="discreto"
              icone={Plus}
              type="button"
              onClick={() => onMudar([...lista, lista[lista.length - 1] ?? 0])}
            >
              <span className="sr-only">Mais um</span>
            </Botao>
            {lista.length > 1 && (
              <Botao
                tamanho="pequeno"
                variante="discreto"
                icone={Minus}
                type="button"
                onClick={() => onMudar(lista.slice(0, -1))}
              >
                <span className="sr-only">Menos um</span>
              </Botao>
            )}
          </div>
        </fieldset>
      );
    }
  }
}

function ResultadoSimulacao({ s }: { s: Simulacao }) {
  if (s.total === 0) {
    return (
      <p className="text-sm text-tinta-2">
        Ainda não há pedidos antigos deste tipo para testar. Carregue os pedidos de demonstração para ver como funciona.
      </p>
    );
  }
  const dif = s.receita.diferenca_cent;
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
        <span>
          {numero(s.total)} pedidos
          {s.periodo ? ` de ${new Date(s.periodo.de).getFullYear()} a ${new Date(s.periodo.ate).getFullYear()}` : ""}
        </span>
        {s.pedidos_de_demonstracao > 0 && (
          <Pilula tom="ambar">{numero(s.pedidos_de_demonstracao)} pedidos de demonstração</Pilula>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Numero
          rotulo="Deixam de ser aprovados na hora"
          valor={numero(s.deixam_de_ser_aprovados)}
          sub="passam a ir a técnico"
          tom={s.deixam_de_ser_aprovados ? "terracota" : "neutro"}
          icone={ArrowDown}
        />
        <Numero
          rotulo="Passam a ser aprovados na hora"
          valor={numero(s.passam_a_ser_aprovados)}
          sub="já não precisam de técnico"
          tom={s.passam_a_ser_aprovados ? "verde" : "neutro"}
          icone={ArrowUp}
        />
        <Numero
          rotulo="Aprovados na hora"
          valor={`${numero(s.aprovados.antes)} → ${numero(s.aprovados.depois)}`}
          sub={`${numero(s.mudam_de_taxa)} pagam outra taxa`}
        />
        <Numero
          rotulo="Receita das taxas"
          valor={`${dif > 0 ? "+" : dif < 0 ? "−" : ""}${euros(Math.abs(dif))}`}
          sub={`${euros(s.receita.antes_cent)} → ${euros(s.receita.depois_cent)}`}
          tom={dif > 0 ? "verde" : dif < 0 ? "terracota" : "neutro"}
        />
      </div>
      {s.mudam === 0 ? (
        <p className="text-sm text-tinta-2">Com estas regras, nenhum pedido antigo teria outra resposta nem outra taxa.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Rotulo>Exemplos do que mudaria</Rotulo>
          <ul className="flex flex-col divide-y divide-linha rounded-[12px] border border-linha bg-papel">
            {s.exemplos.map((e) => (
              <li key={e.id} className="flex flex-col gap-1.5 px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-tinta">{e.referencia}</span>
                  <span className="text-tinta-3">{new Date(e.pedido_em).toLocaleDateString("pt-PT")}</span>
                  {e.demonstracao && <Pilula tom="neutro">demonstração</Pilula>}
                </div>
                <span className="text-tinta-2">{e.resumo}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Pilula tom={e.antes.aprovado ? "verde" : "ambar"}>
                    antes: {e.antes.decisao}
                    {e.antes.aprovado ? ` · ${euros(e.antes.taxa_cent)}` : ""}
                  </Pilula>
                  →
                  <Pilula tom={e.depois.aprovado ? "verde" : "ambar"}>
                    depois: {e.depois.decisao}
                    {e.depois.aprovado ? ` · ${euros(e.depois.taxa_cent)}` : ""}
                  </Pilula>
                </span>
                <ul className="list-disc pl-4 text-tinta-2">
                  {e.porque.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-tinta-3">{s.nota}</p>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  sub,
  tom = "neutro",
  icone: Icone,
}: {
  rotulo: string;
  valor: string;
  sub: string;
  tom?: "verde" | "terracota" | "neutro";
  icone?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const cor = tom === "verde" ? "text-verde" : tom === "terracota" ? "text-terracota" : "text-tinta";
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-linha bg-papel px-3 py-3">
      <span className="text-xs text-tinta-3">{rotulo}</span>
      <span className={`flex items-center gap-1 font-display text-xl font-bold ${cor}`}>
        {Icone && <Icone className="size-4" aria-hidden />}
        {valor}
      </span>
      <span className="text-xs text-tinta-3">{sub}</span>
    </div>
  );
}
