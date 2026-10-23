# Vídeos

Os vídeos de demonstração, feitos com [Remotion](https://www.remotion.dev/):
capturas das páginas verdadeiras, com os dados de demonstração, e a voz do
próprio assistente (ElevenLabs) a contar o que fez.

- **Painel** (`Painel`, cerca de 2 minutos): o lado da câmara. Há uma cena
  com uma chamada simulada, em que se ouvem as duas vozes enquanto o painel
  "Ao vivo" se preenche.
- **Munícipe** (`Municipe`, cerca de 90 segundos): uma renovação, do
  princípio ao fim. O aviso por SMS, a chamada no `/ligar` (com o ElevenLabs
  simulado e as ferramentas verdadeiras da API), o SMS do pagamento, a página
  de pagamento em modo de teste, a licença com o QR e o painel.
- **Único** (`TouCamara`, 98 segundos): os dois juntos, sem voz e com
  música, a cortar nos tempos fortes. O munícipe, o lado da câmara, a
  avaliação e o fecho. É o vídeo da entrega.

| | |
|---|---|
| `src/guiao.ts`, `src/guiao-municipe.ts` | O que se diz e o que se mostra, cena a cena. Os números vêm das capturas |
| `scripts/capturar.mjs` | `npm run capturar [-- --video=painel,municipe]`: capturas e números → `public/capturas/`, `src/dados.gerado.json` |
| `scripts/voz.ts` | `npm run voz`: um MP3 por bloco dos guiões → `public/voz/`, `src/voz.gerado.json` |
| `src/unico/` | O vídeo único: `guiao.ts` (as tomas, em compassos), `ritmo.ts` (o relógio da música), `Unico.tsx` |
| `scripts/musica.mjs` | `node scripts/musica.mjs`: descarrega a música e corta-a em frases de 8 compassos → `public/musica/` |
| `scripts/render.ts` | `npm run render -- --video=painel\|municipe\|unico` → `out/<nome>.mp4` (ou `--stills=0,300` para imagens soltas) |
| `scripts/poster.ts` | `npm run poster`: as capas a 1920×1080 (a partir de `docs/anexos-taikai/capas`) → `out/<nome>-capa.png` |
| `npm run estudio` | O Remotion Studio, para ver e afinar |

Sem voz gerada, o vídeo faz-se na mesma, sem som e com as durações estimadas
pelo número de palavras. A legenda é sempre a do texto que se diz.

A música do vídeo único é "Voxel Revolution", de Kevin MacLeod
(incompetech.com), com licença
[Creative Commons Atribuição 4.0](https://creativecommons.org/licenses/by/4.0/):
o crédito aparece no fim do vídeo. Os cortes de imagem contam com a música
cortada por `scripts/musica.mjs`; mudar a música obriga a medir outra vez o
andamento e o primeiro tempo forte (`src/unico/ritmo.ts`).

## Do zero ao MP4

1. **Uma base só para o vídeo**, com o seed de base e a demonstração
   preparada. Do seed só entram `01` a `04`: o `05_demonstracao.sql` traz
   outro conjunto de conversas e passagens que não é o da demonstração (e a
   Entrada mostra-as mesmo escondidas). A demonstração conta os dias a partir
   de quando é preparada: prepare-a de manhã (entre as 10h e as 12h), para as
   conversas de "hoje" terem horas de expediente.

   ```bash
   createdb -h localhost -p 54330 -U toucamara toucamara_video
   psql -h localhost -p 54330 -U toucamara -d toucamara_video \
     -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;'
   # A API corre as migrações no arranque (e fica a correr).
   cd code/api && DB_NAME=toucamara_video DEMO_ATIVA=true npm run start:dev
   # Noutro terminal, o seed de base:
   for f in 01_base 02_fontes 03_utilizadores 04_taxas_imi; do
     psql -h localhost -p 54330 -U toucamara -d toucamara_video -f db/seed/guimaraes/$f.sql
   done
   cd code/web && npm run dev
   ```

   Preparar a demonstração com o conhecimento (fontes, respostas e o teste
   de qualidade de demonstração), com a sessão da chefia (passo 2):
   `POST /v1/painel/demo/preparar` com
   `{"confirmar": true, "conhecimento": true}`. Os números da Visão geral
   refrescam de 5 em 5 minutos: espere por eles antes de capturar.

2. **A sessão do painel** para as capturas: entrar no `/entrar` com um email
   de chefia; em desenvolvimento o link mágico aparece no log da API. O token
   fica no `localStorage` (`toucamara.token`) ou na resposta de
   `POST /v1/painel/auth/entrar`.

3. **Capturas** (abre o browser sem janela; a cena da chamada usa o "Simular
   chamada" do Ao vivo, que só existe fora de produção):

   ```bash
   cd code/video && npm ci
   PAINEL_TOKEN=... npm run capturar
   ```

   Antes de capturar, o script corre o "Preparar demo" com "limpar testes":
   a chamada simulada da captura anterior fica escondida e não entra nos
   números (`LIMPAR=0` salta este passo). Corre-se outra vez sempre que o
   painel muda (por exemplo, com as fotografias das pessoas). Os números da narração mudam com as capturas: a
   voz dos blocos com números diferentes gera-se outra vez no passo seguinte.

   O vídeo do munícipe precisa ainda de `AGENTE_SEGREDO` (o da API, para as
   ferramentas do agente) e das variáveis da base (`DB_HOST`, `DB_PORT`,
   `DB_USER`, `DB_PASSWORD`, `DB_NAME`): a licença a renovar é posta a
   acabar daqui a 10 dias, como no "Experimentar uma renovação" do `/ligar`.
   Para os links dos SMS levarem o domínio público, a API corre com
   `WEB_URL=https://toucamara.descortina.pt`; o script abre-os no site local.
   Cada captura faz uma renovação nova: para a versão final, numa base nova.

4. **Voz** (só gera o que falta ou mudou):

   ```bash
   ELEVENLABS_API_KEY=... npm run voz
   ```

   Por omissão, o assistente é a voz `DMcOknq8n1B6XshFIJKJ` e quem liga na
   chamada é `JGnWZj684pcXmK2SxYIv` (`ELEVENLABS_VOZ_ID`,
   `ELEVENLABS_VOZ_MUNICIPE` e `ELEVENLABS_MODELO` mudam-nas). Quem liga é
   uma senhora ("vivo sozinha", "a minha filha"): a voz tem de ser feminina.

5. **Render**: `npm run render` → `out/painel.mp4`.

## Regras do guião

- Fala o assistente, na primeira pessoa e no masculino, em português de
  Portugal. Resultados, não funcionalidades.
- Cada número dito é o que está no ecrã (vem de `src/dados.gerado.json`).
- O selo "Dados de demonstração" fica em todas as cenas do painel; a chamada
  diz que é simulada.
- Nada que o produto não faça; o que está em modo de teste não se apresenta
  como real.

As fontes (Bricolage Grotesque e Inter, licença OFL) estão em
`public/fontes`, para o render não depender da rede.
