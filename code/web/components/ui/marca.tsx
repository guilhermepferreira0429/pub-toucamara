import { BadgeCheck } from "lucide-react";

/** O logótipo: o nome com o ponto de interrogação num balão de fala. */
export function Logo({ tamanho = 28 }: { tamanho?: number }) {
  const balao = Math.round(tamanho * 1.07);
  return (
    <span className="inline-flex items-center gap-1" aria-label="Tou, Câmara?">
      <span
        className="font-display font-extrabold text-tinta"
        style={{ fontSize: tamanho, letterSpacing: tamanho * -0.028 }}
      >
        Tou, Câmara
      </span>
      <span
        aria-hidden
        className="inline-flex items-center justify-center bg-terracota font-display font-extrabold text-white"
        style={{
          width: balao,
          height: balao,
          borderRadius: `${balao / 2}px ${balao / 2}px ${balao / 2}px 3px`,
          fontSize: balao * 0.7,
        }}
      >
        ?
      </span>
    </span>
  );
}

/** "Fonte oficial": de onde vem a resposta, com a data em que foi verificada. */
export function FonteOficial({
  documento,
  data,
  url,
}: {
  documento: string;
  data?: string;
  url?: string | null;
}) {
  const conteudo = (
    <>
      <BadgeCheck className="mt-0.5 size-4 shrink-0 text-verde" aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-bold tracking-[0.8px] text-verde">
          FONTE OFICIAL
        </span>
        <span className="text-[13px] font-medium leading-[1.35] text-tinta">
          {documento}
        </span>
        {data && <span className="text-[11px] text-verde">{data}</span>}
      </span>
    </>
  );
  const classe =
    "flex w-full gap-2.5 rounded-[10px] bg-verde-suave px-3 py-2.5 text-left";
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={classe}>
      {conteudo}
    </a>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}
