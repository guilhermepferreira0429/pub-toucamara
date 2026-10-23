import type { MetadataRoute } from "next";

/** Para "Adicionar ao ecrã principal": o nome e o balão com "?" da marca. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tou, Câmara?",
    short_name: "Tou, Câmara?",
    description: "A câmara inteira, numa só plataforma.",
    lang: "pt-PT",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f0e4",
    theme_color: "#b84a24",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icones/icone-mascara-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
