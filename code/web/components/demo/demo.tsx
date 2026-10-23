"use client";

import { CheckCircle2, EyeOff, MonitorPlay, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Cartao,
  ErroLinha,
  Estado,
  Pilula,
  Rotulo,
  SemAcesso,
  numero,
  quando,
  useAcao,
  useDados,
  useEquipaInterna,
} from "@/components/conhecimento/comum";
import { Aviso, CabecalhoPagina } from "@/components/painel/cabecalho";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";

/*
 * Painel · Preparar demo: cria a câmara de demonstração (conversas, processos,
 * ocorrências, licenças, o que se passa perto de mim...) com um botão. Primeiro
 * um ensaio com o resumo, depois confirmar. "Esconder os testes" tira do painel
 * as conversas e ocorrências dos testes da equipa, sem apagar: "Repor" volta a
 * mostrá-las.
 */

interface PassoPlano {
  passo: string;
  rotulo: string;
  total: number;
  ja_existem: number;
  a_criar: number;
  /** Numa câmara com fontes próprias, o conhecimento e as avaliações ficam como estão. */
  salta?: boolean;
}

interface Contas {
  conversas: number;
  passagens?: number;
  ocorrencias: number;
}

interface EstadoDemo {
  ativa: boolean;
  motivo?: string;
  municipio?: { slug: string; nome: string };
  preparada?: boolean;
  preparada_em?: string | null;
  preparada_por?: string | null;
  vezes?: number;
  total_registos?: number;
  passos?: PassoPlano[];
  ocultos?: Contas;
}

interface Ensaio {
  ensaio: true;
  /** false: a câmara tem fontes próprias e a demo não lhes toca. */
  conhecimento?: boolean;
  passos: PassoPlano[];
  a_criar: number;
  ja_existem: number;
  ocultar: Contas | null;
}

interface Resultado {
  ensaio: false;
  criados: Record<string, number>;
  total_registos: number;
  ocultados: Contas | null;
  avisos: string[];
}

const NOMES: Record<string, string> = {
  municipes: "munícipes",
  conversas: "conversas",
  passagens: "passagens a funcionário",
  zonas_pdm: "zonas do PDM",
  processos: "processos",
  pagamentos: "pagamentos",
  ocorrencias: "ocorrências",
  licencas: "licenças",
  avisos: "avisos por zona",
  eventos: "eventos",
  comunicados: "comunicados",
  consultas: "consultas públicas",
  linguagem_simples: "documentos em linguagem simples",
  glossario: "glossário",
  marcacoes: "marcações",
  reclamacoes: "reclamações",
};

function textoContas(c: Contas): string {
  const p = [`${numero(c.conversas)} conversas`];
  if (c.passagens !== undefined) p.push(`${numero(c.passagens)} passagens a funcionário`);
  p.push(`${numero(c.ocorrencias)} ocorrências`);
  return p.join(", ");
}

