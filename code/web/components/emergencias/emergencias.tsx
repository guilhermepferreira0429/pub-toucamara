"use client";

import { AlertTriangle, Ban, Check, Eye, FlaskConical, Phone, RadioTower, Save, Send, Settings, Siren, Upload, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
} from "@/components/conhecimento/comum";
import { useSessao } from "@/lib/sessao";

type Tipo = "cheia" | "incendio" | "corte_agua" | "calor_extremo" | "outro";
type Gravidade = "aviso" | "alerta" | "emergencia";
type Politica = "nenhuma" | "vulneraveis" | "todos";
type Fonte = "municipes" | "cuidado" | "lista" | "operadores";
type EstadoEmergencia = "rascunho" | "ativa" | "encerrada" | "cancelada";
type Resultado = "por_avisar" | "avisado" | "a_ligar" | "em_seguranca" | "precisa_ajuda" | "nao_atendeu" | "sem_aviso";
type Tom = "neutro" | "ambar" | "verde" | "terracota" | "tinta";

interface Guiao {
  dizer: string;
  perguntas: string[];
}

/** O modo de uma fonte externa (operadores ou cell broadcast). */
interface ModoExterno {
  modo: string;
  simulada: boolean;
  configurada: boolean;
  em_falta: string[];
  nota: string;
}

interface FonteExterna {
  operadores: ModoExterno;
  cell_broadcast: ModoExterno;
}

type EstadoDifusao = "por_pedir" | "pedida" | "em_difusao" | "concluida" | "recusada" | "erro" | "cancelada";

interface Config {
  protecao_civil_nome: string | null;
  protecao_civil_email: string | null;
  sms_por_minuto: number;
  chamadas_por_minuto: number;
  demonstracao: boolean;
  guioes: Record<Tipo, Guiao & { instrucoes: string }>;
  precos: { sms_por_segmento: number; chamada_por_minuto: number; minutos_por_chamada: number; nota: string };
  fonte_externa: FonteExterna;
}

interface Plano {
  simulacao: true;
  nada_enviado: true;
  zona: string;
  aviso_cobertura: string;
  aviso_simulado: string | null;
  fonte_externa: FonteExterna;
  fontes: { fonte: Fonte; nome: string; estado: "ok" | "nao_configurada" | "erro"; encontrados: number; nota: string | null; simulada: boolean }[];
  operadores: (ModoExterno & {
    estado: "ok" | "nao_configurada" | "erro";
    estimativa: { pessoas: number; com_telemovel: number; gerados: number | null; demonstracao: boolean } | null;
    encontrados: number;
    novos: number;
    ja_conhecidos: number;
    escala_real: { sms: number; minutos: number; custo: number } | null;
  }) | null;
  cell_broadcast: (ModoExterno & {
    estado: "ok" | "nao_configurada";
    pessoas_estimadas: number | null;
    demonstracao: boolean;
    nota_estimativa: string | null;
    custo_nota: string;
  }) | null;
  destinatarios: {
    total: number;
    por_fonte: Record<Fonte, number>;
    so_desta_fonte: Record<Fonte, number>;
    simulados: number;
    reais: number;
    em_varias_fontes: number;
    vulneraveis: number;
    so_telefone_fixo: number;
    sem_contacto_possivel: number;
    limite: number;
  };
  sms: { total: number; segmentos_por_sms: number; segmentos: number; texto: string };
  chamadas: { total: number; politica: Politica; vulneraveis: number; guiao: Guiao };
  ritmo: { sms_por_minuto: number; chamadas_por_minuto: number; demonstracao: boolean };
  tempo: { minutos_sms: number; minutos_chamadas: number; minutos_ate_todos_avisados: number };
  custo: { moeda: string; sms: number; chamadas: number; total: number; nota: string };
  amostra: { nome: string; telefone: string; fontes: Fonte[]; vulneravel: boolean; simulado: boolean; zona_aproximada: string | null; sms: boolean; ligado: boolean }[];
  lista_csv?: { invalidas: { linha: number; texto: string }[]; repetidas: number } | null;
}

interface Resumo {
  id: string;
  tipo: Tipo;
  gravidade: Gravidade;
  titulo: string;
  zona_descricao: string;
  estado: EstadoEmergencia;
  destinatarios_previstos: number;
  criada_em: string;
  enviada_em: string | null;
  valida_ate: string;
  resumo: { total: number; precisa_ajuda: number; em_seguranca: number; por_tratar: number };
}

interface PedidoAjuda {
  id: string;
  nome: string | null;
  telefone: string;
  fontes: Fonte[];
  vulneravel: boolean;
  ajuda: string[];
  nota: string | null;
  respondido_em: string | null;
  alertado_em: string | null;
  tratado_em: string | null;
  tratado_nota: string | null;
  tratado_por_nome: string | null;
}

type Contagens = Record<Resultado, number> & { total: number; avisados: number };

interface Detalhe {
  id: string;
  tipo: Tipo;
  tipo_nome: string;
  gravidade: Gravidade;
  titulo: string;
  sms_texto: string;
  guiao: Guiao;
  instrucoes: string;
  numero_emergencia: string;
  zona_descricao: string;
  valida_ate: string;
  chamadas: Politica;
  fontes: Fonte[];
  estado: EstadoEmergencia;
  destinatarios_previstos: number;
  criada_por_nome: string | null;
  criada_em: string;
  enviada_em: string | null;
  enviada_por_nome: string | null;
  encerrada_em: string | null;
  encerrada_nota: string | null;
  aviso_cobertura: string;
  aviso_simulado: string | null;
  cell_broadcast: boolean;
  fonte_externa: FonteExterna;
  contagens: Contagens;
  por_fonte: Record<Fonte, number>;
  por_fonte_estado: Record<Fonte, Contagens>;
  simulados: {
    total: number;
    sms_enviados_simulado: number;
    sms_por_sair: number;
    chamadas_simuladas: number;
    enviados_ao_fornecedor: number;
  };
  cell_broadcast_difusao: {
    modo: string;
    simulado: boolean;
    estado: EstadoDifusao;
    referencia_externa: string | null;
    pessoas_estimadas: number | null;
    pedida_em: string | null;
    iniciada_em: string | null;
    concluida_em: string | null;
    erro: string | null;
  } | null;
  precisa_ajuda: PedidoAjuda[];
  destinatarios: {
    id: string;
    nome: string;
    telefone: string;
    fontes: Fonte[];
    vulneravel: boolean;
    simulado: boolean;
    zona_aproximada: string | null;
    chamada_simulada: boolean;
    resultado: Resultado;
  }[];
  destinatarios_total: number;
  simulacao?: Plano;
}

