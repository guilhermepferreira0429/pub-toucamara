# Apps Android do Tou, Câmara? (Flutter)

Uma só codebase com dois *flavors* Android:

| Flavor     | App                    | `applicationId`         | Ponto de entrada          | Estado            |
|------------|------------------------|-------------------------|---------------------------|-------------------|
| `equipa`   | Tou, Câmara · Equipa   | `pt.toucamara.equipa`   | `lib/main_equipa.dart`    | feita             |
| `municipe` | Tou, Câmara            | `pt.toucamara.municipe` | `lib/main_municipe.dart`  | feita             |

Só Android (as pastas `ios/`, `linux/`, `macos/` e `windows/` são as do modelo do Flutter e não se usam). A versão web serve para desenvolver e fazer capturas.

## Estrutura

```
lib/
  comum/            partilhado pelas duas apps
    api/            cliente HTTP (Bearer, X-Municipio, Idempotency-Key, erros, sem rede)
    armazenamento/  SharedPreferences, armazenamento seguro (token), ficheiros da fila
    fila/           fila persistente do que se faz sem rede
    sessao/         entrar (email → código), sessão e sair (equipa)
    localizacao/    GPS e distâncias (haversine, igual à API)
    plataforma/     câmara, ditado por voz, navegar (geo:), abrir PDF
    componentes/    cartões, pílulas, indicador "x por enviar", marca
    tema.dart       cores da marca (tokens de code/web/app/globals.css), letra grande
  equipa/           app da equipa de campo (ecrãs, modelos, repositório)
  municipe/         app do munícipe (ecrãs, modelos, repositório, chat, reportar, push)
  main_equipa.dart
  main_municipe.dart
  main.dart         = main_equipa (para `flutter run` sem -t)
```

## App do munícipe ("Tou, Câmara")

Para pessoas de todas as idades: letra grande (e ajustável em Definições, por cima da do telemóvel), alto contraste (tinta sobre creme, ≥ 7:1 no texto principal), alvos de toque ≥ 48 dp (os principais 56 dp), nomes para leitores de ecrã (`Semantics`) e frases sem jargão.

1. **Entrar**: número de telemóvel → código de 6 algarismos por SMS → entrar. Explica porquê o telemóvel e o que fica guardado (só a chave da sessão, cifrada). O município é o da app (`--dart-define=MUNICIPIO`).
2. **Início**: emergências no topo, quatro atalhos grandes (Falar com a câmara, Ligar, Reportar um problema, Os meus assuntos) e "O que se passa perto de si" (resumo do feed `/agora`).
3. **Perto de mim**: o feed da câmara em lista ou mapa (flutter_map), filtros por tipo, "perto de mim" com a localização e a distância (300 m a 5 km), detalhe de cada item e **Avisar-me** (à volta do sítio do item, de onde estou ou na freguesia).
4. **Os meus assuntos**: Processos (fase em palavras simples, o que falta da sua parte, prazo, pagamento, decisão em PDF e a linha do tempo), Licenças (QR para verificar e PDF), Pagamentos (referência Multibanco e o link para MB WAY/pagar; os de teste vêm marcados), Marcações (e recolhas), Reclamações e Ocorrências reportadas (estado e fotografias, também as "do depois" da equipa). O que a app não mostra abre a página do site.
5. **Reportar um problema**: categoria → fotografia (câmara ou galeria) → sítio (GPS no mapa, ajustável arrastando o mapa) → descrição (escrita ou ditada) → confirmar → enviar. Vai pela fila sem rede (`lib/comum/fila`): a ocorrência e depois a fotografia (pela rota pública da ocorrência, com o token devolvido), cada uma com a sua `Idempotency-Key`. Se a API disser que é duplicado, "Já sabemos!".
6. **Falar com a câmara**: o assistente por escrito ou ditado, numa sessão de chat já ligada à pessoa (`POST /v1/app/chat/sessoes`), com a resposta em SSE e cartões simples para fontes, 112, contactos, marcações, pagamentos, ocorrências, processos e "o que se passa" (e um genérico para os outros).
7. **Avisos**: os avisos por zona e as emergências recebidos, e "Os avisos que pedi" (cancelar).
8. **Definições**: a conta, notificações (estado do push; avisos e processos ligam/desligam, emergências sempre), tamanho da letra, "por enviar", sair, e o servidor (para testes; também com cinco toques na marca em "Entrar").

### API usada pela app do munícipe

