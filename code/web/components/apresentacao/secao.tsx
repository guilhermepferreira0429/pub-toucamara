import type { LucideIcon } from "lucide-react";

/** Uma secção das páginas de apresentação: rótulo, título, subtítulo e conteúdo. */
export function Secao({
  id,
  rotulo,
  titulo,
  sub,
  children,
  fundo = "",
}: {
  id: string;
  rotulo: string;
  titulo: string;
  sub?: string;
  children: React.ReactNode;
  fundo?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={`scroll-mt-20 ${fundo}`}>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-5 py-20 sm:px-8 lg:py-24">
        <div className="flex max-w-[720px] flex-col gap-3">
          <span className="text-[13px] font-bold uppercase tracking-[1.4px] text-terracota">{rotulo}</span>
          <h2
            id={`${id}-titulo`}
            className="font-display text-[32px] font-extrabold leading-[1.1] tracking-[-0.8px] text-tinta sm:text-[40px]"
          >
            {titulo}
          </h2>
          {sub && <p className="text-[17px] leading-relaxed text-tinta-2">{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Lista({ itens, icone: Icone, cor }: { itens: string[]; icone: LucideIcon; cor: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {itens.map((t) => (
        <li key={t} className="flex gap-3 text-[15px] leading-relaxed text-tinta-2">
          <Icone className={`mt-1 size-4 shrink-0 ${cor}`} aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
