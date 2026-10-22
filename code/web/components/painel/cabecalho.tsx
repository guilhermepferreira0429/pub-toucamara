/**
 * Cabeçalho das páginas do painel: migalhas, título e ações à direita
 * (como no design: "ATENDIMENTO / HOJE", título grande em Bricolage).
 */
export function CabecalhoPagina({
  migalhas,
  titulo,
  descricao,
  acoes,
}: {
  migalhas?: string[];
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-10 sm:pt-8 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {migalhas && (
          <p className="text-[11px] font-bold tracking-[0.6px] text-tinta-3">
            {migalhas.map((m, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5">/</span>}
                <span className={i === migalhas.length - 1 ? "text-terracota" : ""}>
                  {m.toUpperCase()}
                </span>
              </span>
            ))}
          </p>
        )}
        <h1 className="font-display text-[26px] font-bold leading-tight text-balance text-tinta sm:text-[32px]">
          {titulo}
        </h1>
        {descricao && <div className="text-sm text-tinta-2">{descricao}</div>}
      </div>
      {acoes && <div className="flex min-w-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}

/** Estado de erro/vazio comum (mensagem da API já em português). */
export function Aviso({
  titulo,
  children,
  tom = "neutro",
}: {
  titulo: string;
  children?: React.ReactNode;
  tom?: "neutro" | "erro";
}) {
  return (
    <div
      className={`mx-4 rounded-xl sm:mx-10 border p-5 text-sm ${
        tom === "erro"
          ? "border-terracota/30 bg-terracota-suave/40 text-terracota-escuro"
          : "border-linha bg-papel text-tinta-2"
      }`}
    >
      <p className="font-semibold text-tinta">{titulo}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}
