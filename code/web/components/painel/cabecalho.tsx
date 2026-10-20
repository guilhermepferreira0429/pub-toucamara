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
    <header className="flex flex-wrap items-end justify-between gap-4 px-10 pb-6 pt-8">
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
        <h1 className="font-display text-[32px] font-bold leading-tight text-tinta">
          {titulo}
        </h1>
        {descricao && <div className="text-sm text-tinta-2">{descricao}</div>}
      </div>
      {acoes && <div className="flex items-center gap-2">{acoes}</div>}
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
      className={`mx-10 rounded-xl border p-5 text-sm ${
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