- `POST /v1/public/app/codigo` `{municipio, telefone}` e `POST /v1/public/app/entrar` `{municipio, telefone, codigo, dispositivo}` → `{token: "tca_…", …}`.
- Com `Authorization: Bearer tca_…`: `GET app/eu`, `PUT app/eu/preferencias`, `POST/DELETE app/dispositivos`, `GET app/processos[/:id]`, `GET app/licencas|pagamentos|marcacoes|reclamacoes|avisos`, `GET app/ocorrencias`, `GET app/ocorrencias/categorias`, `POST app/ocorrencias` (aceita `Idempotency-Key`), `POST app/chat/sessoes`, `POST app/sair`.
- Novas para a app: `GET/POST app/agora/subscricoes` `{tipos, lat?, lng?, raio_m?, descricao?, freguesia?}` e `DELETE app/agora/subscricoes/:id` ("Avisar-me", a mesma gravação da ferramenta `avisar_me`, canal `app`).
- Públicas: `GET public/agora/:municipio[/:tipo/:id]`, `GET public/ocorrencias/:token`, `POST public/ocorrencias/:token/fotos`, `GET public/licencas/:codigo/pdf`, `GET public/processos/:codigo/decisao.pdf`, e o chat `POST /v1/chat/sessoes/:sessao/mensagens` (SSE).

### Notificações (push FCM)

A API envia pelo FCM v1 com `data.link` (rota da app: `/processos/<id>`, `/avisos`) e o canal Android do tipo (`toucamara_urgente`, `toucamara_avisos`, `toucamara_processos`). Na app há um serviço `Notificacoes` com duas implementações:

- **Sem Firebase** (por omissão): não regista o telemóvel; em Definições aparece "Notificações: por configurar". A app compila e corre igual.
- **Com Firebase** (`--dart-define=FCM=true`): `Firebase.initializeApp`, pede autorização (Android 13+), cria os 3 canais (`MainActivity.kt`, canal `pt.toucamara/notificacoes`), regista o token em `POST app/dispositivos` (e quando muda), abre a rota do `data.link` ao tocar na notificação e, com a app aberta, mostra-a em baixo com "Ver". Ao sair tira o registo.

Para ligar o push:

1. Criar um projeto Firebase com uma app Android `pt.toucamara.municipe`.
2. Pôr o `google-services.json` em `android/app/src/municipe/` (está no `.gitignore`; nunca no git). O plugin `com.google.gms.google-services` só se aplica quando esse ficheiro existe e se compila o flavor `municipe` (`android/app/build.gradle.kts`).
3. Na API (`code/api/.env`): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (conta de serviço com permissão de envio FCM). Sem elas a API regista os pushes em modo consola.
4. Compilar com `--dart-define=FCM=true`.

## Ecrãs da app da equipa

1. **Entrar**: email do painel → código de 6 algarismos por email → sessão do telemóvel (30 dias, revogável).
2. **Hoje**: visitas de fiscalização do dia (e as que ficaram para trás) e ocorrências abertas do serviço da pessoa, por proximidade a onde está, com a distância e "Navegar até lá" (`geo:` no Android, Google Maps na web).
3. **Mapa** (flutter_map, mosaicos do OpenStreetMap): os pontos numerados pela ordem da lista; tocar mostra a tarefa.
4. **Visita de fiscalização**: local e motivo, checklist (Sim/Não/N/A), fotografias (câmara ou galeria, com GPS e hora), relatório ditado (reconhecimento de voz do telemóvel; o texto vai para a API, que o estrutura) e notas, concluir → a API fecha o relatório e gera o PDF, que se abre na app.
5. **Ocorrência**: o que o munícipe reportou, as fotografias dele, os outros avisos do mesmo problema, "Vou tratar disto", "Fechar com foto do depois" (foto + nota). A API passa-a a resolvida e avisa por SMS quem reportou, como no painel.
6. **Por enviar**: tudo o que se faz fica numa fila no telemóvel e é enviado por ordem quando há rede (a cada 30 s, ao voltar à app e em "Enviar agora"). Cada ação leva uma `Idempotency-Key`: reenviar não repete nada na API. As tarefas do dia e os detalhes ficam guardados para abrir sem rede.
7. **Sessão**: quem está, telemóveis com sessão aberta (terminar os outros), servidor, sair.
8. **Servidor** (escondido: cinco toques na marca no ecrã de entrar, ou em Sessão → Servidor): URL da API e município da equipa interna.

## API usada

Novas (ver `code/api/src/modules/auth/app-equipa.*` e `code/api/src/modules/equipa-campo/*`):

- `POST /v1/painel/auth/app/codigo` `{email}` → 202 (igual exista ou não a conta)
- `POST /v1/painel/auth/app/entrar` `{email, codigo, dispositivo}` → `{token, expira_em, sessao_id, utilizador, municipio}`
- `POST /v1/painel/auth/app/sair`, `GET /v1/painel/auth/app/sessoes`, `POST /v1/painel/auth/app/sessoes/:id/revogar`
- `GET /v1/painel/equipa/hoje?lat=&lng=&dia=`
- `POST /v1/painel/equipa/visitas/:id/fotos` e `POST /v1/painel/equipa/ocorrencias/:id/fotos` `{mime, legenda, lat, lng, tirada_em}` → URL assinada (PUT ao S3)
- `POST /v1/painel/equipa/ocorrencias/:id/fechar` `{nota, foto_ids}`

