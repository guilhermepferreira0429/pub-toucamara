import { Cat, Dog } from "lucide-react";

/** Claro ou escuro? (para o ícone se ver em cima da cor do animal). */
function eClaro(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/**
 * O "retrato" de um animal sem fotografias externas: um círculo na cor do
 * pelo, com orelhas desenhadas em CSS e o ícone da espécie por cima.
 */
export function RetratoAnimal({
  especie,
  cor,
  tamanho = 96,
}: {
  especie: string;
  cor: string | null;
  tamanho?: number;
}) {
  const fundo = cor ?? "#b7793f";
  const claro = eClaro(fundo);
  const Icone = especie === "gato" ? Cat : Dog;
  const orelha = Math.round(tamanho * 0.3);
  return (
    <div
      className="relative shrink-0"
      style={{ width: tamanho, height: tamanho }}
      aria-hidden
    >
      {/* Orelhas: pontiagudas no gato, caídas no cão. */}
      {[-1, 1].map((lado) => (
        <span
          key={lado}
          className="absolute"
          style={{
            width: orelha,
            height: orelha,
            top: especie === "gato" ? -orelha * 0.15 : orelha * 0.1,
            left: lado < 0 ? tamanho * 0.08 : undefined,
            right: lado > 0 ? tamanho * 0.08 : undefined,
            background: fundo,
            filter: "brightness(0.85)",
            borderRadius: especie === "gato" ? "4px 60% 4px 60%" : "50% 50% 50% 50% / 30% 30% 70% 70%",
            transform: `rotate(${lado * (especie === "gato" ? 45 : 25)}deg)`,
          }}
        />
      ))}
      <div
        className="absolute inset-0 flex items-center justify-center rounded-full border-4 border-papel shadow-sm"
        style={{ background: fundo }}
      >
        <Icone
          style={{ width: tamanho * 0.45, height: tamanho * 0.45 }}
          className={claro ? "text-tinta" : "text-white"}
          strokeWidth={1.6}
        />
      </div>
    </div>
  );
}
