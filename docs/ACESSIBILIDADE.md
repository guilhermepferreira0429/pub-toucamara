# Acessibilidade

Pessoas idosas e com deficiência (FUN §10). Alvo: **WCAG 2.1 nível AA** (a norma do
Decreto-Lei n.º 83/2018), mais o que é fácil de AAA para idosos (alvos de toque de 44 px,
letra maior, ouvir a página). Auditoria feita a 22/10/2026.

**Resumo honesto:** a auditoria automática (axe-core) passou de 43 regras violadas
(565 elementos) para 0 nas 42 páginas testadas. Isto **não** quer dizer que o serviço é
conforme: falta a verificação manual com leitores de ecrã, os PDF não são marcados,
não há vídeos em LGP e algumas páginas do painel ainda têm scroll lateral a 320 px.
A declaração em `/acessibilidade` diz por isso **"parcialmente conforme"**.

## Metodologia

- **Automática**: `npm run a11y` (em `code/web`), script `code/web/scripts/acessibilidade.mts`,
  Playwright + `@axe-core/playwright` 4.11 (axe-core 4.11.4), regras `wcag2a`, `wcag2aa`,
  `wcag21a`, `wcag21aa` e `best-practice`. Munícipe num telemóvel (390×844); painel num
  computador (1280×800), com sessão por link mágico. O script mede ainda:
  - **reflow**: scroll horizontal com a janela a 320 px (WCAG 1.4.10, equivale a zoom 400 %);
  - **alvos de toque < 44 px** nas páginas do munícipe (WCAG 2.5.5, AAA).
- Páginas com dados reais da BD de desenvolvimento (processo, resumo, marcação, consulta
  pública, apoios, licença, reclamação, zona do PDM, ocorrência, pagamento, requerimento),
  as páginas sem dados (`/`, `/chat`, `/ligar`, `/ligar/qr`, `/acessibilidade`, `/expirado`,
  `/ia`, link inválido) e 23 páginas do painel.
- Também com **A++ e alto contraste** ligados (`A11Y_LETRA=2 A11Y_CONTRASTE=alto`): 0 violações,
  sem scroll lateral a 320 px nas páginas do munícipe.
- **Manual (parcial, com Playwright e teclado)**: o 1.º Tab é "Saltar para o conteúdo" e
  leva ao `<main>`; "Letra e contraste" abre e escolhe só com o teclado; a escolha fica
  depois de recarregar; o diálogo do painel (Equipa → Convidar pessoa) prende o foco
  (25 Tab sem sair), fecha com Esc e devolve o foco ao botão; o mapa (Leaflet) recebe foco
  e mexe-se com setas e +/−; contraste dos tokens calculado à mão (abaixo).

Como correr:

```
cd code/web
A11Y_URL=http://localhost:3000 A11Y_TOKEN=<token de links_magicos> \
  npm run a11y -- --paginas paginas.json      # {"municipe":["/processo/ABC123"],"painel":[…]}
# relatório em relatorio-acessibilidade/relatorio.md (+ .json), fora do git
```

`A11Y_CHROMIUM` aponta para um Chromium se o do Playwright não estiver instalado.

## Antes e depois (axe: críticas/sérias/moderadas, e elementos afetados)

