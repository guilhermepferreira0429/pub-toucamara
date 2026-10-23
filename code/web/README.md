# Tou, Câmara? · web

Interface web (Next.js 16, React 19, Tailwind 4): a página de apresentação, o chat e a chamada no browser, as páginas que os links do SMS abrem e o painel da câmara. Fala só com a API central (`code/api`).

Em produção: [toucamara.descortina.pt](https://toucamara.descortina.pt).

## Correr

```bash
cp .env.example .env.local   # e preencher (ver abaixo)
bun install
bun dev                      # http://localhost:3000, com a API em NEXT_PUBLIC_API_URL
```

| Comando | O que faz |
|---|---|
| `bun dev` | Servidor de desenvolvimento |
| `bun run build` / `bun run start` | Build e servidor de produção |
| `bun run lint` | ESLint |
| `bun run a11y` | Verificação de acessibilidade das páginas (`scripts/acessibilidade.mts`) |

As variáveis `NEXT_PUBLIC_*` ficam no build: depois de as mudar é preciso voltar a fazer `build`.

## Variáveis (`.env.example`)

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_API_URL` | Endereço da API central |
| `NEXT_PUBLIC_MUNICIPIO`, `NEXT_PUBLIC_MUNICIPIO_NOME` | Município do site (chat e chamada no browser) |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Agente de voz da chamada no browser (`/ligar`) |
| `NEXT_PUBLIC_TELEFONE_CAMARA` | Linha da câmara mostrada na chamada |
| `NEXT_PUBLIC_SITE_URL` | Endereço público (QR code do `/ligar/qr` e imagem de partilha) |
| `NEXT_PUBLIC_APK_URL`, `NEXT_PUBLIC_VIDEO_URL` | Cartões da app e do vídeo na página de apresentação (vazios, não aparecem) |
| `NEXT_PUBLIC_ACESSIBILIDADE_*`, `NEXT_PUBLIC_LGP_*` | Contacto de acessibilidade e vídeos/videochamada em Língua Gestual Portuguesa |
| `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_MAPBOX_ESTILO` | Mapas com Mapbox; vazio, usa Leaflet e OpenStreetMap (ver `docs/MAPAS.md`) |

## Rotas

| Rota | O que é |
|---|---|
| `/` | Apresentação do projeto, com os links para experimentar |
| `/ligar` | Chamada ao agente pelo browser (basta autorizar o microfone); `/ligar/qr` mostra o QR code |
| `/chat` | Chat com o agente |
| `/avaliacao` | Resultados públicos do avaliador: cada pergunta, a resposta, a resposta certa e o veredicto |
| `/regras`, `/agora/[municipio]`, `/visitar` | Regras públicas das licenças, o que se passa perto de si, turismo |
| `/resumo/[codigo]`, `/processo/…`, `/requerimento/…`, `/ocorrencia/…`, `/marcacao/…`, `/pagamento/…`, … | Páginas que os links do SMS abrem (em `app/(municipe)`) |
| `/entrar` | Entrada no painel por link mágico; `/entrar?juri=<chave>` é o acesso do júri, só de leitura |
| `/painel/*` | Painel da câmara: conversas, entrada, processos, ocorrências, licenças, conhecimento, emergências, relatórios… |

## Estrutura

- `app/`: as rotas (App Router). Os ícones e a imagem de partilha estão em `app/` (`icon.svg`, `favicon.ico`, `apple-icon.png`, `opengraph-image.png`, `manifest.ts`).
- `components/`: um diretório por área (`apresentacao`, `atendimento`, `processos`, `conhecimento`, `emergencias`…), mais `ui/` e `painel/`.
- `lib/`: sessão do painel (`sessao.tsx`), pedidos à API e acessibilidade.