export function PaginaDemo() {
  const { pode, pedido } = useSessao();
  const interno = useEquipaInterna();
  const estado = useDados<EstadoDemo>(pode("demo") ? "/v1/painel/demo/estado" : null);
  const acao = useAcao();
  const [limpar, setLimpar] = useState(true);
  const [ensaio, setEnsaio] = useState<Ensaio | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [repostos, setRepostos] = useState<Contas | null>(null);
  const [confirmarRepor, setConfirmarRepor] = useState(false);

  if (!pode("demo")) {
    return (
      <div className="flex flex-col pb-12">
        <CabecalhoPagina migalhas={["Configuração", "Demonstração"]} titulo="Demonstração" />
        <SemAcesso texto="Só a chefia e a administração preparam a demonstração." />
      </div>
    );
  }

  const e = estado.dados;

  const verEnsaio = async () => {
    setResultado(null);
    const r = await acao.executar(() =>
      pedido<Ensaio>("/v1/painel/demo/preparar", { corpo: { limpar_testes: limpar } }),
    );
    if (r) setEnsaio(r);
  };
  const confirmar = async () => {
    const r = await acao.executar(() =>
      pedido<Resultado>("/v1/painel/demo/preparar", {
        corpo: { limpar_testes: limpar, confirmar: true },
      }),
    );
    if (r) {
      setResultado(r);
      setEnsaio(null);
      estado.recarregar();
    }
  };
  const repor = async () => {
    const r = await acao.executar(() =>
      pedido<{ repostos: Contas }>("/v1/painel/demo/repor-ocultos", { metodo: "POST" }),
    );
    if (r) {
      setRepostos(r.repostos);
      setConfirmarRepor(false);
      estado.recarregar();
    }
  };

  return (
    <div className="flex flex-col pb-12">
      <CabecalhoPagina
        migalhas={["Configuração", "Demonstração"]}
        titulo="Demonstração"
        descricao="Deixa a câmara pronta para mostrar: conversas dos últimos 30 dias, processos, ocorrências, licenças e o que se passa perto de mim, com datas a contar de hoje. Correr outra vez não duplica nada."
        acoes={<Pilula tom="ambar">dados de demonstração</Pilula>}
      />
      <Estado aCarregar={estado.aCarregar} erro={estado.erro} vazio={!e}>
        {e && !e.ativa ? (
          <Aviso titulo="A preparação da demonstração está desligada neste servidor.">
            {e.motivo}
          </Aviso>
        ) : (
          e && (
            <div className="grid gap-6 px-4 sm:px-10 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex flex-col gap-6">
                <Cartao className="flex flex-col gap-4 p-6">
                  <div className="flex items-center gap-2">
                    <MonitorPlay className="size-5 text-terracota" aria-hidden />
                    <h2 className="font-display text-lg font-bold text-tinta">Preparar demo</h2>
                  </div>
                  <label className="flex items-start gap-3 text-sm text-tinta-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-terracota"
                      checked={limpar}
                      onChange={(ev) => {
                        setLimpar(ev.target.checked);
                        setEnsaio(null);
                      }}
                    />
                    <span>
                      <span className="font-semibold text-tinta">Esconder as conversas de teste</span>
                      <br />
                      As conversas, passagens e ocorrências criadas até agora que não são da demonstração
                      saem do painel e dos indicadores. Não se apaga nada: pode repor a qualquer momento.
                    </span>
                  </label>
                  <ErroLinha erro={acao.erro} />
                  {!ensaio && (
                    <div>
                      <Botao onClick={verEnsaio} disabled={acao.aCorrer}>
                        {acao.aCorrer ? "A ver…" : "Preparar a demonstração"}
                      </Botao>
                    </div>
                  )}
                  {ensaio && (
                    <div className="flex flex-col gap-4 rounded-xl border border-linha bg-creme p-4">
                      <Rotulo>Ensaio · nada foi alterado</Rotulo>
                      {ensaio.conhecimento === false && (
                        <p className="rounded-lg bg-verde-suave px-3 py-2 text-sm text-tinta">
                          Esta câmara já tem fontes próprias: as fontes, as respostas e os testes de qualidade ficam
                          como estão. Junta-se o resto (pessoas, pedidos, ocorrências, contactos, serviços).
                        </p>
                      )}
                      <ul className="flex flex-col gap-1.5 text-sm text-tinta-2">
                        {ensaio.passos.map((p) => (
                          <li key={p.passo} className="flex items-start justify-between gap-4">
                            <span className={p.salta ? "text-tinta-3 line-through" : ""}>{p.rotulo}</span>
                            <span className="shrink-0 font-semibold text-tinta">
                              {p.salta ? "não mexe" : p.a_criar ? `criar ${p.a_criar}` : "já existe"}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {ensaio.ocultar && (
                        <p className="flex items-start gap-2 text-sm text-tinta-2">
                          <EyeOff className="mt-0.5 size-4 shrink-0 text-tinta-3" aria-hidden />
                          <span>
                            Vai esconder do painel: <strong>{textoContas(ensaio.ocultar)}</strong>.
                          </span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Botao onClick={confirmar} disabled={acao.aCorrer}>
                          {acao.aCorrer ? "A preparar… (pode demorar um minuto)" : "Confirmar e preparar"}
                        </Botao>
                        <Botao variante="discreto" onClick={() => setEnsaio(null)} disabled={acao.aCorrer}>
                          Cancelar
                        </Botao>
                      </div>
                    </div>
                  )}
                  {resultado && (
                    <div className="flex flex-col gap-3 rounded-xl border border-verde/30 bg-verde-suave/40 p-4 text-sm text-tinta-2">
                      <p className="flex items-center gap-2 font-semibold text-tinta">
                        <CheckCircle2 className="size-4 text-verde" aria-hidden />
                        Demonstração pronta.
                      </p>
                      <p>
                        {Object.keys(resultado.criados).length
                          ? `Criado agora: ${Object.entries(resultado.criados)
                              .map(([k, n]) => `${n} ${NOMES[k] ?? k}`)
                              .join(", ")}.`
                          : "Já estava tudo criado: nada foi duplicado."}
                      </p>
                      {resultado.ocultados && <p>Escondido do painel: {textoContas(resultado.ocultados)}.</p>}
                      {resultado.avisos.length > 0 && (
                        <ul className="flex flex-col gap-1">
                          {resultado.avisos.map((a) => (
                            <li key={a} className="flex items-start gap-2 text-ambar">
                              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="flex flex-wrap gap-x-4 gap-y-1">
                        <Link className="font-semibold text-terracota underline" href="/painel">Visão geral</Link>
                        <Link className="font-semibold text-terracota underline" href="/painel/conversas">Conversas</Link>
                        <Link className="font-semibold text-terracota underline" href="/painel/ocorrencias">Ocorrências</Link>
                        <Link className="font-semibold text-terracota underline" href="/painel/licencas">Licenças</Link>
                        <Link className="font-semibold text-terracota underline" href="/painel/processos">Processos</Link>
                        {e.municipio && (
                          <Link className="font-semibold text-terracota underline" href={`/agora/${e.municipio.slug}`}>
                            Perto de mim
                          </Link>
                        )}
                      </p>
                    </div>
                  )}
                </Cartao>

                <Cartao className="flex flex-col gap-3 p-6">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="size-5 text-tinta-2" aria-hidden />
                    <h2 className="font-display text-lg font-bold text-tinta">Repor o que foi escondido</h2>
                  </div>
                  <p className="text-sm text-tinta-2">
                    Escondido agora: {e.ocultos ? textoContas(e.ocultos) : "nada"}. Repor volta a mostrar tudo no
                    painel e nos indicadores.
                  </p>
                  {repostos && <p className="text-sm text-verde">Reposto: {textoContas(repostos)}.</p>}
                  <div className="flex flex-wrap gap-2">
                    {confirmarRepor ? (
                      <>
                        <Botao variante="secundario" onClick={repor} disabled={acao.aCorrer}>
                          Sim, repor
                        </Botao>
                        <Botao variante="discreto" onClick={() => setConfirmarRepor(false)}>
                          Cancelar
                        </Botao>
                      </>
                    ) : (
                      <Botao
                        variante="secundario"
                        onClick={() => setConfirmarRepor(true)}
                        disabled={!e.ocultos || (e.ocultos.conversas === 0 && e.ocultos.ocorrencias === 0)}
                      >
                        Repor
                      </Botao>
                    )}
                  </div>
                </Cartao>
              </div>

              <Cartao className="flex h-fit flex-col gap-4 p-6">
                <Rotulo>Estado</Rotulo>
                {e.preparada ? (
                  <p className="text-sm text-tinta-2">
                    Preparada {quando(e.preparada_em)}
                    {e.preparada_por ? ` por ${e.preparada_por}` : ""}
                    {e.vezes && e.vezes > 1 ? ` (${e.vezes} vezes)` : ""}. {numero(e.total_registos)} registos de
                    demonstração.
                  </p>
                ) : (
                  <p className="text-sm text-tinta-2">Ainda não foi preparada neste município.</p>
                )}
                <ul className="flex flex-col gap-2 text-[13px]">
                  {(e.passos ?? []).map((p) => (
                    <li key={p.passo} className="flex items-start justify-between gap-3">
                      <span className="text-tinta-2">{p.rotulo}</span>
                      <Pilula tom={p.a_criar === 0 ? "verde" : p.ja_existem ? "ambar" : "neutro"}>
                        {p.ja_existem}/{p.total}
                      </Pilula>
                    </li>
                  ))}
                </ul>
                {interno && (
                  <p className="text-xs text-tinta-3">
                    Também na linha de comandos: <code>npm run demo:preparar -- --limpar --confirmar</code>
                  </p>
                )}
              </Cartao>
            </div>
          )
        )}
      </Estado>
    </div>
  );
}
