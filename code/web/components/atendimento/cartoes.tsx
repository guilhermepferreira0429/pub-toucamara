/** Cartão de número dos Indicadores (valor grande, rótulo e detalhe colorido). */
export function CartaoNumero({
  valor,
  rotulo,
  detalhe,
  corDetalhe = "text-tinta-2",
  escuro,
}: {
  valor: string;
  rotulo: string;
  detalhe?: string | null;
  corDetalhe?: string;
  escuro?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl p-5 ${
        escuro ? "bg-tinta" : "border border-linha bg-papel"
      }`}
    >
      <p
        className={`font-display text-[32px] font-bold tracking-[-1px] ${
          escuro ? "text-white" : "text-tinta"
        }`}
      >
        {valor}
      </p>
      <p className={`text-[13px] font-semibold ${escuro ? "text-white/80" : "text-tinta"}`}>
        {rotulo}
      </p>
      {detalhe && <p className={`text-xs ${corDetalhe}`}>{detalhe}</p>}
    </div>
  );
}

/** Barra empilhada com legenda (Canal, Resultado). */
export function BarraEmpilhada({
  titulo,
  partes,
}: {
  titulo: string;
  partes: { rotulo: string; valor: number; cor: string }[];
}) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const visiveis = partes.filter((p) => p.valor > 0);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.8px] text-tinta-3">{titulo}</h3>
      <div className="flex h-3 overflow-hidden rounded-md bg-creme-2" aria-hidden>
        {visiveis.map((p) => (
          <span
            key={p.rotulo}
            className={p.cor}
            style={{ width: `${(p.valor / (total || 1)) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {(visiveis.length ? visiveis : partes).map((p) => (
          <li key={p.rotulo} className="flex items-center gap-2 text-[13px]">
            <span className={`size-2.5 shrink-0 rounded-[3px] ${p.cor}`} aria-hidden />
            <span className="flex-1 text-tinta">{p.rotulo}</span>
            <span className="font-bold text-tinta">
              {total ? `${Math.round((p.valor / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