const TIPOS: Record<Tipo, string> = {
  cheia: "Cheia",
  incendio: "Incêndio",
  corte_agua: "Corte prolongado de água",
  calor_extremo: "Calor extremo",
  outro: "Outro",
};

const GRAVIDADES: Record<Gravidade, { rotulo: string; tom: Tom; chamadas: string }> = {
  aviso: { rotulo: "Aviso", tom: "ambar", chamadas: "só SMS" },
  alerta: { rotulo: "Alerta", tom: "terracota", chamadas: "SMS a todos e chamada aos mais vulneráveis" },
  emergencia: { rotulo: "Emergência", tom: "terracota", chamadas: "SMS e chamada a todos" },
};

const POLITICAS: Record<Politica, string> = {
  nenhuma: "Não ligar (só SMS)",
  vulneraveis: "Ligar aos mais vulneráveis (ação social)",
  todos: "Ligar a todos",
};

const FONTES: Record<Fonte, string> = {
  municipes: "Munícipes conhecidos na zona",
  cuidado: "Contactos de cuidado (ação social)",
  lista: "Lista carregada (CSV)",
  operadores: "Todas as pessoas na zona (operadores)",
};

const DIFUSAO: Record<EstadoDifusao, { rotulo: string; tom: Tom }> = {
  por_pedir: { rotulo: "por pedir", tom: "neutro" },
  pedida: { rotulo: "pedida", tom: "ambar" },
  em_difusao: { rotulo: "em difusão", tom: "terracota" },
  concluida: { rotulo: "concluída", tom: "verde" },
  recusada: { rotulo: "recusada", tom: "terracota" },
  erro: { rotulo: "erro", tom: "terracota" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};

const ESTADOS: Record<EstadoEmergencia, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" },
  ativa: { rotulo: "ativa", tom: "terracota" },
  encerrada: { rotulo: "encerrada", tom: "verde" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
};

const RESULTADOS: Record<Resultado, { rotulo: string; tom: Tom }> = {
  por_avisar: { rotulo: "por avisar", tom: "neutro" },
  avisado: { rotulo: "avisado", tom: "tinta" },
  a_ligar: { rotulo: "a ligar", tom: "ambar" },
  em_seguranca: { rotulo: "em segurança", tom: "verde" },
  precisa_ajuda: { rotulo: "precisa de ajuda", tom: "terracota" },
  nao_atendeu: { rotulo: "não atendeu", tom: "ambar" },
  sem_aviso: { rotulo: "sem aviso", tom: "terracota" },
};

const euro = (x: number) => x.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const minutos = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());

function Cobertura({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-ambar-suave px-3 py-2.5 text-xs text-ambar">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{texto}</span>
    </p>
  );
}

function Demonstracao() {
  return <Pilula tom="ambar">valores de demonstração</Pilula>;
}

/** Bem visível: números falsos, que nunca saem. */
function Simulado({ texto = "simulado" }: { texto?: string }) {
  return (
    <Pilula tom="terracota">
      <FlaskConical className="mr-1 inline size-3" aria-hidden />
      {texto}
    </Pilula>
  );
}

/** A pílula do modo de uma fonte externa. */
function PilulaModo({ m }: { m: ModoExterno | undefined }) {
  if (!m) return null;
  if (m.simulada) return <Simulado />;
  return m.configurada ? <Pilula tom="verde">real</Pilula> : <Pilula tom="neutro">por configurar</Pilula>;
}

/** O que falta para a fonte externa ser real (curto). */
function FaltaParaReal() {
  return (
    <p className="text-xs text-tinta-3">
      Para ser real falta o acordo com a ANEPC / operadores (base legal e acordo de tratamento de dados), o serviço deles e as
      credenciais. Até lá os números são gerados para demonstração: ficam registados como enviados (simulado) e nenhum SMS nem
      chamada sai para eles.
    </p>
  );
}

function AvisoSimulado({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-terracota bg-terracota-suave px-3 py-2.5 text-xs text-terracota-escuro">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{texto}</span>
    </p>
  );
}

