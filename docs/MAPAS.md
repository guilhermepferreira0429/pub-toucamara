# Mapas (web e apps)

Todos os mapas do projeto passam por um componente base com uma só API e dois motores:

| | Com token do Mapbox | Sem token (ou se o Mapbox falhar) |
|---|---|---|
| **Web** (`code/web/components/mapa/`) | Mapbox GL JS v3, estilo Standard, 3D (edifícios, vista oblíqua) | Leaflet + OpenStreetMap, 2D (como antes) |
| **Apps** (`code/mobile/lib/comum/mapa/`) | Android com `MAPA_NATIVO=true`: `mapbox_maps_flutter` (3D nativo). De resto: `flutter_map` com mosaicos do Mapbox (2D) | `flutter_map` + OpenStreetMap |

A lista ao lado (ou o texto da página) continua a ser a alternativa acessível a qualquer mapa.

## Configurar

### Token público (web e apps)

1. Em <https://account.mapbox.com/access-tokens/>, criar um token **público** (começa por `pk.`), só com os *scopes* públicos por omissão.
2. **Restringir o token por URL** (secção "URL restrictions"): os domínios da demo (ex.: `https://toucamara.pt`, `https://*.toucamara.pt`) e, para desenvolvimento, `http://localhost:3000`. Um token público vai no código que chega ao browser: a restrição impede que outros sites o usem à nossa conta. As restrições por URL não se aplicam às apps Android (não mandam *Referer*); para as apps, usar um token próprio e vigiar o uso no dashboard.
3. Pôr o token só em variáveis de ambiente, **nunca no repositório**:
   - web: `NEXT_PUBLIC_MAPBOX_TOKEN=pk.…` no `.env` da web (documentado no `code/web/.env.example`). É lido no build (`next build`): mudar o token obriga a voltar a construir;
   - apps: `--dart-define=MAPBOX_TOKEN=pk.…` no `flutter run`/`flutter build`.

Um token que não comece por `pk.` é ignorado (um token secreto `sk.` nunca deve ir para o browser nem para a app).

### Token secreto (só para builds Android, se for preciso)

O `mapbox_maps_flutter` 3.x descarrega o SDK Android do repositório Maven público do Mapbox, sem credenciais. Versões antigas (e algumas configurações) pediam um token secreto com o scope `DOWNLOADS:READ` (`MAPBOX_DOWNLOADS_TOKEN` / `SDK_REGISTRY_TOKEN`): se for o caso, vai no `~/.gradle/gradle.properties` da máquina que gera o APK (ou numa variável de ambiente da CI), **nunca** no `code/mobile/android/gradle.properties` nem no repositório.

### Estilos

- Web: `NEXT_PUBLIC_MAPBOX_ESTILO` = `standard` (por omissão), `standard-satellite` ou um URL `mapbox://styles/…`.
  - **Standard** (escolhido por omissão): edifícios 3D, luz de dia e cores que se ajustam à marca pela *config* do estilo (`components/mapa/config.ts`, `CONFIG_STANDARD`: verdes, água, estradas em creme, realces em terracota). As propriedades que o estilo não conhecer são ignoradas.
  - **Standard Satellite**: o aspeto fotográfico das referências, mas sem as cores da marca.
- Apps: `MAPBOX_ESTILO` (mapa 3D nativo, mesmos nomes) e `MAPBOX_ESTILO_RASTER` (mosaicos 2D do flutter_map, por omissão `streets-v12`; o Standard não existe em mosaicos raster).

### Vistas

- Munícipe: 3D por omissão (inclinação 58°, rotação −17°), com relevo (DEM do Mapbox) no 3D.
- Painel (trabalho): 2D por omissão (ou ligeiramente inclinado nos mapas pequenos), com o botão **3D**.
- Botões redondos em vidro: 3D, bússola (aponta para norte), "onde estou" e zoom.
- `prefers-reduced-motion` (web) e "remover animações" (Android): a câmara salta em vez de voar e as emergências deixam de pulsar.
- No telemóvel, um mapa dentro de uma página com scroll usa gestos cooperativos (dois dedos para mexer); o ecrã inteiro do `/agora` não.

## Onde cada mapa é usado

### Web (`MapaCidade`, `components/mapa/mapa-cidade.tsx`)

