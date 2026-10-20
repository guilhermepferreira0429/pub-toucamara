import { MolduraConhecimento } from "@/components/conhecimento/moldura";

/** Conhecimento: título e separadores comuns às subpáginas. */
export default function LayoutConhecimento({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MolduraConhecimento>{children}</MolduraConhecimento>;
}
