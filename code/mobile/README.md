# Apps Android do Tou, Câmara? (Flutter)

Uma só codebase com dois *flavors* Android:

| Flavor     | App                    | `applicationId`         | Ponto de entrada          | Estado            |
|------------|------------------------|-------------------------|---------------------------|-------------------|
| `equipa`   | Tou, Câmara · Equipa   | `pt.toucamara.equipa`   | `lib/main_equipa.dart`    | feita (esta)      |
| `municipe` | Tou, Câmara            | `pt.toucamara.municipe` | `lib/main_municipe.dart`  | ecrã "em breve"   |

Só Android (as pastas `ios/`, `linux/`, `macos/` e `windows/` são as do modelo do Flutter e não se usam). A versão web serve para desenvolver e fazer capturas.

## Estrutura

```
lib/
  comum/            partilhado pelas duas apps
    api/            cliente HTTP (Bearer, X-Municipio, Idempotency-Key, erros, sem rede)
    armazenamento/  SharedPreferences, armazenamento seguro (token), ficheiros da fila
    fila/           fila persistente do que se faz sem rede
    sessao/         entrar (email → código), sessão e sair
    localizacao/    GPS e distâncias (haversine, igual à API)
    plataforma/     câmara, ditado por voz, navegar (geo:), abrir PDF
    componentes/    cartões, pílulas, indicador "x por enviar", marca
    tema.dart       cores da marca (tokens de code/web/app/globals.css), letra grande
  equipa/           app da equipa de campo (ecrãs, modelos, repositório)
  main_equipa.dart
  main_municipe.dart
  main.dart         = main_equipa (para `flutter run` sem -t)
```

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
flutter test

# Web (desenvolvimento e capturas). Sem CDN: o CanvasKit vem do próprio build.
flutter build web --no-web-resources-cdn -t lib/main_equipa.dart --dart-define=API_URL=http://localhost:3001
cd build/web && python3 -m http.server 3212
# A API tem de aceitar a origem: ALLOWED_ORIGINS=http://localhost:3212

# Android (emulador: a máquina é 10.0.2.2, o valor por omissão)
flutter run --flavor equipa -t lib/main_equipa.dart
flutter run --flavor equipa -t lib/main_equipa.dart --dart-define=API_URL=https://api.toucamara.pt
```

### `--dart-define`

| Nome        | Para quê                                                                 | Por omissão |
|-------------|--------------------------------------------------------------------------|-------------|
| `API_URL`   | Servidor da API, sem `/v1`                                               | `http://10.0.2.2:3001` (Android), `http://localhost:3001` (web) |
| `MUNICIPIO` | Slug do município para contas da equipa interna (header `X-Municipio`)  | vazio |

Os dois podem mudar-se depois no ecrã "Servidor".

### Gerar o APK (numa máquina com o Android SDK)

```bash
flutter build apk --flavor equipa -t lib/main_equipa.dart --dart-define=API_URL=https://api.toucamara.pt
# → build/app/outputs/flutter-apk/app-equipa-release.apk
flutter build apk --flavor municipe -t lib/main_municipe.dart
```

O release ainda assina com a chave de debug (`android/app/build.gradle.kts`): para publicar, criar uma keystore (fora do git) e um `signingConfig` de release. Em debug a app aceita `http://` (para a API local); em release só `https://`.

Permissões Android: internet, câmara, localização (fina e aproximada) e microfone (ditado). O `minSdk` é 23 (armazenamento seguro).

## O que falta

- **Push** (avisos de tarefa nova): sem Firebase nesta app por agora.
- **iOS**: não configurado.
- **App do munícipe**: só o ecrã "em breve"; a API já existe (`painel/app-municipe`, código por SMS e push FCM).
- **Áudio do ditado para a API**: a app usa o reconhecimento de voz do telemóvel e envia o texto; enviar a gravação para a rota que transcreve (ElevenLabs) fica para depois.
- **Mapa sem rede**: os mosaicos do OpenStreetMap não ficam guardados (os pontos e a lista sim). Em produção convém um servidor de mosaicos próprio ou com acordo (a política do OSM não permite uso intensivo).
- Ícones definitivos (os de agora são provisórios) e assinatura de release.
- Ver o APK num telemóvel real: aqui só se compilou e testou a versão web (não havia Android SDK).