E as do painel de sempre: `GET/POST painel/fiscalizacao/visitas/:id{,/relatorio,/concluir,/pdf}`, `GET/PATCH painel/ocorrencias/:id`. A sessão da app é um JWT do painel com o id da sessão (`sid`): o perfil `tecnico` (fiscal) é o perfil de campo; `chefe_divisao`, `admin` e `equipa_toucamara` também entram.

## Correr

Flutter stable (Dart 3.11+). A API em `code/api` (porta 3001 por omissão).

```bash
flutter pub get
flutter analyze
flutter test   # equipa (test/*.dart) e munícipe (test/municipe/)

# Web (desenvolvimento e capturas). Sem CDN: o CanvasKit vem do próprio build.
flutter build web --no-web-resources-cdn -t lib/main_equipa.dart --dart-define=API_URL=http://localhost:3001
flutter build web --no-web-resources-cdn -t lib/main_municipe.dart --dart-define=API_URL=http://localhost:3001 --dart-define=WEB_URL=http://localhost:3000 --dart-define=MUNICIPIO=guimaraes
cd build/web && python3 -m http.server 3212
# A API tem de aceitar a origem: ALLOWED_ORIGINS=http://localhost:3212

# Android (emulador: a máquina é 10.0.2.2, o valor por omissão)
flutter run --flavor equipa -t lib/main_equipa.dart
flutter run --flavor equipa -t lib/main_equipa.dart --dart-define=API_URL=https://api.toucamara.pt
flutter run --flavor municipe -t lib/main_municipe.dart --dart-define=MUNICIPIO=guimaraes
```

### `--dart-define`

| Nome        | Para quê                                                                 | Por omissão |
|-------------|--------------------------------------------------------------------------|-------------|
| `API_URL`   | Servidor da API, sem `/v1`                                               | `http://10.0.2.2:3001` (Android), `http://localhost:3001` (web) |
| `MUNICIPIO` | Equipa: slug para contas da equipa interna (header `X-Municipio`). Munícipe: o município da app | vazio (munícipe: `guimaraes`) |
| `WEB_URL`   | Munícipe: o site (o botão "Ligar" abre `<WEB_URL>/ligar`, a chamada pela internet) | `http://localhost:3000` |
| `TELEFONE`  | Munícipe: se definido, "Ligar" liga para este número em vez de abrir o `/ligar` | vazio |
| `FCM`       | Munícipe: `true` liga o push do Firebase (ver acima) | `false` |

Os dois podem mudar-se depois no ecrã "Servidor".

### Gerar o APK (numa máquina com o Android SDK)

```bash
flutter build apk --flavor equipa -t lib/main_equipa.dart --dart-define=API_URL=https://api.toucamara.pt
# → build/app/outputs/flutter-apk/app-equipa-release.apk
flutter build apk --flavor municipe -t lib/main_municipe.dart --dart-define=API_URL=https://api.toucamara.pt --dart-define=WEB_URL=https://toucamara.pt --dart-define=MUNICIPIO=guimaraes
# → build/app/outputs/flutter-apk/app-municipe-release.apk (com push: + --dart-define=FCM=true e o google-services.json)
```

O release ainda assina com a chave de debug (`android/app/build.gradle.kts`): para publicar, criar uma keystore (fora do git) e um `signingConfig` de release. Em debug a app aceita `http://` (para a API local); em release só `https://`.

Permissões Android: internet, câmara, localização (fina e aproximada) e microfone (ditado); a do munícipe também notificações (`POST_NOTIFICATIONS`, em `android/app/src/municipe/AndroidManifest.xml`). O `minSdk` é 23 (armazenamento seguro).

## O que falta

- **Push na app da equipa** (avisos de tarefa nova): sem Firebase. O `firebase_messaging` entra também no APK da equipa (é a mesma codebase), mas só a do munícipe o usa.
- **Push do munícipe por testar num telemóvel**: sem Android SDK nem projeto Firebase aqui, a parte FCM (`notificacoes_fcm.dart`, canais em `MainActivity.kt`, plugin condicional no Gradle) compila na web mas não foi corrida num Android.
- **Fotografias sem armazenamento**: sem `S3_BUCKET` a API responde 503 à fotografia; a ocorrência fica e a fotografia fica "com problema" em "Por enviar" (não prende o resto).
- **Ligar**: abre a chamada pela internet do site (`/ligar`) ou o número de `TELEFONE`; a app não faz a chamada de voz ela própria.
- **iOS**: não configurado.
- **Áudio do ditado para a API**: a app usa o reconhecimento de voz do telemóvel e envia o texto; enviar a gravação para a rota que transcreve (ElevenLabs) fica para depois.
- **Mapa sem rede**: os mosaicos do OpenStreetMap não ficam guardados (os pontos e a lista sim). Em produção convém um servidor de mosaicos próprio ou com acordo (a política do OSM não permite uso intensivo).
- Ícones definitivos (os de agora são provisórios) e assinatura de release.
- Ver o APK num telemóvel real: aqui só se compilou e testou a versão web (não havia Android SDK).