| Página | Antes | Depois | Reflow 320 px | Alvos < 44 px |
|---|---|---|---|---|
| `/` | 0/0/0 | 0/0/0 | ok → ok | 2 → 0 |
| `/chat` | 0/1/0 (1) | 0/0/0 | ok → ok | 6 → 0 |
| `/ligar` | 0/1/0 (1) | 0/0/0 | ok → ok | 0 → 0 |
| `/ligar/qr` | 0/0/0 | 0/0/0 | ok → ok | 0 → 0 |
| `/acessibilidade` | não existia (404) | 0/0/0 | ok | 0 |
| `/expirado` | 0/0/0 | 0/0/0 | ok → ok | 0 → 0 |
| `/ia` | 0/1/0 (5) | 0/0/0 | ok → ok | 6 → 0 |
| link inválido (`/aviso/…`) | 0/0/0 | 0/0/0 | ok → ok | 0 → 0 |
| `/processo/…` | 0/1/0 (7) | 0/0/0 | ok → ok | 0 → 0 |
| `/resumo/…` | 0/1/0 (2) | 0/0/0 | ok → ok | 0 → 0 |
| `/marcacao/…` | 0/1/0 (1) | 0/0/0 | ok → ok | 0 → 0 |
| `/consulta/…` | 1/1/0 (6)¹ | 0/0/0 | ok → ok | 0 → 0 |
| `/apoios/…` | 0/1/0 (12) | 0/0/0 | ok → ok | 1 → 0 |
| `/licenca/…` | 0/1/0 (2) | 0/0/0 | ok → ok | 0 → 0 |
| `/reclamacao/…` | 0/1/0 (12) | 0/0/0 | ok → ok | 0 → 0 |
| `/zona/…` | 0/1/0 (2) | 0/0/0 | ok → ok | 4 → 0² |
| `/ocorrencia/…` | 0/1/0 (9) | 0/0/0 | ok → ok | 2 → 0³ |
| `/pagamento/…` | 0/1/0 (1) | 0/0/0 | ok → ok | 0 → 0 |
| `/requerimento/…` | 0/1/0 (6) | 0/0/0 | ok → ok | 2 → 0 |
| `/entrar` | 0/0/0 | 0/0/0 | ok → ok | — |
| `/painel` | 0/1/0 (31) | 0/0/0 | não → não | — |
| `/painel/entrada` | 0/1/0 (9) | 0/0/0 | não → ok | — |
| `/painel/conversas` | 0/1/0 (58) | 0/0/0 | não → ok | — |
| `/painel/processos` | 0/1/0 (23) | 0/0/0 | não → não | — |
| `/painel/licencas` | 0/1/0 (25) | 0/0/0 | não → não | — |
| `/painel/marcacoes` | 0/1/0 (7) | 0/0/0 | não → ok | — |
| `/painel/pagamentos` | 0/1/0 (32) | 0/0/0 | não → ok | — |
| `/painel/ocorrencias` | 0/1/0 (8) | 0/0/0 | não → ok | — |
| `/painel/reclamacoes` | 0/1/0 (21) | 0/0/0 | não → ok | — |
| `/painel/conhecimento` | 0/1/0 (10) | 0/0/0 | não → não | — |
| `/painel/indicadores` | 0/2/0 (24) | 0/0/0 | não → ok | — |
| `/painel/equipa` | 0/2/0 (24) | 0/0/0 | não → não | — |
| `/painel/agente` | 0/1/0 (14) | 0/0/0 | não → ok | — |
| `/painel/campanhas` | 0/1/0 (12) | 0/0/0 | não → não | — |
| `/painel/avisos` | 0/1/0 (11) | 0/0/0 | não → não | — |
| `/painel/consultas` | 0/1/0 (8) | 0/0/0 | não → ok | — |
| `/painel/chamadas` | 0/1/0 (40) | 0/0/0 | não → ok | — |
| `/painel/apoios` | 0/1/0 (44) | 0/0/0 | não → ok | — |
| `/painel/ordenamento` | 0/1/0 (28) | 0/0/0 | não → ok | — |
| `/painel/relatorios` | 0/1/0 (7) | 0/0/0 | não → ok | — |
| `/painel/processos/[id]` | 0/1/0 (21) | 0/0/0 | não → não | — |
| `/painel/conversas/[id]` | 0/2/1 (38) | 0/0/0 | não → ok | — |
| **Total** | **1/39/3 (565)** | **0/0/0** | 22 → 8 páginas | 23 → 0 |

