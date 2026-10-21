"use client";

import { ArrowDown, ArrowUp, Database, FlaskConical, Plus, Repeat, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  classeEntrada,
  ErroLinha,
  Interruptor,
  numero,
  Pilula,
  Rotulo,
  useAcao,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import { CONTROLO, type Controlo, type Degrau, type RegraObra, type Zona } from "./tipos";

/*
 * O editor das regras de uma zona do PDM, com "Simular": para cada obra os
 * degraus (o primeiro cujos limites a obra cumpre decide o controlo) e o
 * controlo acima deles. Antes de gravar, a câmara vê o que as regras novas
 * fariam às perguntas que as pessoas já fizeram nesta zona.
 */

interface Exemplo {
  id: string;
  referencia: string;
  pedido_em: string;
  resumo: string;
  demonstracao: boolean;
  antes: { decisao: string; aprovado: boolean };
  depois: { decisao: string; aprovado: boolean };
  porque: string[];
}

interface Simulacao {
  total: number;
  mudam: number;
  deixam_de_ser_aprovados: number;
  passam_a_ser_aprovados: number;
  aprovados: { antes: number; depois: number };
  por_regra: { id: string; passam_a_falhar: number; deixam_de_falhar: number }[];
  periodo: { de: string; ate: string } | null;
  pedidos_de_demonstracao: number;
  exemplos: Exemplo[];
  nota: string;
}

/** Abaixo disto a simulação diz pouco: oferece as perguntas de demonstração. */
const POUCAS_PERGUNTAS = 10;

const CONTROLOS = Object.keys(CONTROLO) as Controlo[];

/** "anexo, telheiro ou arrumos" → "Anexo" (para os rótulos curtos). */
export function obraCurta(texto: string): string {
  return texto.split(" (")[0].split(",")[0];
}

export function EditarRegrasZona({
  zona,
  obras,
  onGuardado,
  onPerguntas,
}: {
  zona: Zona;
  obras: Record<string, string>;
  onGuardado: () => void;
  onPerguntas: () => void;
}) {
  const { pedido } = useSessao();
  const [regras, setRegras] = useState<Record<string, RegraObra | undefined>>(zona.regras);
  const [dados, setDados] = useState({
    nome: zona.nome,
    descricao: zona.descricao ?? "",
    titulo: zona.fonte.titulo,
    artigo: zona.fonte.artigo ?? "",
    url: zona.fonte.url ?? "",
    demonstracao: zona.demonstracao,
  });
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [carregadas, setCarregadas] = useState<number | null>(null);
  const acao = useAcao();
  const base = `/v1/painel/ordenamento`;

  const mudaObra = (obra: string, r: RegraObra | undefined) => {
    setRegras((a) => ({ ...a, [obra]: r }));
    setSim(null);
  };
  const mudaDados = (x: Partial<typeof dados>) => setDados((a) => ({ ...a, ...x }));
  const definidas = (): Record<string, RegraObra> =>
    Object.fromEntries(
      Object.entries(regras).flatMap(([k, r]) =>
        r ? [[k, { ...r, notas: r.notas.map((x) => x.trim()).filter(Boolean) }]] : [],
      ),
    );

  const simular = async () => {
    const r = await acao.executar(() =>
      pedido<Simulacao>(`${base}/zonas/${zona.id}/simular`, { metodo: "POST", corpo: { regras: definidas() } }),
    );
    if (r) setSim(r);
  };
  const carregarDemo = async () => {
    const r = await acao.executar(() =>
      pedido<{ criadas: number; ja_havia: number }>(`${base}/consultas/demonstracao`, { metodo: "POST" }),
    );
    if (r) {
      setCarregadas(r.criadas || r.ja_havia);
      onPerguntas();
      await simular();
    }
  };
  const gravar = async () => {
    const r = await acao.executar(() =>
      pedido(`${base}/zonas/${zona.id}/regras`, {
        metodo: "PUT",
        corpo: {
          regras: definidas(),
          nome: dados.nome.trim(),
          descricao: dados.descricao.trim() || null,
          fonte: {
            titulo: dados.titulo.trim(),
            artigo: dados.artigo.trim() || null,
            url: dados.url.trim() || null,
          },
          demonstracao: dados.demonstracao,
        },
      }),
    );
    if (r !== undefined) onGuardado();
  };
  const poucas = zona.perguntas.total < POUCAS_PERGUNTAS && zona.perguntas.demonstracao === 0 && carregadas === null;

  return (
    <div className="flex flex-col gap-5">
      {zona.demonstracao && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-ambar-suave px-4 py-3 text-[13px] text-tinta-2">
          <Pilula tom="ambar">valores de demonstração</Pilula>
          <span>
            Estas regras são de exemplo, não as do PDM em vigor. Confirme cada valor com o regulamento antes de as
            usar a sério.
          </span>
        </div>
      )}

      <details className="rounded-[12px] border border-linha px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-tinta">Dados da zona e fonte</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome">
            <input className={classeEntrada} value={dados.nome} onChange={(e) => mudaDados({ nome: e.target.value })} />
          </Campo>
          <Campo rotulo="Fonte (regulamento)">
            <input
              className={classeEntrada}
              value={dados.titulo}
              onChange={(e) => mudaDados({ titulo: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Descrição" className="sm:col-span-2">
            <textarea
              rows={2}
              className={classeEntrada}
              value={dados.descricao}
              onChange={(e) => mudaDados({ descricao: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Artigo">
            <input
              className={classeEntrada}
              placeholder="ex.: art. 20.º"
              value={dados.artigo}
              onChange={(e) => mudaDados({ artigo: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Ligação para o regulamento">
            <input
              className={classeEntrada}
              placeholder="https://"
              value={dados.url}
              onChange={(e) => mudaDados({ url: e.target.value })}
            />
          </Campo>
          <label className="flex items-center justify-between rounded-[12px] bg-creme px-4 py-3 sm:col-span-2">
            <span className="text-sm font-semibold text-tinta">Valores de demonstração (por confirmar)</span>
            <Interruptor
              ligado={dados.demonstracao}
              onMudar={(v) => mudaDados({ demonstracao: v })}
              rotulo="Demonstração"
            />
          </label>
        </div>
      </details>

      <p className="text-xs text-tinta-3">
        Para cada obra, o primeiro degrau cujos limites a obra cumpre decide o que é preciso; acima de todos vale o
        controlo de baixo. Um limite em branco não conta.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {Object.entries(obras).map(([k, v]) => (
          <EditorObra key={k} obra={v} regra={regras[k]} onMudar={(r) => mudaObra(k, r)} />
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-linha bg-creme/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-tinta">Testar antes de aprovar</span>
            <span className="text-xs text-tinta-3">
              Corre estas regras, sem gravar, contra as perguntas feitas ao agente nesta zona nos últimos 5 anos
              {zona.perguntas.total > 0
                ? ` (${numero(zona.perguntas.total)} perguntas${
                    zona.perguntas.demonstracao ? `, ${numero(zona.perguntas.demonstracao)} de demonstração` : ""
                  })`
                : ""}
              .
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {poucas && (
              <Botao tamanho="pequeno" variante="secundario" icone={Database} disabled={acao.aCorrer} onClick={carregarDemo}>
                Carregar perguntas de demonstração
              </Botao>
            )}
            <Botao tamanho="pequeno" variante="secundario" icone={FlaskConical} disabled={acao.aCorrer} onClick={simular}>
              Simular
            </Botao>
          </div>
        </div>
        {carregadas !== null && (
          <p className="text-xs text-tinta-3">
            {numero(carregadas)} perguntas de demonstração carregadas (inventadas), espalhadas pelas quatro zonas.
          </p>
        )}
        {sim && <ResultadoSimulacao s={sim} obras={obras} />}
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

function SelecaoControlo({
  valor,
  onMudar,
  rotulo,
}: {
  valor: Controlo;
  onMudar: (c: Controlo) => void;
  rotulo: string;
}) {
  return (
    <select
      aria-label={rotulo}
      className={`${classeEntrada} py-2`}
      value={valor}
      onChange={(e) => onMudar(e.target.value as Controlo)}
    >
      {CONTROLOS.map((c) => (
        <option key={c} value={c}>
          {CONTROLO[c].rotulo}
        </option>
      ))}
    </select>
  );
}

function Medida({
  valor,
  onMudar,
  rotulo,
  unidade,
}: {
  valor: number | undefined;
  onMudar: (v: number | undefined) => void;
  rotulo: string;
  unidade: string;
}) {
  // O texto à parte do número: "2," ou "2." a meio de escrever não se perde.
  const [texto, setTexto] = useState(valor === undefined ? "" : String(valor).replace(".", ","));
  return (
    <label className="flex items-center gap-1.5 text-xs text-tinta-3">
      <input
        type="text"
        inputMode="decimal"
        placeholder="—"
        aria-label={rotulo}
        className="w-16 rounded-[10px] border border-linha bg-papel px-2 py-2 text-sm text-tinta outline-none placeholder:text-tinta-3 focus:border-terracota"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          const n = Number(e.target.value.trim().replace(",", "."));
          onMudar(e.target.value.trim() === "" || !(n > 0) ? undefined : n);
        }}
      />
      {unidade}
    </label>
  );
}

function EditorObra({
  obra,
  regra,
  onMudar,
}: {
  obra: string;
  regra: RegraObra | undefined;
  onMudar: (r: RegraObra | undefined) => void;
}) {
  const curta = obraCurta(obra);
  const muda = (x: Partial<RegraObra>) => regra && onMudar({ ...regra, ...x });
  const mudaDegrau = (i: number, x: Partial<Degrau>) =>
    regra &&
    muda({
      degraus: regra.degraus.map((d, j) => {
        if (j !== i) return d;
        const n = { ...d, ...x };
        // Sem limite, o campo sai (a API não aceita zero).
        if (n.area_max_m2 === undefined) delete n.area_max_m2;
        if (n.altura_max_m === undefined) delete n.altura_max_m;
        return n;
      }),
    });

  return (
    <fieldset className="flex flex-col gap-3 rounded-[12px] bg-creme px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold text-tinta" title={obra}>
          {obra}
        </legend>
        <Interruptor
          ligado={!!regra}
          rotulo={`Há regra para ${curta}`}
          onMudar={(v) => onMudar(v ? { degraus: [], acima: "licenca", notas: [] } : undefined)}
        />
      </div>
      {!regra ? (
        <p className="text-xs text-tinta-3">Sem regra: o agente diz que um técnico tem de ver o caso.</p>
      ) : (
        <>
          {regra.degraus.length > 0 && (
            <ol className="flex flex-col gap-2">
              {regra.degraus.map((d, i) => (
                // Ao tirar um degrau, os campos voltam a ler os valores (o texto é local).
                <li
                  key={`${i}-${regra.degraus.length}`}
                  className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto_auto_auto]"
                >
                  <span className="text-xs font-semibold text-tinta-3">{i + 1}.º</span>
                  <div className="min-w-[180px] flex-1 sm:min-w-0">
                    <SelecaoControlo
                      valor={d.controlo}
                      rotulo={`${curta}: controlo do ${i + 1}.º degrau`}
                      onMudar={(c) => mudaDegrau(i, { controlo: c })}
                    />
                  </div>
                  <span className="text-xs text-tinta-3">até</span>
                  <Medida
                    valor={d.area_max_m2}
                    unidade="m²"
                    rotulo={`${curta}: área máxima do ${i + 1}.º degrau, em m²`}
                    onMudar={(v) => mudaDegrau(i, { area_max_m2: v })}
                  />
                  <Medida
                    valor={d.altura_max_m}
                    unidade="m"
                    rotulo={`${curta}: altura máxima do ${i + 1}.º degrau, em metros`}
                    onMudar={(v) => mudaDegrau(i, { altura_max_m: v })}
                  />
                  <Botao
                    tamanho="pequeno"
                    variante="discreto"
                    icone={Trash2}
                    onClick={() => muda({ degraus: regra.degraus.filter((_, j) => j !== i) })}
                  >
                    <span className="sr-only">Tirar o {i + 1}.º degrau</span>
                  </Botao>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-tinta-2">
              {regra.degraus.length ? "Acima destes limites" : "Sempre"}
            </span>
            <div className="min-w-[150px] flex-1">
              <SelecaoControlo
                valor={regra.acima}
                rotulo={`${curta}: controlo acima dos limites`}
                onMudar={(c) => muda({ acima: c })}
              />
            </div>
            {regra.degraus.length < 5 && (
              <Botao
                tamanho="pequeno"
                variante="discreto"
                icone={Plus}
                onClick={() =>
                  muda({
                    degraus: [...regra.degraus, { controlo: regra.degraus.length ? "comunicacao_previa" : "isento" }],
                  })
                }
              >
                Degrau
              </Botao>
            )}
          </div>
          {regra.degraus.some((d) => !d.area_max_m2 && !d.altura_max_m) && (
            <p className="text-xs text-ambar">
              Um degrau sem limites apanha todas as obras: os degraus de baixo e o &laquo;acima&raquo; nunca contam.
            </p>
          )}
          <Campo rotulo="Notas (uma por linha)">
            <textarea
              rows={2}
              className={`${classeEntrada} bg-papel`}
              value={regra.notas.join("\n")}
              onChange={(e) => muda({ notas: e.target.value.split("\n") })}
            />
          </Campo>
        </>
      )}
    </fieldset>
  );
}

function ResultadoSimulacao({ s, obras }: { s: Simulacao; obras: Record<string, string> }) {
  if (s.total === 0) {
    return (
      <p className="text-sm text-tinta-2">
        Ainda ninguém perguntou ao agente sobre obras nesta zona. Carregue as perguntas de demonstração para ver como
        funciona.
      </p>
    );
  }
  const porObra = s.por_regra.filter((r) => r.passam_a_falhar || r.deixam_de_falhar);
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
        <span>
          {numero(s.total)} perguntas
          {s.periodo ? ` de ${new Date(s.periodo.de).getFullYear()} a ${new Date(s.periodo.ate).getFullYear()}` : ""}
        </span>
        {s.pedidos_de_demonstracao > 0 && (
          <Pilula tom="ambar">{numero(s.pedidos_de_demonstracao)} perguntas de demonstração</Pilula>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Numero
          rotulo="Mudam de resposta"
          valor={numero(s.mudam)}
          sub={`de ${numero(s.total)} perguntas`}
          icone={Repeat}
        />
        <Numero
          rotulo="Passam a precisar de licença"
          valor={numero(s.deixam_de_ser_aprovados)}
          sub="ou deixam de ser permitidas"
          tom={s.deixam_de_ser_aprovados ? "terracota" : "neutro"}
          icone={ArrowDown}
        />
        <Numero
          rotulo="Deixam de precisar de licença"
          valor={numero(s.passam_a_ser_aprovados)}
          sub="isentas ou comunicação prévia"
          tom={s.passam_a_ser_aprovados ? "verde" : "neutro"}
          icone={ArrowUp}
        />
        <Numero
          rotulo="Resolvem-se sem licença"
          valor={`${numero(s.aprovados.antes)} → ${numero(s.aprovados.depois)}`}
          sub="isento ou comunicação prévia"
        />
      </div>
      {porObra.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {porObra.map((r) => (
            <li key={r.id} className="rounded-full border border-linha bg-papel px-3 py-1 text-tinta-2">
              <span className="font-semibold text-tinta">{obraCurta(obras[r.id] ?? r.id)}</span>
              {r.passam_a_falhar ? ` · ${numero(r.passam_a_falhar)} passam a precisar de licença` : ""}
              {r.deixam_de_falhar ? ` · ${numero(r.deixam_de_falhar)} deixam de precisar` : ""}
            </li>
          ))}
        </ul>
      )}
      {s.mudam === 0 ? (
        <p className="text-sm text-tinta-2">Com estas regras, nenhuma pergunta antiga teria outra resposta.</p>
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
                  <Pilula tom={e.antes.aprovado ? "verde" : "ambar"}>antes: {e.antes.decisao}</Pilula>→
                  <Pilula tom={e.depois.aprovado ? "verde" : "terracota"}>depois: {e.depois.decisao}</Pilula>
                </span>
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
