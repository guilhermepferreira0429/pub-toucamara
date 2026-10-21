"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  Campo,
  classeEntrada,
  ErroLinha,
  Interruptor,
  useAcao,
} from "@/components/conhecimento/comum";
import { Botao } from "@/components/ui/botao";
import { useSessao } from "@/lib/sessao";
import type { DetalheConsulta } from "./tipos";

/*
 * Criar ou mudar uma consulta pública: o que está em causa em linguagem
 * simples, as perguntas de escolha, a pergunta aberta, as freguesias e o
 * prazo. Com participações, as perguntas ficam fechadas (os resultados não
 * se misturam).
 */

const OPCOES_SUGERIDAS = ["Concordo", "Não concordo", "Tenho dúvidas"];

interface PerguntaForm {
  texto: string;
  opcoes: string[];
}

function hoje(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function somar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function FormularioConsulta({
  consulta,
  freguesiasConhecidas,
  onGuardada,
  onCancelar,
}: {
  consulta?: DetalheConsulta;
  freguesiasConhecidas: string[];
  onGuardada: (id: string) => void;
  onCancelar: () => void;
}) {
  const { pedido } = useSessao();
  const acao = useAcao();
  const perguntasFechadas = !!consulta && consulta.participacoes > 0;

  const [titulo, setTitulo] = useState(consulta?.titulo ?? "");
  const [resumo, setResumo] = useState(consulta?.resumo ?? "");
  const [docTitulo, setDocTitulo] = useState(consulta?.documento_titulo ?? "");
  const [docUrl, setDocUrl] = useState(consulta?.documento_url ?? "");
  const [perguntas, setPerguntas] = useState<PerguntaForm[]>(
    consulta?.perguntas.map((p) => ({ texto: p.texto, opcoes: p.opcoes.map((o) => o.texto) })) ?? [
      { texto: "", opcoes: [...OPCOES_SUGERIDAS] },
    ],
  );
  const [comAberta, setComAberta] = useState(consulta ? !!consulta.pergunta_aberta : true);
  const [aberta, setAberta] = useState(
    consulta?.pergunta_aberta ?? "Quer deixar uma opinião ou uma sugestão?",
  );
  const [concelho, setConcelho] = useState(consulta ? !consulta.freguesias?.length : true);
  const [freguesias, setFreguesias] = useState<string[]>(consulta?.freguesias ?? []);
  const [novaFreguesia, setNovaFreguesia] = useState("");
  const [abre, setAbre] = useState(consulta?.abre_em ?? hoje());
  const [fecha, setFecha] = useState(consulta?.fecha_em ?? somar(hoje(), 30));
  const [relatorio, setRelatorio] = useState(consulta?.relatorio_em ?? "");

  const mudarPergunta = (i: number, p: Partial<PerguntaForm>) =>
    setPerguntas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const juntarFreguesia = () => {
    const f = novaFreguesia.trim();
    if (f && !freguesias.includes(f)) setFreguesias([...freguesias, f]);
    setNovaFreguesia("");
  };

  const guardar = async () => {
    const corpo: Record<string, unknown> = {
      titulo,
      resumo,
      documento_titulo: docTitulo.trim() || null,
      documento_url: docUrl.trim() || null,
      pergunta_aberta: comAberta && aberta.trim() ? aberta.trim() : null,
      freguesias: concelho ? null : freguesias,
      abre_em: abre,
      fecha_em: fecha,
      relatorio_em: relatorio || null,
    };
    if (!perguntasFechadas) {
      corpo.perguntas = perguntas.map((p) => ({
        texto: p.texto,
        opcoes: p.opcoes.map((o) => o.trim()).filter(Boolean),
      }));
    }
    const r = await acao.executar(() =>
      consulta
        ? pedido<{ id: string }>(`/v1/painel/consultas/${consulta.id}`, {
            metodo: "PATCH",
            corpo,
          })
        : pedido<{ id: string }>("/v1/painel/consultas", { metodo: "POST", corpo }),
    );
    if (r) onGuardada(r.id);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void guardar();
      }}
    >
      <Campo rotulo="Título">
        <input
          className={classeEntrada}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ciclovia na Avenida D. Afonso Henriques"
          maxLength={140}
          required
        />
      </Campo>
      <Campo
        rotulo="O que está em causa"
        ajuda="Em linguagem simples: é isto que o agente explica ao telefone. O que muda, onde, quando e o que custa."
      >
        <textarea
          className={`${classeEntrada} min-h-28`}
          value={resumo}
          onChange={(e) => setResumo(e.target.value)}
          maxLength={2000}
          required
        />
      </Campo>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo rotulo="Documento em consulta (opcional)">
          <input
            className={classeEntrada}
            value={docTitulo}
            onChange={(e) => setDocTitulo(e.target.value)}
            placeholder="Estudo prévio"
          />
        </Campo>
        <Campo rotulo="Link do documento">
          <input
            className={classeEntrada}
            type="url"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="https://…"
          />
        </Campo>
      </div>

      <fieldset className="flex flex-col gap-3" disabled={perguntasFechadas}>
        <legend className="text-[13px] font-semibold text-tinta">
          Perguntas de escolha {perguntasFechadas && "(já há participações: não mudam)"}
        </legend>
        {perguntas.map((p, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-linha p-3">
            <div className="flex gap-2">
              <input
                className={classeEntrada}
                value={p.texto}
                onChange={(e) => mudarPergunta(i, { texto: e.target.value })}
                placeholder="Concorda com a ciclovia?"
                aria-label={`Pergunta ${i + 1}`}
                maxLength={200}
                required
              />
              {perguntas.length > 1 && (
                <button
                  type="button"
                  className="rounded-lg px-2 text-tinta-3 hover:text-terracota"
                  aria-label={`Tirar a pergunta ${i + 1}`}
                  onClick={() => setPerguntas((l) => l.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {p.opcoes.map((o, k) => (
                <span key={k} className="flex items-center gap-1 rounded-full border border-linha bg-creme pl-3 pr-1">
                  <input
                    className="w-32 bg-transparent py-1 text-sm outline-none"
                    value={o}
                    aria-label={`Opção ${k + 1} da pergunta ${i + 1}`}
                    onChange={(e) =>
                      mudarPergunta(i, {
                        opcoes: p.opcoes.map((x, j) => (j === k ? e.target.value : x)),
                      })
                    }
                  />
                  {p.opcoes.length > 2 && (
                    <button
                      type="button"
                      aria-label="Tirar opção"
                      className="rounded-full p-1 text-tinta-3 hover:text-terracota"
                      onClick={() => mudarPergunta(i, { opcoes: p.opcoes.filter((_, j) => j !== k) })}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {p.opcoes.length < 6 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full px-2 text-[13px] font-semibold text-tinta-2 hover:text-tinta"
                  onClick={() => mudarPergunta(i, { opcoes: [...p.opcoes, ""] })}
                >
                  <Plus className="size-3.5" /> opção
                </button>
              )}
            </div>
          </div>
        ))}
        {perguntas.length < 3 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-tinta-2 hover:text-tinta"
            onClick={() => setPerguntas((l) => [...l, { texto: "", opcoes: [...OPCOES_SUGERIDAS] }])}
          >
            <Plus className="size-4" /> Outra pergunta (no máximo 3: ao telefone, menos é mais)
          </button>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Interruptor ligado={comAberta} onMudar={setComAberta} rotulo="Pergunta aberta" />
          <span className="text-[13px] font-semibold text-tinta">Pergunta aberta (opinião livre)</span>
        </div>
        {comAberta && (
          <input
            className={classeEntrada}
            value={aberta}
            onChange={(e) => setAberta(e.target.value)}
            maxLength={200}
            aria-label="Pergunta aberta"
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Interruptor ligado={concelho} onMudar={setConcelho} rotulo="Todo o concelho" />
          <span className="text-[13px] font-semibold text-tinta">Todo o concelho</span>
        </div>
        {!concelho && (
          <>
            <div className="flex flex-wrap gap-2">
              {freguesias.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 rounded-full bg-creme-2 py-1 pl-3 pr-1 text-[13px] text-tinta">
                  {f}
                  <button
                    type="button"
                    aria-label={`Tirar ${f}`}
                    className="rounded-full p-1 text-tinta-3 hover:text-terracota"
                    onClick={() => setFreguesias(freguesias.filter((x) => x !== f))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={classeEntrada}
                list="freguesias-conhecidas"
                value={novaFreguesia}
                onChange={(e) => setNovaFreguesia(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    juntarFreguesia();
                  }
                }}
                placeholder="Nome da freguesia"
                aria-label="Acrescentar freguesia"
              />
              <datalist id="freguesias-conhecidas">
                {freguesiasConhecidas.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <Botao variante="secundario" onClick={juntarFreguesia}>
                Juntar
              </Botao>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Campo rotulo="Abre a">
          <input type="date" className={classeEntrada} value={abre} onChange={(e) => setAbre(e.target.value)} required />
        </Campo>
        <Campo rotulo="Último dia">
          <input type="date" className={classeEntrada} value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </Campo>
        <Campo rotulo="Relatório sai a" ajuda="Vazio: 15 dias depois do fim.">
          <input type="date" className={classeEntrada} value={relatorio} onChange={(e) => setRelatorio(e.target.value)} />
        </Campo>
      </div>

      <ErroLinha erro={acao.erro} />
      <div className="flex justify-end gap-2">
        <Botao variante="discreto" onClick={onCancelar}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={acao.aCorrer || (!concelho && freguesias.length === 0)}>
          {consulta ? "Guardar" : "Criar rascunho"}
        </Botao>
      </div>
    </form>
  );
}
