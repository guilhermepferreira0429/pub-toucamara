"use client";

import {
  ArrowRight,
  Camera,
  Check,
  CircleAlert,
  Clock,
  FlaskConical,
  Info,
  PenLine,
} from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { Botao } from "@/components/ui/botao";
import { dataLonga, nomeIdioma } from "./formatar";
import {
  ACarregar,
  Cabecalho,
  ErroCarregar,
  LinkInvalido,
  MaisDuvidas,
  Nota,
  Rotulo,
  Topo,
} from "./moldura";
import { mensagemDe, usePublico } from "./use-publico";
import {
  type DocumentosRequerimento,
  VerificarDocumento,
} from "./verificar-documento";

type Estado = "a_preencher" | "pronto" | "assinado" | "entregue" | "cancelado";

interface RequerimentoPublico {
  municipio: string;
  requerente: { nome: string | null };
  estado: Estado;
  tipo: { codigo: string; nome: string };
  idioma_conversa: string;
  campos: {
    chave: string;
    rotulo: string;
    obrigatorio: boolean;
    valor: string | null;
  }[];
  campos_originais: { chave: string; rotulo: string; valor: string | null }[] | null;
  campos_em_falta: { chave: string; rotulo: string }[];
  documentos: DocumentosRequerimento;
  assinatura: { tipo: string | null; simulada: boolean; assinado_em: string | null };
  processo: { numero: string } | null;
  pode_assinar: boolean;
  aviso: string;
}

interface ResultadoAssinatura {
  estado: "entregue";
  assinatura_simulada: boolean;
  ja_estava_entregue: boolean;
  processo: { numero: string; fase: string; prazo_fim: string | null; link: string };
}

const MOTIVO_FALTA: Record<string, string> = {
  fora_de_prazo: "a última foto estava fora de prazo",
  documento_errado: "a última foto não servia",
  ilegivel: "a última foto não se lia bem",
};

