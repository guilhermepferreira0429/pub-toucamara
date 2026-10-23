# Vídeo

O vídeo da entrega (`TouCamara`, cerca de 2 min 10 s), feito com
[Remotion](https://www.remotion.dev/): capturas das páginas verdadeiras, com
os dados de demonstração, sem voz e com música, a cortar nos tempos fortes.
Primeiro o munícipe (uma renovação, do aviso por SMS à licença com o QR),
depois o lado da câmara, a avaliação e o fecho.

| | |
|---|---|
| `src/unico/guiao.ts` | As tomas, em compassos da música: o que se mostra e o texto por cima. Os números vêm das capturas |
| `src/unico/ritmo.ts`, `src/unico/Unico.tsx` | O relógio da música e as tomas (texto aos tempos, cortes, varrimentos) |
| `src/pecas.tsx`, `src/visuais.tsx` | Uma página do painel com a câmara a mover-se, os recortes, o telemóvel, os SMS e os selos |
| `scripts/capturar.mjs` | `npm run capturar`: capturas e números → `public/capturas/`, `src/dados.gerado.json` |
| `scripts/musica.mjs` | `node scripts/musica.mjs`: descarrega a música → `public/musica/` (inteira: 64 compassos) |
| `scripts/render.ts` | `npm run render` → `out/tou-camara.mp4` (ou `-- --stills=0,300` para imagens soltas) |
| `scripts/poster.ts`, `src/unico/Miniatura.tsx` | `npm run poster`: a miniatura do YouTube → `out/tou-camara-miniatura.png` (1920×1080) e `.jpg` (1280×720) |
| `npm run estudio` | O Remotion Studio, para ver e afinar |

A música é "Voxel Revolution", de Kevin MacLeod (incompetech.com), com
licença [Creative Commons Atribuição 4.0](https://creativecommons.org/licenses/by/4.0/):
o crédito aparece no fim do vídeo. Os cortes de imagem contam com os 64
compassos da música; mudar a música obriga a medir outra vez o andamento e o
primeiro tempo forte (`src/unico/ritmo.ts`).

## Do zero ao MP4

1. **Uma base só para o vídeo**, com o seed de base e a demonstração
   preparada. Do seed só entram `01` a `04`: o `05_demonstracao.sql` traz
   outro conjunto de conversas e passagens que não é o da demonstração (e a
   Entrada mostra-as mesmo escondidas). A demonstração conta os dias a partir
   de quando é preparada, a qualquer hora: uma conversa de "hoje" a uma hora
   que ainda não chegou passa para ontem.

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
   painel muda (por exemplo, com as fotografias das pessoas). Os números do
   vídeo mudam com as capturas.

   O vídeo do munícipe precisa ainda de `AGENTE_SEGREDO` (o da API, para as
   ferramentas do agente) e das variáveis da base (`DB_HOST`, `DB_PORT`,
   `DB_USER`, `DB_PASSWORD`, `DB_NAME`): a licença a renovar é posta a
   acabar daqui a 10 dias, como no "Experimentar uma renovação" do `/ligar`.
   Para os links dos SMS levarem o domínio público, a API corre com
   `WEB_URL=https://toucamara.descortina.pt`; o script abre-os no site local.
   Cada captura faz uma renovação nova: para a versão final, numa base nova.

4. **Render**: `npm run render` → `out/tou-camara.mp4`.

## Regras do guião

- Resultados, não funcionalidades, em português de Portugal.
- Cada número é o que está no ecrã (vem de `src/dados.gerado.json`); os da
  avaliação são os da ronda final (`docs/avaliacao/escala`).
- O selo "Dados de demonstração" fica em todas as cenas com dados de
  demonstração; a chamada diz que é simulada. A câmara nunca passa pelas
  zonas proibidas das capturas (o render recusa-se).
- Nada que o produto não faça; o que está em modo de teste não se apresenta
  como real.

As fontes (Bricolage Grotesque e Inter, licença OFL) estão em
`public/fontes`, para o render não depender da rede.