¹ A violação crítica (`label` nos botões de opção) vinha de dados mal semeados por mim na BD
(opções sem texto), não do código; corrigidos os dados, desapareceu.
² Os botões de zoom do mapa passaram a 44 px; os links de atribuição do mapa (texto) estão isentos.
³ Eram inputs de ficheiro escondidos (`sr-only`), não alvos reais; o script passou a ignorá-los.

Quase todas as sérias eram **contraste**: o token `tinta-3` (#7d8794) dava 3,2:1 sobre creme.

## O que foi corrigido

- **Contraste**: `--color-tinta-3` #7d8794 → **#5b6572** (5,2:1 creme, 4,65:1 creme-2,
  5,7:1 papel, 5,9:1 branco). Texto branco translúcido sobre terracota (`text-white/80`, `/85`)
  passou a `/90` (4,5:1); a data da "Fonte oficial" (`text-verde/70`) passou a `text-verde`.
  Os outros tokens já passavam: tinta 13,5:1, tinta-2 6,4:1, terracota 4,6:1 sobre creme,
  branco sobre terracota 5,2:1. As capturas antes/depois do painel (lista e ficha de
  processos, conversa, visão geral) não mostram mudanças além do cinzento um pouco mais escuro.
- **Foco visível**: contorno de 3 px em `:focus-visible`, sem camada (ganha aos `outline-none`).
- **Saltar para o conteúdo** (`components/acessibilidade/saltar.tsx`) e `<main id="conteudo">`
  nas páginas do munícipe e no painel; `lang="pt-PT"` já existia.
- **Diálogos**: `useFocoPreso` (`lib/foco.ts`) — foco lá dentro ao abrir, Tab dá a volta, Esc
  fecha, foco volta ao botão. Aplicado ao `Dialogo` do painel (`components/conhecimento/comum.tsx`,
  usado em vários ecrãs), ao "Verificar documento" do munícipe e ao menu do painel em ecrã estreito.
  O `Dialogo` dos processos já usava `<dialog>` nativo.
- **Painel em ecrã estreito / zoom**: abaixo de 768 px a barra lateral fica atrás de um botão
  "Menu" (gaveta modal); a lista de conversas, a entrada e mais 11 páginas deixaram de ter
  scroll lateral a 320 px.
- **Regiões com scroll** (tabelas e o mapa de calor do painel): `tabIndex={0}` para se
  percorrerem com o teclado.
- **Marcos**: o `<aside>` da conversa estava dentro do `<main>` (passou a `div`); ecrã
  "A carregar…" do painel com `<main role="status">`.
- **Links distinguíveis** sem depender da cor (sublinhados na ficha da conversa).
- **Alvos de toque ≥ 44 px** no munícipe: voltar e "Pessoa" do chat, sugestões do chat,
  escolher o assistente e "Copiar" em `/ia`, "Fotografar" do requerimento, "Apoios a que não
  tem direito", botões de zoom do mapa, menu do portal.
- **Menos movimento**: `prefers-reduced-motion` desliga animações e transições em todo o site
  (o chat e a chamada já respeitavam em parte).
- `aria-live`: o chat (`role="log"` + região `polite`) e a chamada (`role="status"`) já tinham;
  "Ouvir esta página" anuncia "A ler…/Em pausa".

## Para idosos (páginas do munícipe)

Barra "Opções de leitura" no topo de todas as páginas dos links do SMS
(`components/acessibilidade/opcoes-leitura.tsx`, no `app/(municipe)/layout.tsx`):

- **Ouvir esta página** (`ouvir.tsx`): `speechSynthesis` em pt-PT (escolhe a voz pt-PT, senão
  pt-BR, senão a do sistema), lê o `<main>` sem a barra nem o rodapé, em pedaços pequenos
  (o Chrome corta frases longas), com Pausa/Continuar e Parar; cala-se ao sair da página.
  Sem Web Speech API o botão não aparece.
