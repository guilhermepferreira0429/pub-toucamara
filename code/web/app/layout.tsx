import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Inter,
  JetBrains_Mono,
  Source_Serif_4,
} from "next/font/google";
import { SCRIPT_PREFERENCIAS } from "@/lib/acessibilidade";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const DESCRICAO =
  "O atendimento municipal que nunca está ocupado: telefone, chat, SMS e app, só com informação oficial, e um painel para a câmara.";

export const metadata: Metadata = {
  // Os links absolutos (imagem de partilha) usam o endereço público do site.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://toucamara.descortina.pt"),
  title: { default: "Tou, Câmara?", template: "%s · Tou, Câmara?" },
  description: DESCRICAO,
  applicationName: "Tou, Câmara?",
  appleWebApp: { title: "Tou, Câmara?", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    locale: "pt_PT",
    siteName: "Tou, Câmara?",
    title: "Tou, Câmara? · A câmara que atende",
    description: DESCRICAO,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#b84a24",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-PT"
      // As opções de leitura do munícipe (letra, contraste) mudam data-* no
      // <html> antes de o React arrancar.
      suppressHydrationWarning
      className={`${bricolage.variable} ${inter.variable} ${sourceSerif.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_PREFERENCIAS }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