| Ecrã | Ficheiro | Vista |
|---|---|---|
| `/agora/[municipio]?ver=mapa` — mapa a ecrã inteiro: chips em vidro com contagens, bolhas por item, emergências a pulsar, "perto de mim", detalhe em folha (telemóvel) ou painel lateral (ecrã largo) | `components/agora/ecra-mapa.tsx`, `marcadores.tsx` | 3D |
| `/agora/[municipio]/[tipo]/[id]` — o sítio do item (zona em volume no 3D) | `components/agora/mapa-agora.tsx` | inclinada |
| `/painel/ocorrencias` — pins numa camada de círculos, bbox ao mexer | `components/painel-ocorrencias/mapa-ocorrencias.tsx` | 2D (+3D) |
| Comunicados/eventos — escolher o ponto (clicar, arrastar) | `components/publicacoes/mapa-ponto.tsx` | 2D |
| `/zona/[codigo]`, regras das zonas, ordenamento no painel | `components/ordenamento/mapa-zonas.tsx` | inclinada (+3D) |
| Ficha do processo no painel | `components/processos/mapa-processo.tsx` | inclinada |

`/ocorrencia/[token]` não tem mapa: a resposta pública da ocorrência não traz coordenadas (de propósito, para não expor a morada).

Para um mapa novo: importar `MapaCidade` (já carrega o motor com `next/dynamic` sem SSR) e passar `marcadores` (React, focáveis, com `nome`), `pontos` (muitos, em camada), `formas` (polígonos e círculos; `altura_m` levanta-os no 3D), `enquadrar`, `selecionado`/`aoSelecionar`, `aoMover` (bbox), `vista` e `controlos`. As peças em vidro estão em `components/mapa/vidro.tsx` (`BolhaMarcador`, `ChipVidro`, `BotaoVidro`, `PainelVidro`).

### Apps (`MapaCidade`, `lib/comum/mapa/mapa_cidade.dart`)

| Ecrã | Ficheiro |
|---|---|
| Munícipe — Perto de mim (mapa): chips em vidro com contagem, bolhas, emergências a pulsar, cartão em vidro | `lib/municipe/ecras/perto.dart` |
| Munícipe — Reportar (escolher o sítio arrastando o mapa) | `lib/municipe/ecras/reportar.dart` |
| Equipa — Hoje/Mapa (tarefas numeradas) | `lib/equipa/ecras/mapa.dart` |

## Custos e limites

O Mapbox cobra por utilização (carregamentos de mapa na web, utilizadores ativos nas apps, pedidos de mosaicos raster), com um escalão gratuito. Os valores e limites mudam: **ver a página de preços do Mapbox** (<https://www.mapbox.com/pricing>) antes de pôr em produção, e ligar alertas de uso no dashboard. Para não gastar à toa:

- o `mapbox-gl` só se descarrega nas páginas com mapa (`next/dynamic`), e cada mapa é um só carregamento;
- sem token, nada vai para o Mapbox;
- o OpenStreetMap (sem token) tem uma política de uso que não permite tráfego intensivo: em produção sem Mapbox convém um servidor de mosaicos próprio ou com acordo.

## O que precisa da rede real para ser verificado

Neste ambiente a rede bloqueia `api.mapbox.com` (e o OpenStreetMap). Foi verificado:

- `tsc`, `eslint`, `next build`; o pedido do estilo sai para `api.mapbox.com/styles/v1/mapbox/standard` com o token público;
- com o estilo intercetado (um estilo **falso** mínimo, com "edifícios" inventados, só para as capturas): chips, bolhas, emergência a pulsar, folha/painel do detalhe, botões, foco do teclado (Enter num marcador abre o detalhe; Escape fecha e devolve o foco ao marcador), filtros por chip;
- com o estilo recusado (401): passa sozinho para o Leaflet;
- a11y (axe + reflow 320 px + alvos de toque) no `/agora` e no `/agora?ver=mapa` (com o motor Leaflet, porque o Mapbox estava bloqueado);
- apps: `flutter analyze`, `flutter test`, `flutter build web` (munícipe e equipa).

Fica por ver com a rede real:

- o aspeto do **Standard** verdadeiro (edifícios, luz, as cores da marca na config, o relevo) e do **Standard Satellite**; afinar `CONFIG_STANDARD` a olhar para o mapa;
- que o token está bem restringido (abrir a demo noutro domínio deve falhar e cair no OpenStreetMap);
- o desempenho do 3D em telemóveis modestos (se pesar, pôr o `/agora` em `vista="inclinado"`);
- os mosaicos raster do Mapbox no flutter_map;
- **o mapa 3D nativo nas apps** (`MAPA_NATIVO=true`): gerar o APK numa máquina com o Android SDK, ver as anotações (tamanho das imagens, toque), a config do Standard e o botão 3D. Os marcadores do nativo são imagens e não têm nome para o TalkBack.