- **Letra e contraste**: A / A+ / A++ (zoom 1,15 e 1,3 da coluna, sem scroll lateral, porque a
  letra está em px no Tailwind) e **Alto contraste** (texto preto, fundo branco, terracota e
  verde escuros, links sublinhados). Guardado em `localStorage` (com try/catch) e aplicado
  antes de pintar por um script no `<head>`, para não piscar. Só muda as páginas do munícipe,
  não o painel nem o chat em ecrã inteiro.
- A linguagem simples já existia; o conteúdo não foi mexido.

## Língua Gestual Portuguesa

Não gravámos vídeos. Ficou a infraestrutura (`components/acessibilidade/lingua-gestual.tsx`,
`lib/acessibilidade.ts`), configurada por variáveis (ver `code/web/.env.example`):

- `NEXT_PUBLIC_LGP_VIDEOS` — JSON com um vídeo por tipo de página (`processo`, `licenca`,
  `pagamento`, `acessibilidade`, …; o tipo sai do caminho). Com vídeo, aparece por cima do
  conteúdo um leitor (`<video>` com legendas WebVTT opcionais) ou um link; sem vídeo, nada.
- `NEXT_PUBLIC_LGP_VIDEOCHAMADA_URL` / `_NOME` / `_HORARIO` — "Pedir atendimento em Língua
  Gestual" no rodapé. Sem configuração diz a verdade: ainda não há videochamada com
  intérprete e pode tratar de tudo por escrito no chat.

Falta: a câmara gravar os vídeos com intérprete certificado e contratar (ou indicar) o
serviço de videointérprete; nada disto é inventado no ecrã.

## Declaração de acessibilidade

`/acessibilidade` (`app/(municipe)/acessibilidade/page.tsx`), link no rodapé de todas as
páginas do munícipe. Segue a estrutura do modelo da AMA para o DL 83/2018 (Diretiva (UE)
2016/2102): âmbito, estado (**parcialmente conforme**, WCAG 2.1 AA), conteúdo não acessível
e porquê, como foi feita (data, método), contacto (email/telefone configuráveis, chat) e o
recurso à AMA. Para publicar a sério: gerar a versão final no gerador de
acessibilidade.gov.pt (que valida a marcação `mr-*` do modelo) e registá-la no observatório.

## O que falta

- **Leitores de ecrã**: verificação manual com NVDA (Windows/Firefox), TalkBack (Android/Chrome)
  e VoiceOver (iOS) — sobretudo o chat (anúncio das respostas), a chamada no browser e as
  páginas com formulário (ocorrência, requerimento, consulta).
- **Testes com pessoas idosas** e com deficiência (o "Ouvir" e a letra maior nunca foram usados
  por quem precisa deles).
- **PDF marcados** (pdfkit sem `tagged`): licenças, decisões, requerimentos, ofícios.
- **Vídeos em LGP** e serviço de videointérprete.
- **Painel a 320 px**: 8 páginas (visão geral, listas de processos/licenças/campanhas/avisos,
  conhecimento, equipa, ficha do processo) ainda têm scroll lateral por causa de tabelas e
  filtros largos; as tabelas de dados podem ter scroll próprio (exceção do 1.4.10), mas os
  filtros devem quebrar linha.
- **Mapa**: o desenho das zonas não é descrito a leitores de ecrã (a resposta está em texto).
- **Chat em ecrã inteiro e `/ligar`**: não têm a barra de letra/contraste nem o rodapé (ficam fora
  do layout do munícipe); herdam o contraste novo e o foco visível.
- O axe só apanha ~30–40 % dos problemas WCAG; ordem de leitura, textos alternativos com sentido,
  mensagens de erro claras e gestão do foco depois de ações assíncronas precisam de revisão manual.
- A auditoria não cobre as páginas novas dos outros trabalhos em paralelo (balcão para empresas,
  entregar em nome): correr `npm run a11y` com elas depois do merge.