/** "O QUE JÁ TEM E O QUE FALTA", com o botão de fotografar cada um. */
export function ListaDocumentos({
  documentos,
  onFotografar,
}: {
  documentos: DocumentosRequerimento;
  onFotografar: (id: string | null) => void;
}) {
  const { tem, por_verificar, faltam } = documentos;
  const entregues = tem.length + por_verificar.length;
  const total = entregues + faltam.length;
  if (total === 0) return null;
  return (
    <section
      aria-labelledby="docs"
      className="flex w-full flex-col rounded-2xl border border-linha bg-papel px-4 py-3.5"
    >
      <div className="flex items-center justify-between pb-2">
        <Rotulo id="docs">O que já tem e o que falta</Rotulo>
        <span
          className={`text-[13px] font-bold ${faltam.length ? "text-ambar" : "text-verde"}`}
        >
          {entregues} de {total}
        </span>
      </div>
      <ul className="flex flex-col">
        {tem.map((d) => (
          <LinhaDocumento key={d.id} nome={d.nome} detalhe="verificado, está válido" tipo="tem" />
        ))}
        {por_verificar.map((d) => (
          <LinhaDocumento
            key={d.id}
            nome={d.nome}
            detalhe="entregue, a câmara ainda vai ver"
            tipo="por_verificar"
          />
        ))}
        {faltam.map((d) => (
          <LinhaDocumento
            key={d.id}
            nome={d.nome}
            detalhe={
              d.ultima_verificacao
                ? `em falta: ${MOTIVO_FALTA[d.ultima_verificacao]}`
                : d.obrigatorio
                  ? "em falta"
                  : "em falta (não é obrigatório)"
            }
            tipo="falta"
            acao={
              <button
                type="button"
                onClick={() => onFotografar(d.id)}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-tinta px-3.5 text-[14px] font-semibold text-white hover:bg-tinta/90"
              >
                <Camera className="size-4" aria-hidden />
                Fotografar
                <span className="sr-only">: {d.nome}</span>
              </button>
            }
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onFotografar(null)}
        className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-terracota text-[15px] font-semibold text-terracota-escuro hover:bg-terracota-suave/40"
      >
        <Camera className="size-4" aria-hidden />
        Verificar {faltam.length ? "um" : "outro"} documento por foto
      </button>
    </section>
  );
}

function LinhaDocumento({
  nome,
  detalhe,
  tipo,
  acao,
}: {
  nome: string;
  detalhe: string;
  tipo: "tem" | "por_verificar" | "falta";
  acao?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 border-b border-linha py-2.5 last:border-b-0">
      <span
        aria-hidden
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-full ${
          tipo === "tem" ? "bg-verde" : tipo === "por_verificar" ? "bg-creme-2" : "bg-ambar-suave"
        }`}
      >
        {tipo === "tem" && <Check className="size-3 text-white" strokeWidth={3} />}
        {tipo === "por_verificar" && <Clock className="size-3 text-tinta-2" strokeWidth={2.5} />}
        {tipo === "falta" && <CircleAlert className="size-3 text-ambar" strokeWidth={2.5} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold text-tinta">{nome}</span>
        <span
          className={`text-[13px] ${tipo === "falta" ? "text-ambar" : "text-tinta-3"}`}
        >
          {detalhe}
        </span>
      </span>
      {acao}
    </li>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-linha py-2 first:border-t-0">
      <dt className="text-[12px] text-tinta-3">{rotulo}</dt>
      <dd
        className={`font-serif text-[15px] leading-[1.4] ${valor ? "text-tinta" : "text-ambar italic"}`}
      >
        {valor ?? "por preencher"}
      </dd>
    </div>
  );
}

/** 09 · Requerimento · Rever e assinar (link do SMS, pelo token). */
export function Requerimento({ token }: { token: string }) {
  const caminho = `/v1/public/requerimentos/${encodeURIComponent(token)}`;
  const { c, definir, recarregar, tentarOutraVez } =
    usePublico<RequerimentoPublico>(caminho);
  const [verificar, setVerificar] = useState<{ inicial: string | null } | null>(null);
  const [assinando, setAssinando] = useState(false);
  const [erroAssinar, setErroAssinar] = useState<string | null>(null);
  const [assinado, setAssinado] = useState<ResultadoAssinatura | null>(null);

  const dados = c.estado === "ok" ? c.dados : null;
  const aoVerificar = useCallback(
    (documentos: DocumentosRequerimento) => {
      if (dados) definir({ ...dados, documentos });
    },
    [dados, definir],
  );
  const fecharVerificar = useCallback(() => setVerificar(null), []);

  if (c.estado === "a_carregar") return <ACarregar />;
  if (c.estado === "invalido") return <LinkInvalido />;
  if (c.estado === "erro")
    return <ErroCarregar mensagem={c.mensagem} onTentar={tentarOutraVez} />;

  const r = c.dados;
  const entregue = r.estado === "entregue" || r.estado === "assinado";
  const idioma = nomeIdioma(r.idioma_conversa);
  const numeroProcesso = assinado?.processo.numero ?? r.processo?.numero ?? null;

  async function assinar() {
    setAssinando(true);
    setErroAssinar(null);
    try {
      const res = await api<ResultadoAssinatura>(`${caminho}/assinar`, {
        metodo: "POST",
      });
      setAssinado(res);
      await recarregar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErroAssinar(mensagemDe(e));
    } finally {
      setAssinando(false);
    }
  }

  const docsParaFoto = [
    ...r.documentos.faltam.map((d) => ({ id: d.id, nome: d.nome, detalhe: "em falta" })),
    ...r.documentos.por_verificar.map((d) => ({ id: d.id, nome: d.nome, detalhe: "por verificar" })),
    ...r.documentos.tem.map((d) => ({ id: d.id, nome: d.nome, detalhe: "já verificado" })),
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <Topo direita={r.municipio} />

      {entregue ? (
        <Cabecalho
          meta={r.tipo.nome}
          titulo="O seu requerimento foi entregue."
          sub={
            numeroProcesso
              ? `Deu entrada na câmara como processo ${numeroProcesso}. Avisamos por SMS quando houver novidades.`
              : "Deu entrada na câmara. Avisamos por SMS quando houver novidades."
          }
        />
      ) : r.estado === "a_preencher" ? (
        <Cabecalho
          meta={r.tipo.nome}
          titulo="Ainda faltam alguns dados."
          sub={`Para o requerimento ficar pronto falta: ${r.campos_em_falta.map((x) => x.rotulo.toLowerCase()).join(", ")}. Ligue-nos ou escreva no chat para completar.`}
        />
      ) : (
        <Cabecalho
          meta={r.tipo.nome}
          titulo="O seu requerimento está pronto."
          sub="Preenchemos durante a chamada. Confirme se está tudo certo."
        />
      )}

      {entregue && r.assinatura.assinado_em && (
        <Nota icone={Check} tom="verde" papel="status">
          Assinado a {dataLonga(r.assinatura.assinado_em)}
          {r.assinatura.simulada &&
            ". A assinatura foi simulada: é uma demonstração, sem valor legal."}
        </Nota>
      )}
      {assinado?.processo.link && (
        <a
          href={assinado.processo.link}
          className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-terracota px-6 text-[17px] font-semibold text-white hover:bg-terracota-escuro"
        >
          Ver o processo
          <ArrowRight className="size-5" aria-hidden />
        </a>
      )}

      <section
        aria-label="O requerimento"
        className="flex w-full flex-col gap-2 rounded-xl border border-linha bg-white p-4"
      >
        <p className="font-serif text-[13px] font-bold tracking-[1px] text-tinta">
          REQUERIMENTO
        </p>
        <dl className="flex flex-col">
          {r.requerente.nome && <Campo rotulo="Requerente" valor={r.requerente.nome} />}
          {r.campos
            .filter((x) => x.valor !== null || x.obrigatorio)
            .map((x) => (
              <Campo key={x.chave} rotulo={x.rotulo} valor={x.valor} />
            ))}
        </dl>
        {r.campos_originais && (
          <details className="group border-t border-linha pt-2">
            <summary className="cursor-pointer py-1 text-[14px] font-semibold text-terracota-escuro">
              Ver como disse{idioma ? ` (em ${idioma})` : ""}
            </summary>
            <p className="pt-1 pb-2 text-[13px] text-tinta-3">
              Escrevemos o requerimento em português. Estes são os valores como os disse.
            </p>
            <dl className="flex flex-col">
              {r.campos_originais.map((x) => (
                <Campo key={x.chave} rotulo={x.rotulo} valor={x.valor} />
              ))}
            </dl>
          </details>
        )}
      </section>

      <ListaDocumentos
        documentos={r.documentos}
        onFotografar={(id) => setVerificar({ inicial: id })}
      />

      {r.pode_assinar && !entregue && (
        <div className="flex w-full flex-col gap-3">
          <Nota icone={FlaskConical} tom="ambar">
            <strong className="font-semibold">{r.aviso}</strong> A Chave Móvel Digital
            exige credenciação na AMA; até lá a entrega não tem validade legal.
          </Nota>
          {erroAssinar && (
            <Nota icone={Info} tom="terracota" papel="alert">
              {erroAssinar}
            </Nota>
          )}
          <Botao
            tamanho="grande"
            icone={PenLine}
            className="w-full"
            disabled={assinando}
            onClick={assinar}
          >
            {assinando ? "A assinar…" : "Assinar com Chave Móvel Digital"}
          </Botao>
        </div>
      )}

      {r.estado === "a_preencher" && <MaisDuvidas titulo="Completar o requerimento" nota={null} />}
      {r.estado !== "a_preencher" && (
        <MaisDuvidas
          titulo="Alguma coisa não está certa?"
          nota="Pode corrigir qualquer dado pelo telefone ou no chat."
        />
      )}

      {verificar && (
        <VerificarDocumento
          token={token}
          documentos={docsParaFoto}
          inicial={verificar.inicial}
          onFechar={fecharVerificar}
          onVerificado={aoVerificar}
        />
      )}
    </div>
  );
}
