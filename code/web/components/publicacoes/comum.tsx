"use client";

import { BellRing, BellOff, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { CartaoItem } from "@/components/agora/feed";
import type { ItemAgora } from "@/components/agora/tipos";
import { comoErro, numero, Pilula } from "@/components/conhecimento/comum";
import type { ErroApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";
import { juntarComE, type Abrangidos, type PedidoAbrangidos } from "./tipos";

/*
 * Peças dos formulários de comunicados e eventos: campo com erro associado,
 * pré-visualização do item no /agora e o aviso honesto sobre os SMS.
 */

/** Campo com rótulo, ajuda e erro ligados ao controlo (aria-describedby). */
export function CampoForm({
  id,
  rotulo,
  ajuda,
  erro,
  opcional,
  children,
  className = "",
}: {
  id: string;
  rotulo: string;
  ajuda?: React.ReactNode;
  erro?: string;
  opcional?: boolean;
  /** Recebe os atributos a pôr no controlo. */
  children: (a: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
  className?: string;
}) {
  const desc = [ajuda ? `${id}-ajuda` : null, erro ? `${id}-erro` : null].filter(Boolean).join(" ");
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-semibold text-tinta">
        {rotulo}
        {opcional && <span className="font-normal text-tinta-3"> (opcional)</span>}
      </label>
      {children({ id, "aria-invalid": !!erro, "aria-describedby": desc || undefined })}
      {ajuda && (
        <span id={`${id}-ajuda`} className="text-xs text-tinta-3">
          {ajuda}
        </span>
      )}
      {erro && (
        <span id={`${id}-erro`} className="text-xs font-semibold text-terracota-escuro">
          {erro}
        </span>
      )}
    </div>
  );
}

/** Contorno a terracota no controlo com erro. */
export function comErro(classe: string, erro?: string): string {
  return erro ? `${classe} border-terracota` : classe;
}

/** O item como aparece no /agora (o mesmo cartão do feed, sem link). */
export function PreVisualizacao({ item, slug }: { item: ItemAgora; slug: string }) {
  return (
    <section aria-labelledby="previa-titulo" className="flex flex-col gap-2">
      <h3 id="previa-titulo" className="flex items-center gap-1.5 text-[13px] font-semibold text-tinta">
        <Eye className="size-4 text-tinta-3" aria-hidden />
        Assim aparece no /agora
      </h3>
      {/* inert: é só para ver (o link do cartão ainda não existe). */}
      <ul inert className="rounded-2xl bg-creme p-3">
        <CartaoItem item={item} slug={slug} novoHoras={48} />
      </ul>
      {item.imagem && (
        // eslint-disable-next-line @next/next/no-img-element -- endereço externo escolhido pela câmara
        <img src={item.imagem} alt="Imagem do comunicado (pré-visualização)" className="max-h-40 rounded-xl object-cover" />
      )}
    </section>
  );
}

/** Quantas subscrições "avise-me" o item abrangeria (POST /painel/agora/abrangidos). */
export function useAbrangidos(p: PedidoAbrangidos | null) {
  const { pedido } = useSessao();
  const chave = p ? JSON.stringify(p) : "";
  const [r, setR] = useState<{ chave: string; dados?: Abrangidos; erro?: ErroApi }>({ chave: "" });
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const t = setTimeout(() => {
      pedido<Abrangidos>("/v1/painel/agora/abrangidos", { metodo: "POST", corpo: JSON.parse(chave) }).then(
        (dados) => vivo && setR({ chave, dados }),
        (e: unknown) => vivo && setR({ chave, erro: comoErro(e) }),
      );
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [chave, pedido]);
  return { dados: r.dados, erro: r.chave === chave ? r.erro : undefined, aCarregar: !!chave && r.chave !== chave };
}

function plural(n: number, um: string, varios: string) {
  return `${numero(n)} ${n === 1 ? um : varios}`;
}

/**
 * Quem é avisado quando se publica (as regras do job das subscrições em
 * agora.subscricoes.ts / agora.regras.ts › correspondeSubscricao).
 */
export function AvisoSms({
  pedidoAbr,
  jaPublicado,
}: {
  pedidoAbr: PedidoAbrangidos | null;
  /** Já foi publicado antes: quem já recebeu não recebe outra vez. */
  jaPublicado?: boolean;
}) {
  const a = useAbrangidos(pedidoAbr);
  const d = a.dados;
  const evento = pedidoAbr?.fonte === "evento";
  const assunto = evento ? "eventos" : "avisos e comunicados";

  let titulo: string;
  let texto: React.ReactNode;
  let avisa = false;
  if (!d) {
    titulo = "Quem é avisado por SMS";
    texto = a.erro ? a.erro.message : "A contar as subscrições…";
  } else if (d.motivo === "noticia") {
    titulo = "As notícias não enviam SMS";
    texto = "Aparece no /agora para toda a gente, mas ninguém recebe aviso por SMS.";
  } else if (d.motivo === "todo_concelho") {
    titulo = "Para todo o concelho: não envia SMS";
    texto = evento
      ? "Sem ponto no mapa nem freguesia, o evento é de todo o concelho: aparece no /agora, mas não avisa ninguém. Marque o ponto ou a freguesia para avisar quem vive perto."
      : "Os comunicados para todo o concelho não enviam SMS (só os alertas e as emergências da Proteção Civil o fazem). Escolha as freguesias para avisar quem lá vive.";
  } else {
    avisa = d.pessoas > 0;
    const onde =
      pedidoAbr?.fonte === "comunicado"
        ? `em ${juntarComE(pedidoAbr.freguesias ?? [])}`
        : [
            pedidoAbr?.fonte === "evento" && pedidoAbr.lat !== null
              ? `pela rua até ${d.parametros.raio_subscricao_m} m deste ponto`
              : null,
            pedidoAbr?.fonte === "evento" && pedidoAbr.freguesia ? `na freguesia ${pedidoAbr.freguesia}` : null,
          ]
            .filter(Boolean)
            .join(" ou ");
    titulo = d.subscricoes
      ? `Avisa ${plural(d.pessoas, "pessoa", "pessoas")} ao publicar`
      : "Ninguém subscreveu esta zona (ainda)";
    texto = (
      <>
        Recebem aviso as pessoas que pediram «avise-me» de {assunto} {onde}: neste momento{" "}
        {plural(d.subscricoes, "subscrição", "subscrições")}
        {d.subscricoes !== d.pessoas && d.subscricoes > 0
          ? ` de ${plural(d.pessoas, "pessoa que aceita", "pessoas diferentes que aceitam")} avisos (quem respondeu PARAR não recebe)`
          : ""}
        . O aviso sai em poucos minutos, das 9h às 21h, por SMS ou na app de quem a tiver; no máximo{" "}
        {d.parametros.max_avisos_por_corrida} avisos de cada vez por pessoa.
        {jaPublicado
          ? " Quem já recebeu o aviso deste item não o recebe outra vez."
          : " Editar depois de publicado não envia outro aviso."}
      </>
    );
  }
  const Icone = avisa ? BellRing : BellOff;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border p-3 text-[13px] ${
        avisa ? "border-ambar/40 bg-ambar-suave/60" : "border-linha bg-creme"
      }`}
      aria-live="polite"
    >
      <Icone className="mt-0.5 size-4 shrink-0 text-tinta-2" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-tinta">{titulo}</p>
        <p className="text-tinta-2">{texto}</p>
        {d?.parametros.demonstracao && d.motivo === "zona" && (
          <Pilula className="w-fit">valores de demonstração (raio e horário dos avisos)</Pilula>
        )}
      </div>
    </div>
  );
}