/** O plano da simulação: quantos, de onde, quanto tempo e quanto custa. */
function VerPlano({ p }: { p: Plano }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-creme p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-[40px] leading-none font-bold text-terracota">{numero(p.destinatarios.total)}</span>
        <span className="text-sm text-tinta-2">números em {p.zona}</span>
        <Pilula tom="tinta">simulação: nada foi enviado</Pilula>
        {p.destinatarios.simulados > 0 && <Simulado texto={`${numero(p.destinatarios.simulados)} simulados`} />}
      </div>
      {p.aviso_simulado ? <AvisoSimulado texto={p.aviso_simulado} /> : <Cobertura texto={p.aviso_cobertura} />}

      <div>
        <Rotulo className="mb-2">De onde vem cada número</Rotulo>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {p.fontes.map((f) => (
            <li key={f.fonte} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-tinta">{FONTES[f.fonte]}</span>
                {f.estado === "ok" ? (
                  <span className="text-tinta-2">
                    {numero(f.encontrados)}
                    {f.encontrados !== p.destinatarios.so_desta_fonte[f.fonte]
                      ? ` (${numero(p.destinatarios.so_desta_fonte[f.fonte])} só desta fonte)`
                      : ""}
                  </span>
                ) : (
                  <Pilula tom={f.estado === "erro" ? "terracota" : "neutro"}>
                    {f.estado === "erro" ? "erro" : "por configurar"}
                  </Pilula>
                )}
                {f.simulada && <Simulado />}
              </span>
              {f.nota && <span className="text-xs text-tinta-3">{f.nota}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-tinta-3">
          {numero(p.destinatarios.em_varias_fontes)} números aparecem em mais de uma fonte (contam uma vez) ·{" "}
          {numero(p.destinatarios.vulneraveis)} vulneráveis · {numero(p.destinatarios.so_telefone_fixo)} só com
          telefone fixo (sem SMS)
          {p.destinatarios.sem_contacto_possivel ? ` · ${numero(p.destinatarios.sem_contacto_possivel)} sem contacto possível` : ""}
          {p.destinatarios.simulados ? ` · ${numero(p.destinatarios.reais)} reais e ${numero(p.destinatarios.simulados)} simulados` : ""}
        </p>
        {p.lista_csv && (p.lista_csv.invalidas.length > 0 || p.lista_csv.repetidas > 0) && (
          <p className="mt-1 text-xs text-ambar">
            Lista: {p.lista_csv.invalidas.length} linhas inválidas
            {p.lista_csv.invalidas.length ? ` (linhas ${p.lista_csv.invalidas.map((x) => x.linha).join(", ")})` : ""},{" "}
            {p.lista_csv.repetidas} repetidas.
          </p>
        )}
      </div>

      {(p.operadores || p.cell_broadcast) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {p.operadores && (
            <div className="flex flex-col gap-1 rounded-xl bg-papel p-3">
              <span className="flex flex-wrap items-center gap-2">
                <Rotulo>Todas as pessoas na zona</Rotulo>
                <PilulaModo m={p.operadores} />
              </span>
              {p.operadores.estimativa ? (
                <>
                  <p className="text-sm text-tinta">
                    <strong>{numero(p.operadores.estimativa.com_telemovel)}</strong> telemóveis estimados ·{" "}
                    {numero(p.operadores.novos)} novos na lista
                    {p.operadores.ja_conhecidos ? ` · ${numero(p.operadores.ja_conhecidos)} já conhecidos (ficam com o canal deles)` : ""}
                  </p>
                  {p.operadores.escala_real && p.operadores.estimativa.gerados !== p.operadores.estimativa.com_telemovel && (
                    <p className="text-xs text-tinta-2">
                      À escala real: {numero(p.operadores.escala_real.sms)} SMS em {minutos(p.operadores.escala_real.minutos)} ·{" "}
                      {euro(p.operadores.escala_real.custo)} <Demonstracao />
                    </p>
                  )}
                  {p.operadores.estimativa.demonstracao && (
                    <p className="text-xs text-tinta-3">População da zona: valores de demonstração (não são os Censos 2021).</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-tinta-3">{p.operadores.nota}</p>
              )}
            </div>
          )}
          {p.cell_broadcast && (
            <div className="flex flex-col gap-1 rounded-xl bg-papel p-3">
              <span className="flex flex-wrap items-center gap-2">
                <Rotulo>Cell broadcast</Rotulo>
                <PilulaModo m={p.cell_broadcast} />
              </span>
              {p.cell_broadcast.pessoas_estimadas !== null ? (
                <p className="text-sm text-tinta">
                  Para os telemóveis ligados às antenas da zona (cerca de{" "}
                  <strong>{numero(p.cell_broadcast.pessoas_estimadas)}</strong>), sem números.
                </p>
              ) : (
                <p className="text-xs text-terracota">{p.cell_broadcast.nota_estimativa}</p>
              )}
              <p className="text-xs text-tinta-3">{p.cell_broadcast.custo_nota}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-papel p-3">
          <Rotulo>SMS</Rotulo>
          <p className="mt-1 text-sm text-tinta">
            <strong>{numero(p.sms.total)}</strong> SMS · {p.sms.segmentos_por_sms}{" "}
            {p.sms.segmentos_por_sms === 1 ? "parte" : "partes"} cada
          </p>
          <p className="text-xs text-tinta-3">Vai também a quem recusou avisos e a qualquer hora.</p>
        </div>
        <div className="rounded-xl bg-papel p-3">
          <Rotulo>Chamadas do agente</Rotulo>
          <p className="mt-1 text-sm text-tinta">
            <strong>{numero(p.chamadas.total)}</strong> chamadas · {POLITICAS[p.chamadas.politica].toLowerCase()}
          </p>
          <p className="text-xs text-tinta-3">Sem janela de horário.</p>
        </div>
        <div className="rounded-xl bg-papel p-3">
          <span className="flex items-center gap-2">
            <Rotulo>Tempo até todos avisados</Rotulo>
            {p.ritmo.demonstracao && <Demonstracao />}
          </span>
          <p className="mt-1 text-sm text-tinta">
            <strong>{minutos(p.tempo.minutos_ate_todos_avisados)}</strong>
            {p.chamadas.total ? ` · chamadas acabam em ${minutos(p.tempo.minutos_chamadas)}` : ""}
          </p>
          <p className="text-xs text-tinta-3">
            Ao ritmo de {numero(p.ritmo.sms_por_minuto)} SMS e {numero(p.ritmo.chamadas_por_minuto)} chamadas por minuto.
          </p>
        </div>
        <div className="rounded-xl bg-papel p-3">
          <span className="flex items-center gap-2">
            <Rotulo>Custo estimado</Rotulo>
            <Demonstracao />
          </span>
          <p className="mt-1 text-sm text-tinta">
            <strong>{euro(p.custo.total)}</strong> · SMS {euro(p.custo.sms)} · chamadas {euro(p.custo.chamadas)}
          </p>
          <p className="text-xs text-tinta-3">{p.custo.nota}</p>
        </div>
      </div>

      <div>
        <Rotulo className="mb-1">Assim fica o SMS</Rotulo>
        <p className="rounded-[14px_14px_14px_4px] bg-[#E9E9EB] px-3 py-2.5 text-[13px] text-[#111111]">{p.sms.texto}</p>
      </div>
      {p.chamadas.total > 0 && (
        <div>
          <Rotulo className="mb-1">O que o agente diz e pergunta</Rotulo>
          <p className="text-[13px] text-tinta-2">{p.chamadas.guiao.dizer}</p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-tinta-2">
            {p.chamadas.guiao.perguntas.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {p.amostra.length > 0 && (
        <details className="text-xs text-tinta-2">
          <summary className="cursor-pointer font-semibold text-tinta">Ver uma amostra</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {p.amostra.map((x, i) => (
              <li key={i}>
                {x.simulado ? "[simulado] " : ""}
                {x.nome} · {x.telefone} · {x.fontes.map((f) => FONTES[f]).join(", ")}
                {x.zona_aproximada ? ` · ${x.zona_aproximada}` : ""}
                {x.vulneravel ? " · vulnerável" : ""}
                {x.ligado ? (x.simulado ? " · chamada simulada" : " · é ligado") : ""}
                {!x.sms ? " · sem SMS (fixo)" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type TipoZona = "poligono" | "ponto" | "freguesias";

interface Formulario {
  tipo: Tipo;
  gravidade: Gravidade;
  titulo: string;
  mensagem_sms: string;
  instrucoes: string;
  dizer: string;
  perguntas: string;
  numero: string;
  zonaTipo: TipoZona;
  pontos: string;
  lat: string;
  lng: string;
  raio: string;
  freguesias: string;
  descricao: string;
  valida_ate: string;
  chamadas: "" | Politica;
  fontes: Fonte[];
  cell_broadcast: boolean;
  csv: string;
}

function inicial(c: Config | undefined, tipo: Tipo = "cheia"): Formulario {
  const g = c?.guioes[tipo];
  return {
    tipo,
    gravidade: "alerta",
    titulo: "",
    mensagem_sms: "",
    instrucoes: g?.instrucoes ?? "",
    dizer: g?.dizer ?? "",
    perguntas: g?.perguntas.join("\n") ?? "",
    numero: "112",
    zonaTipo: "poligono",
    pontos: "",
    lat: "",
    lng: "",
    raio: "500",
    freguesias: "",
    descricao: "",
    valida_ate: "",
    chamadas: "",
    fontes: ["municipes", "cuidado", "lista"],
    cell_broadcast: false,
    csv: "",
  };
}

function corpoDe(f: Formulario) {
  const descricao = f.descricao.trim() || undefined;
  const zona =
    f.zonaTipo === "freguesias"
      ? { tipo: "freguesias", freguesias: f.freguesias.split(/\n|,/).map((x) => x.trim()).filter(Boolean), descricao }
      : f.zonaTipo === "ponto"
        ? { tipo: "ponto", lat: Number(f.lat), lng: Number(f.lng), raio_m: Number(f.raio) || 500, descricao }
        : {
            tipo: "poligono",
            pontos: f.pontos
              .split("\n")
              .map((l) => l.split(/[,;\s]+/).map(Number))
              .filter((p) => p.length >= 2 && p.every((x) => Number.isFinite(x)))
              .map(([lat, lng]) => ({ lat, lng })),
            descricao,
          };
  return {
    tipo: f.tipo,
    gravidade: f.gravidade,
    titulo: f.titulo.trim(),
    mensagem_sms: f.mensagem_sms.trim(),
    instrucoes: f.instrucoes.trim() || undefined,
    guiao: {
      dizer: f.dizer.trim(),
      perguntas: f.perguntas.split("\n").map((x) => x.trim()).filter(Boolean),
    },
    numero_emergencia: f.numero.trim() || "112",
    zona,
    valida_ate: f.valida_ate ? new Date(f.valida_ate).toISOString() : undefined,
    chamadas: f.chamadas || undefined,
    fontes: f.fontes,
    cell_broadcast: f.cell_broadcast,
    lista_csv: f.fontes.includes("lista") && f.csv.trim() ? f.csv : undefined,
  };
}

function NovaEmergencia({ config, onCriada }: { config: Config | undefined; onCriada: (id: string) => void }) {
  const { pedido } = useSessao();
  const [f, setF] = useState<Formulario>(() => inicial(config));
  const [plano, setPlano] = useState<Plano | null>(null);
  const simular = useAcao();
  const guardar = useAcao();
  const muda = (x: Partial<Formulario>) => {
    setF((a) => ({ ...a, ...x }));
    setPlano(null);
  };
  const mudaTipo = (tipo: Tipo) => {
    const g = config?.guioes[tipo];
    muda({ tipo, ...(g ? { instrucoes: g.instrucoes, dizer: g.dizer, perguntas: g.perguntas.join("\n") } : {}) });
  };
  const alternarFonte = (x: Fonte) =>
    muda({ fontes: f.fontes.includes(x) ? f.fontes.filter((y) => y !== x) : [...f.fontes, x] });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await guardar.executar(() => pedido<Detalhe>("/v1/painel/emergencias", { corpo: corpoDe(f) }));
        if (r) {
          setF(inicial(config));
          setPlano(null);
          onCriada(r.id);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <select className={classeEntrada} value={f.tipo} onChange={(e) => mudaTipo(e.target.value as Tipo)}>
            {(Object.keys(TIPOS) as Tipo[]).map((t) => (
              <option key={t} value={t}>
                {TIPOS[t]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Gravidade" ajuda={GRAVIDADES[f.gravidade].chamadas}>
          <select className={classeEntrada} value={f.gravidade} onChange={(e) => muda({ gravidade: e.target.value as Gravidade })}>
            {(Object.keys(GRAVIDADES) as Gravidade[]).map((g) => (
              <option key={g} value={g}>
                {GRAVIDADES[g].rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Título (para o painel e para o agente)">
        <input className={classeEntrada} required minLength={3} maxLength={120} value={f.titulo} onChange={(e) => muda({ titulo: e.target.value })} placeholder="Cheia no rio Ave" />
      </Campo>
      <Campo rotulo="Mensagem do SMS" ajuda={`${f.mensagem_sms.length} / 300 · curta: vai com as instruções e o número de emergência`}>
        <textarea className={`${classeEntrada} min-h-16`} required minLength={10} maxLength={300} value={f.mensagem_sms} onChange={(e) => muda({ mensagem_sms: e.target.value })} placeholder="Risco de cheia esta noite junto ao rio Ave." />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Campo rotulo="Instruções (para onde ir, o que fazer)">
          <input className={classeEntrada} maxLength={300} value={f.instrucoes} onChange={(e) => muda({ instrucoes: e.target.value })} />
        </Campo>
        <Campo rotulo="N.º de emergência">
          <input className={classeEntrada} value={f.numero} onChange={(e) => muda({ numero: e.target.value })} />
        </Campo>
      </div>
      <details className="rounded-xl border border-linha p-4" open={f.gravidade !== "aviso"}>
        <summary className="cursor-pointer text-[13px] font-semibold text-tinta">Guião da chamada do agente</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Campo rotulo="O que o agente diz">
            <textarea className={`${classeEntrada} min-h-16`} minLength={10} maxLength={600} value={f.dizer} onChange={(e) => muda({ dizer: e.target.value })} />
          </Campo>
          <Campo rotulo="O que pergunta (uma por linha, até 5)">
            <textarea className={`${classeEntrada} min-h-20`} value={f.perguntas} onChange={(e) => muda({ perguntas: e.target.value })} />
          </Campo>
          <Campo rotulo="A quem liga">
            <select className={classeEntrada} value={f.chamadas} onChange={(e) => muda({ chamadas: e.target.value as "" | Politica })}>
              <option value="">Conforme a gravidade ({GRAVIDADES[f.gravidade].chamadas})</option>
              {(Object.keys(POLITICAS) as Politica[]).map((p) => (
                <option key={p} value={p}>
                  {POLITICAS[p]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </details>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-linha p-4">
        <legend className="px-1 text-[13px] font-semibold text-tinta">Zona</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Como indicar a zona">
          {(
            [
              ["poligono", "Polígono"],
              ["ponto", "Ponto e raio"],
              ["freguesias", "Freguesias"],
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
        {f.zonaTipo === "poligono" && (
          <Campo rotulo="Vértices (um por linha: latitude, longitude; pelo menos 3)">
            <textarea className={`${classeEntrada} min-h-24 font-mono text-xs`} required value={f.pontos} onChange={(e) => muda({ pontos: e.target.value })} placeholder={"41.4425, -8.2918\n41.4431, -8.2902\n41.4419, -8.2895"} />
          </Campo>
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
              <input type="number" min={10} max={20000} required className={classeEntrada} value={f.raio} onChange={(e) => muda({ raio: e.target.value })} />
            </Campo>
          </div>
        )}
        {f.zonaTipo === "freguesias" && (
          <Campo rotulo="Freguesias (uma por linha)">
            <textarea className={`${classeEntrada} min-h-20`} required value={f.freguesias} onChange={(e) => muda({ freguesias: e.target.value })} placeholder="Azurém" />
          </Campo>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Descrição da zona (opcional)">
            <input className={classeEntrada} maxLength={200} value={f.descricao} onChange={(e) => muda({ descricao: e.target.value })} placeholder="Margens do rio Ave" />
          </Campo>
          <Campo rotulo="Válido até" ajuda="Por omissão, 24 horas. Depois encerra sozinho.">
            <input type="datetime-local" className={classeEntrada} value={f.valida_ate} onChange={(e) => muda({ valida_ate: e.target.value })} />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-linha p-4">
        <legend className="px-1 text-[13px] font-semibold text-tinta">De onde vêm os números</legend>
        {(Object.keys(FONTES) as Fonte[]).map((x) => (
          <label key={x} className="flex flex-wrap items-center gap-2 text-[13px] text-tinta">
            <input type="checkbox" checked={f.fontes.includes(x)} onChange={() => alternarFonte(x)} />
            {FONTES[x]}
            {x === "operadores" && <PilulaModo m={config?.fonte_externa.operadores} />}
          </label>
        ))}
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-tinta">
          <input type="checkbox" checked={f.cell_broadcast} onChange={() => muda({ cell_broadcast: !f.cell_broadcast })} />
          <RadioTower className="size-3.5 text-tinta-2" aria-hidden />
          Cell broadcast (mensagem para todos os telemóveis da zona, sem números)
          <PilulaModo m={config?.fonte_externa.cell_broadcast} />
        </label>
        {f.fontes.includes("lista") && (
          <div className="flex flex-col gap-2">
            <Campo rotulo="Lista de telefones (CSV: telefone ou telefone;nome, um por linha)">
              <textarea className={`${classeEntrada} min-h-20 font-mono text-xs`} value={f.csv} onChange={(e) => muda({ csv: e.target.value })} placeholder={"912345678;Maria Silva\n913000111"} />
            </Campo>
            <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs font-semibold text-tinta-2">
              <Upload className="size-3.5" aria-hidden />
              Carregar ficheiro CSV
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={async (e) => {
                  const ficheiro = e.target.files?.[0];
                  if (ficheiro) muda({ csv: await ficheiro.text() });
                }}
              />
            </label>
          </div>
        )}
        {f.fontes.includes("operadores") || f.cell_broadcast ? (
          <FaltaParaReal />
        ) : (
          <Cobertura texto="Assim a lista não é toda a gente da zona: só os números que a câmara conhece. Para chegar a toda a gente, junte “Todas as pessoas na zona” ou o cell broadcast." />
        )}
      </fieldset>

      <ErroLinha erro={simular.erro ?? guardar.erro} />
      {plano && <VerPlano p={plano} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Botao
          variante="secundario"
          icone={Eye}
          disabled={simular.aCorrer}
          onClick={async () => {
            const p = await simular.executar(() =>
              pedido<Plano>("/v1/painel/emergencias", { corpo: { ...corpoDe(f), simular: true } }),
            );
            if (p) setPlano(p);
          }}
        >
          {simular.aCorrer ? "A simular…" : "Simular"}
        </Botao>
        <Botao type="submit" icone={Save} disabled={guardar.aCorrer}>
          {guardar.aCorrer ? "A guardar…" : "Guardar rascunho"}
        </Botao>
      </div>
      <p className="text-right text-xs text-tinta-3">Simular não envia nada. O rascunho só sai depois de confirmar duas vezes.</p>
    </form>
  );
}

/** Dupla confirmação: o número de pessoas e depois escrever ENVIAR. */
function Confirmar({ d, onFeito }: { d: Detalhe; onFeito: () => void }) {
  const { pedido } = useSessao();
  const [passo, setPasso] = useState<1 | 2>(1);
  const [n, setN] = useState("");
  const [texto, setTexto] = useState("");
  const [esperado, setEsperado] = useState(d.destinatarios_previstos);
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (passo === 1) {
          setPasso(2);
          return;
        }
        const r = await acao.executar(() =>
          pedido(`/v1/painel/emergencias/${d.id}/enviar`, {
            corpo: { confirmo_destinatarios: Number(n), confirmo_texto: texto.trim() },
          }),
        );
        if (r) onFeito();
      }}
    >
      {passo === 1 ? (
        <>
          <p className="text-sm text-tinta-2">
            «{d.titulo}» vai por SMS e {d.chamadas === "nenhuma" ? "sem chamadas" : "com chamadas do agente"} para{" "}
            <strong className="text-tinta">{numero(esperado)}</strong> números em {d.zona_descricao}, a qualquer hora e também a
            quem recusou avisos{d.cell_broadcast ? ", e pede o cell broadcast para a zona" : ""}. Para confirmar, escreva o
            número exato.
          </p>
          {d.fontes.includes("operadores") && d.fonte_externa.operadores.simulada && (
            <AvisoSimulado texto="Inclui números simulados (todas as pessoas na zona): ficam registados como enviados (simulado), mas nenhum SMS nem chamada sai para eles." />
          )}
          <Campo rotulo="Número de pessoas">
            <input type="number" inputMode="numeric" min={0} required className={classeEntrada} value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          </Campo>
          <div className="flex justify-end">
            <Botao type="submit" disabled={Number(n) !== esperado}>
              Continuar
            </Botao>
          </div>
        </>
      ) : (
        <>
          <p className="rounded-xl bg-terracota-suave px-3 py-2.5 text-sm text-terracota-escuro">
            Última confirmação: depois disto os SMS e as chamadas começam a sair. Escreva <strong>ENVIAR</strong>.
          </p>
          <Campo rotulo="Escreva ENVIAR">
            <input className={classeEntrada} required value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
          </Campo>
          <ErroLinha erro={acao.erro} />
          {acao.erro?.codigo === "confirmacao_diferente" && (
            <Botao
              variante="discreto"
              tamanho="pequeno"
              className="w-fit"
              onClick={() => {
                const x = acao.erro?.detalhes as { destinatarios?: number } | undefined;
                if (x?.destinatarios !== undefined) setEsperado(x.destinatarios);
                setN("");
                setTexto("");
                setPasso(1);
                acao.limpar();
              }}
            >
              Rever com o número novo
            </Botao>
          )}
          <div className="flex justify-end gap-2">
            <Botao variante="discreto" onClick={() => setPasso(1)}>
              Voltar
            </Botao>
            <Botao type="submit" icone={Send} disabled={acao.aCorrer || texto.trim() !== "ENVIAR"}>
              {acao.aCorrer ? "A enviar…" : "Enviar agora"}
            </Botao>
          </div>
        </>
      )}
    </form>
  );
}

function Contador({ valor, rotulo, tom }: { valor: number; rotulo: string; tom?: "terracota" | "verde" | "ambar" }) {
  const cor = tom === "terracota" ? "text-terracota" : tom === "verde" ? "text-verde" : tom === "ambar" ? "text-ambar" : "text-tinta";
  return (
    <div className="flex flex-col rounded-xl bg-creme px-3 py-2.5">
      <span className={`font-display text-[28px] leading-none font-bold ${cor}`}>{numero(valor)}</span>
      <span className="text-xs text-tinta-2">{rotulo}</span>
    </div>
  );
}

/** De onde vieram os números: por fonte e por estado; os simulados à parte. */
function PorFonte({ d }: { d: Detalhe }) {
  const fontes = (Object.keys(FONTES) as Fonte[]).filter((f) => d.por_fonte_estado[f]?.total > 0);
  return (
    <div className="flex flex-col gap-2">
      <Rotulo>De onde vieram os números</Rotulo>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-tinta-2">
          <thead>
            <tr className="text-tinta-3">
              <th className="py-1 pr-3 font-semibold">Fonte</th>
              <th className="py-1 pr-3 font-semibold">Números</th>
              <th className="py-1 pr-3 font-semibold">Avisados</th>
              <th className="py-1 pr-3 font-semibold">Em segurança</th>
              <th className="py-1 pr-3 font-semibold">Precisam de ajuda</th>
              <th className="py-1 font-semibold">Por avisar</th>
            </tr>
          </thead>
          <tbody>
            {fontes.map((f) => {
              const c = d.por_fonte_estado[f];
              return (
                <tr key={f} className="border-t border-linha">
                  <td className="py-1.5 pr-3 text-tinta">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {FONTES[f]}
                      {f === "operadores" && d.simulados.total > 0 && <Simulado />}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{numero(c.total)}</td>
                  <td className="py-1.5 pr-3">{numero(c.avisados)}</td>
                  <td className="py-1.5 pr-3">{numero(c.em_seguranca)}</td>
                  <td className="py-1.5 pr-3">{numero(c.precisa_ajuda)}</td>
                  <td className="py-1.5">{numero(c.por_avisar + c.a_ligar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {d.fontes.includes("operadores") && d.por_fonte.operadores === 0 && !d.fonte_externa.operadores.simulada && (
        <p className="text-xs text-tinta-3">Todas as pessoas na zona: {d.fonte_externa.operadores.nota}</p>
      )}
      {d.simulados.total > 0 && (
        <p className="text-xs text-tinta-2">
          Simulados: <strong>{numero(d.simulados.sms_enviados_simulado)}</strong> SMS enviados (simulado)
          {d.simulados.sms_por_sair ? ` · ${numero(d.simulados.sms_por_sair)} por sair` : ""} ·{" "}
          {numero(d.simulados.chamadas_simuladas)} chamadas simuladas · {numero(d.simulados.enviados_ao_fornecedor)} enviados ao
          fornecedor.
        </p>
      )}
      {d.simulados.total > 0 && <FaltaParaReal />}
    </div>
  );
}

/** O cell broadcast: área + texto + estado da difusão. */
function Difusao({ x }: { x: NonNullable<Detalhe["cell_broadcast_difusao"]> }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-creme p-3 text-xs text-tinta-2">
      <span className="flex flex-wrap items-center gap-2">
        <RadioTower className="size-4 text-tinta" aria-hidden />
        <span className="text-[13px] font-semibold text-tinta">Cell broadcast</span>
        <Pilula tom={DIFUSAO[x.estado].tom}>{DIFUSAO[x.estado].rotulo}</Pilula>
        {x.simulado && <Simulado />}
      </span>
      <span>
        {x.referencia_externa ? `Pedido ${x.referencia_externa}` : "Sem referência"}
        {x.pessoas_estimadas !== null ? ` · cerca de ${numero(x.pessoas_estimadas)} telemóveis na zona` : ""}
        {x.pedida_em ? ` · pedido ${quando(x.pedida_em)}` : ""}
        {x.iniciada_em ? ` · em difusão desde ${quando(x.iniciada_em)}` : ""}
        {x.concluida_em ? ` · concluído ${quando(x.concluida_em)}` : ""}
      </span>
      {x.erro && <span className="text-terracota">{x.erro}</span>}
      {x.simulado && <span className="text-tinta-3">Difusão de demonstração: nada saiu para os operadores.</span>}
    </div>
  );
}

/** Acompanhar: contagens em tempo real, pedidos de ajuda em destaque. */
function VerEmergencia({ id, onMudou }: { id: string; onMudou: () => void }) {
  const { pedido, pode } = useSessao();
  const det = useDados<Detalhe>(`/v1/painel/emergencias/${id}`);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const acao = useAcao();
  const enviar = pode("agente");
  const d = det.dados;
  const ativa = d?.estado === "ativa";
  const { recarregar } = det;

  useEffect(() => {
    if (!ativa) return;
    const t = setInterval(recarregar, 10_000);
    return () => clearInterval(t);
  }, [ativa, recarregar]);

  return (
    <Estado aCarregar={det.aCarregar && !d} erro={det.erro} vazio={false}>
      {d && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Pilula tom={GRAVIDADES[d.gravidade].tom}>{GRAVIDADES[d.gravidade].rotulo}</Pilula>
                <Pilula tom={ESTADOS[d.estado].tom}>{ESTADOS[d.estado].rotulo}</Pilula>
                {ativa && <span className="text-xs text-tinta-3">atualiza a cada 10 s</span>}
              </span>
              <h2 className="font-display text-[19px] font-bold text-tinta">{d.titulo}</h2>
              <span className="text-xs text-tinta-3">
                {d.tipo_nome} · {d.zona_descricao} · válido até {quando(d.valida_ate)}
                {d.enviada_em ? ` · enviado ${quando(d.enviada_em)}${d.enviada_por_nome ? ` por ${d.enviada_por_nome}` : ""}` : ""}
              </span>
            </span>
          </div>

          {d.precisa_ajuda.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-terracota bg-terracota-suave/50 p-4" role="alert">
              <p className="flex items-center gap-2 font-semibold text-terracota-escuro">
                <Siren className="size-4" aria-hidden />
                {d.precisa_ajuda.filter((x) => !x.tratado_em).length} por tratar · {d.precisa_ajuda.length} {d.precisa_ajuda.length === 1 ? "precisa" : "precisam"} de ajuda
              </p>
              <ul className="flex flex-col gap-2">
                {d.precisa_ajuda.map((x) => (
                  <li key={x.id} className={`flex flex-wrap items-start gap-3 rounded-lg bg-papel p-3 ${x.tratado_em ? "opacity-60" : ""}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px]">
                      <span className="font-semibold text-tinta">
                        {x.nome ?? "Sem nome"} · <a className="underline" href={`tel:${x.telefone}`}>{x.telefone}</a>
                        {x.vulneravel ? " · vulnerável" : ""}
                      </span>
                      {x.ajuda.length > 0 && <span className="text-tinta-2">Ajuda: {x.ajuda.join(", ").replace(/_/g, " ")}</span>}
                      {x.nota && <span className="text-tinta-2">«{x.nota}»</span>}
                      <span className="text-xs text-tinta-3">
                        {x.respondido_em ? `respondeu ${quando(x.respondido_em)}` : ""}
                        {x.alertado_em ? " · chefias e proteção civil alertadas" : ""}
                        {x.tratado_em ? ` · tratado ${quando(x.tratado_em)}${x.tratado_por_nome ? ` por ${x.tratado_por_nome}` : ""}${x.tratado_nota ? `: ${x.tratado_nota}` : ""}` : ""}
                      </span>
                    </span>
                    {!x.tratado_em && (
                      <Botao
                        tamanho="pequeno"
                        variante="secundario"
                        icone={Check}
                        disabled={acao.aCorrer}
                        onClick={async () => {
                          const nota = window.prompt("O que foi feito? (opcional)") ?? undefined;
                          const r = await acao.executar(() =>
                            pedido(`/v1/painel/emergencias/${d.id}/destinatarios/${x.id}/tratar`, { corpo: { nota: nota || undefined } }),
                          );
                          if (r) recarregar();
                        }}
                      >
                        Tratado
                      </Botao>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.estado !== "rascunho" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Contador valor={d.contagens.avisados} rotulo={`avisados de ${numero(d.contagens.total)}`} />
              <Contador valor={d.contagens.em_seguranca} rotulo="em segurança" tom="verde" />
              <Contador valor={d.contagens.precisa_ajuda} rotulo="precisam de ajuda" tom="terracota" />
              <Contador valor={d.contagens.nao_atendeu} rotulo="não atenderam" tom="ambar" />
              <Contador valor={d.contagens.por_avisar + d.contagens.a_ligar} rotulo="ainda por avisar" />
            </div>
          )}

          {d.aviso_simulado ? <AvisoSimulado texto={d.aviso_simulado} /> : <Cobertura texto={d.aviso_cobertura} />}
          {d.estado !== "rascunho" && <PorFonte d={d} />}
          {d.cell_broadcast_difusao && <Difusao x={d.cell_broadcast_difusao} />}

          <div>
            <Rotulo className="mb-1">SMS</Rotulo>
            <p className="rounded-[14px_14px_14px_4px] bg-[#E9E9EB] px-3 py-2.5 text-[13px] text-[#111111]">{d.sms_texto}</p>
          </div>

          <ErroLinha erro={acao.erro} />
          {d.estado === "rascunho" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-tinta-2">
                Rascunho para <strong>{numero(d.destinatarios_previstos)}</strong> números. {POLITICAS[d.chamadas]}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Botao
                  variante="secundario"
                  icone={Eye}
                  disabled={acao.aCorrer}
                  onClick={async () => {
                    const p = await acao.executar(() => pedido<Plano>(`/v1/painel/emergencias/${d.id}/simular`, { metodo: "POST" }));
                    if (p) setPlano(p);
                  }}
                >
                  Simular
                </Botao>
                {enviar && (
                  <Botao icone={Send} onClick={() => setConfirmar(true)}>
                    Enviar
                  </Botao>
                )}
                {enviar && (
                  <Botao
                    variante="discreto"
                    icone={Ban}
                    disabled={acao.aCorrer}
                    onClick={async () => {
                      if (!window.confirm("Cancelar este rascunho?")) return;
                      const r = await acao.executar(() => pedido(`/v1/painel/emergencias/${d.id}/encerrar`, { corpo: {} }));
                      if (r) {
                        recarregar();
                        onMudou();
                      }
                    }}
                  >
                    Cancelar
                  </Botao>
                )}
              </div>
              {!enviar && <p className="text-xs text-tinta-3">Só o chefe de divisão (ou a equipa Tou, Câmara?) envia.</p>}
              {plano && <VerPlano p={plano} />}
            </div>
          )}
          {ativa && enviar && (
            <Botao
              variante="secundario"
              icone={Ban}
              className="w-fit"
              disabled={acao.aCorrer}
              onClick={async () => {
                const nota = window.prompt("Encerrar o aviso de emergência? As chamadas e os SMS por sair são cancelados. Nota (opcional):");
                if (nota === null) return;
                const r = await acao.executar(() =>
                  pedido(`/v1/painel/emergencias/${d.id}/encerrar`, { corpo: { nota: nota || undefined } }),
                );
                if (r) {
                  recarregar();
                  onMudou();
                }
              }}
            >
              Encerrar
            </Botao>
          )}
          {d.encerrada_em && (
            <p className="text-xs text-tinta-3">
              Encerrado {quando(d.encerrada_em)}
              {d.encerrada_nota ? `: ${d.encerrada_nota}` : ""}
            </p>
          )}

          {d.destinatarios.length > 0 && (
            <details className="text-xs text-tinta-2">
              <summary className="cursor-pointer font-semibold text-tinta">
                <Users className="mr-1 inline size-3.5" aria-hidden />
                Pessoas ({numero(d.destinatarios_total)})
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {d.destinatarios.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <Pilula tom={RESULTADOS[x.resultado].tom}>
                      {x.simulado && x.resultado === "avisado" ? "enviado (simulado)" : RESULTADOS[x.resultado].rotulo}
                    </Pilula>
                    {x.simulado && <Simulado />}
                    {x.nome} · {x.telefone} · {x.fontes.map((f) => FONTES[f]).join(", ")}
                    {x.zona_aproximada ? ` · ${x.zona_aproximada}` : ""}
                    {x.vulneravel ? " · vulnerável" : ""}
                    {x.chamada_simulada ? " · chamada simulada" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <Dialogo titulo="Confirmar envio" aberto={confirmar} onFechar={() => setConfirmar(false)}>
        {d && confirmar && (
          <Confirmar
            d={d}
            onFeito={() => {
              setConfirmar(false);
              setPlano(null);
              recarregar();
              onMudou();
            }}
          />
        )}
      </Dialogo>
    </Estado>
  );
}

function Configuracao({ config, onGuardado }: { config: Config; onGuardado: () => void }) {
  const { pedido } = useSessao();
  const [f, setF] = useState({
    nome: config.protecao_civil_nome ?? "",
    email: config.protecao_civil_email ?? "",
    sms: String(config.sms_por_minuto),
    chamadas: String(config.chamadas_por_minuto),
  });
  const acao = useAcao();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await acao.executar(() =>
          pedido("/v1/painel/emergencias/config", {
            metodo: "PUT",
            corpo: {
              protecao_civil_nome: f.nome.trim() || null,
              protecao_civil_email: f.email.trim() || null,
              sms_por_minuto: Number(f.sms),
              chamadas_por_minuto: Number(f.chamadas),
            },
          }),
        );
        if (r) onGuardado();
      }}
    >
      {config.demonstracao && (
        <p className="flex items-center gap-2 text-xs text-tinta-3">
          <Demonstracao /> Ritmo por omissão; confirme os limites da conta Twilio da câmara.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="SMS por minuto">
          <input type="number" min={1} max={6000} required className={classeEntrada} value={f.sms} onChange={(e) => setF({ ...f, sms: e.target.value })} />
        </Campo>
        <Campo rotulo="Chamadas por minuto">
          <input type="number" min={1} max={600} required className={classeEntrada} value={f.chamadas} onChange={(e) => setF({ ...f, chamadas: e.target.value })} />
        </Campo>
        <Campo rotulo="Proteção civil municipal">
          <input className={classeEntrada} maxLength={120} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="SMPC" />
        </Campo>
        <Campo rotulo="Email para os alertas" ajuda="Recebe, com as chefias, cada pedido de ajuda.">
          <input type="email" className={classeEntrada} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Campo>
      </div>
      <ErroLinha erro={acao.erro} />
      <Botao type="submit" tamanho="pequeno" icone={Save} className="w-fit" disabled={acao.aCorrer}>
        Guardar
      </Botao>
    </form>
  );
}

/** Avisos de emergência em massa: cheias, incêndios, cortes de água, calor extremo. */
export function PaginaEmergencias() {
  const { pode } = useSessao();
  const router = useRouter();
  const params = useSearchParams();
  const selecionada = params.get("id");
  const ver = pode("acao_social");
  const lista = useDados<{ emergencias: Resumo[]; aviso_cobertura: string }>(ver ? "/v1/painel/emergencias" : null);
  const config = useDados<Config>(ver ? "/v1/painel/emergencias/config" : null);
  const [verConfig, setVerConfig] = useState(false);
  const escolher = (id: string | null) =>
    router.replace(id ? `/painel/emergencias?id=${id}` : "/painel/emergencias", { scroll: false });
  const { recarregar } = lista;
  const haAtivas = !!lista.dados?.emergencias.some((e) => e.estado === "ativa");

  useEffect(() => {
    if (!haAtivas) return;
    const t = setInterval(recarregar, 15_000);
    return () => clearInterval(t);
  }, [haAtivas, recarregar]);

  if (!ver) {
    return (
      <>
        <CabecalhoPagina titulo="Avisos de emergência" />
        <SemAcesso />
      </>
    );
  }

  return (
    <div className="pb-10">
      <CabecalhoPagina
        migalhas={["Gestão", "Emergências"]}
        titulo="Avisos de emergência"
        descricao="SMS a todos os números conhecidos na zona e chamada do agente a quem mais precisa: está em segurança? precisa de ajuda para sair?"
        acoes={
          <div className="flex gap-2">
            {pode("agente") && (
              <Botao variante="discreto" tamanho="pequeno" icone={Settings} onClick={() => setVerConfig(true)}>
                Ritmo e proteção civil
              </Botao>
            )}
            {selecionada && (
              <Botao tamanho="pequeno" icone={Siren} onClick={() => escolher(null)}>
                Novo aviso
              </Botao>
            )}
          </div>
        }
      />
      <div className="grid items-start gap-6 px-10 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Cartao className="flex flex-col p-6">
          <h2 className="pb-3 font-display text-[19px] font-bold text-tinta">Avisos</h2>
          <Estado aCarregar={lista.aCarregar} erro={lista.erro} vazio={!lista.dados?.emergencias.length} textoVazio="Ainda não há avisos de emergência.">
            <ul>
              {lista.dados?.emergencias.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => escolher(e.id)}
                    className={`flex w-full flex-col gap-1 border-t border-linha px-2 py-3 text-left hover:bg-creme ${selecionada === e.id ? "bg-creme" : ""}`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-sm font-semibold text-tinta">{e.titulo}</span>
                      <Pilula tom={ESTADOS[e.estado].tom}>{ESTADOS[e.estado].rotulo}</Pilula>
                    </span>
                    <span className="text-xs text-tinta-3">
                      {GRAVIDADES[e.gravidade].rotulo} · {TIPOS[e.tipo]} · {e.zona_descricao}
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-tinta-2">
                      <span>
                        <Phone className="mr-1 inline size-3" aria-hidden />
                        {numero(e.estado === "rascunho" ? e.destinatarios_previstos : e.resumo.total)} números
                      </span>
                      {e.resumo.em_seguranca > 0 && <span className="text-verde">{numero(e.resumo.em_seguranca)} em segurança</span>}
                      {e.resumo.precisa_ajuda > 0 && (
                        <span className="font-semibold text-terracota">
                          {numero(e.resumo.precisa_ajuda)} {e.resumo.precisa_ajuda === 1 ? "precisa" : "precisam"} de ajuda
                          {e.resumo.por_tratar ? ` (${numero(e.resumo.por_tratar)} por tratar)` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Estado>
        </Cartao>

        <Cartao className="flex flex-col gap-4 p-6">
          {selecionada ? (
            <VerEmergencia key={selecionada} id={selecionada} onMudou={recarregar} />
          ) : (
            <>
              <h2 className="font-display text-[19px] font-bold text-tinta">Novo aviso de emergência</h2>
              {config.dados ? (
                <NovaEmergencia
                  config={config.dados}
                  onCriada={(id) => {
                    recarregar();
                    escolher(id);
                  }}
                />
              ) : (
                <Estado aCarregar={config.aCarregar} erro={config.erro} vazio={false}>
                  {null}
                </Estado>
              )}
            </>
          )}
        </Cartao>
      </div>

      <Dialogo titulo="Ritmo de envio e proteção civil" aberto={verConfig} onFechar={() => setVerConfig(false)}>
        {config.dados && verConfig && (
          <Configuracao
            config={config.dados}
            onGuardado={() => {
              setVerConfig(false);
              config.recarregar();
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
