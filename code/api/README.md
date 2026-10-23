# API Tou, Câmara?

NestJS + Postgres 17 (pgvector) com SQL à mão. A lista de rotas atual está em `GET /v1/docs` (OpenAPI).

IA: o Claude da Anthropic fora da chamada (resumos, classificação, juiz da qualidade; `ANTHROPIC_MODEL`). A voz é um agente no ElevenLabs que chama as ferramentas desta API (ver [`agente-voz/README.md`](agente-voz/README.md)).

## Arrancar

```bash
docker compose -f ../../env/dev/docker-compose.yml up -d   # Postgres na porta 54330
cp .env.example .env                                       # e preencher
bun install
bun run start:dev                                          # migrações correm no arranque
bun run db:reset                                           # dev: recomeçar a BD do zero
bun run test && bun run lint                               # o lint corre com --fix (corrige o que puder)
```

## Scripts

| Comando | O que faz |
|---|---|
| `bun run db:reset` | Dev: apaga a BD e volta a correr as migrações |
| `bun run db:seed [-- slug]` | Carrega os `.sql` de `db/seed/<slug>/` (por omissão `guimaraes`). São idempotentes. Em produção: `env/prod/docker/seed.sh` |
| `bun run demo:preparar` | Prepara a câmara de demonstração (pessoas, processos, ocorrências, áreas V4). O mesmo que o botão "Preparar a demonstração" do painel |
| `bun run agente-voz -- <gerar\|diff\|sincronizar>` | Gera e sincroniza os agentes de voz no ElevenLabs (ver [`agente-voz/README.md`](agente-voz/README.md)) |
| `bun run armazenamento -- <verificar\|cors>` | Verifica o armazenamento S3 ou configura o CORS |
| `bun run verificar-projetos -- --ajuda` | Avalia a leitura de projetos pela IA com o Claude a sério (precisa de `ANTHROPIC_API_KEY`) |
| `bun run checklist-regras` | Escreve `docs/VALIDAR_REGRAS_PROJETOS.md` a partir do código (o teste `checklist-regras.spec.ts` falha se ficar desatualizado) |

## Testes

- `bun run test`: unitários (`src/**/*.spec.ts`), sem BD.
- `bun run test:e2e`: ponta a ponta (`test/e2e/*.e2e-spec.ts`, um ficheiro por área), contra o Postgres de dev (porta 54330, tem de estar a correr). Cada execução cria uma BD nova `toucamara_e2e_<timestamp>_<pid>` (`globalSetup`) e apaga-a no fim com `DROP DATABASE … WITH (FORCE)` (`globalTeardown`); restos de execuções interrompidas com mais de 6 h apagam-se na seguinte. A BD `toucamara` nunca é tocada. A ligação usa `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` da shell ou os de dev; o `.env` não é lido.
- Um ficheiro: `bun run test:e2e -- ocorrencias`. Logs da app: `E2E_LOGS=1 bun run test:e2e`.
- Cada ficheiro arranca a app inteira (`AppModule` + `configurarApp`, como o `main.ts`) com o ambiente de `test/e2e/ambiente.ts`: sem IA, sem embeddings, sem S3, sem fornecedor de SMS (ficam `enviada` pelo log), sem ElevenLabs, segredos de teste. As migrações correm no arranque e o seed (`test/e2e/fixtures/seed.sql`, município `teste`) carrega-se uma vez. A geocodificação é falsa (`ctx.geo.moradas`): nada sai para a rede.
- Helpers em `test/e2e/app.ts`: `arrancarApp`, `ferramenta` (headers do ElevenLabs), `novaChamada` (conversa e telefone únicos por teste), `entrarPainel` (link mágico → JWT), `criarUtilizador`, `seguirLink` (`/r/:codigo` → token), `smsPara`, `esperarAte` (poll à BD para os jobs, sem sleeps). Os ficheiros partilham a BD da execução e correm em série: cada teste cria os seus dados e filtra pelos seus ids.
- Bugs conhecidos ficam como `it.failing` com uma nota (passam enquanto o bug existir; quando for corrigido, o jest avisa para os passar a `it`).

## Superfícies

| Prefixo | Quem chama | Autenticação |
|---|---|---|
| `POST /v1/agent/tools/{nome}` | ElevenLabs durante a chamada | `X-Agente-Segredo` + `X-Municipio` (+ `X-Conversa-Id`, `X-Telefone`, `X-Telefone-Web`) |
| `GET /v1/agent/tools` | Nós, para configurar o ElevenLabs | `X-Agente-Segredo` |
| `/v1/webhooks/*` | ElevenLabs, SMS, pagamentos, email | Assinatura de cada fornecedor (`req.rawBody`) |
| `/v1/public/*` | Páginas dos links do SMS | Token do objeto (`token_publico`) ou código do link |
| `/v1/chat/*` | Chat no site e na app | Sessão anónima |
| `/v1/painel/*` | Painel da câmara | `Authorization: Bearer` (link mágico → JWT) + perfil |
| `POST /v1/painel/auth/juri` | Acesso do júri, só de leitura (até `JURI_ATE`) | A chave `JURI_CHAVE`, ou o email `JURI_EMAIL` no pedido de link |
| `/v1/app/*` | App do munícipe (Flutter) | `Authorization: Bearer tca_…` (entrada por código SMS) |
| `/v1/mcp/{municipio}` | Assistentes de IA (porta MCP): só informação | — |
| `/v1/mcp/{municipio}/{chave}` | A ligação pessoal de um munícipe ao seu assistente | Chave autorizada por SMS (`/v1/public/ias/*`) |
| `GET /v1/public/avaliacao/{municipio}` | Página pública `/avaliacao` | — (só execuções medidas; `AVALIACAO_TAPAR` tapa nomes) |
| `GET /v1/public/ao-vivo/{municipio}` | Slide "Ao vivo" do pitch (SSE, anonimizado) | `?token=` = `AO_VIVO_PUBLICO_TOKEN` |
| `GET /v1/docs` | OpenAPI (JSON) | Em produção só com `OPENAPI_PUBLICO=true` |
| `GET /r/{codigo}` | O link que vai no SMS | — |

## Estrutura

```
src/
  common/        erros, validação (zod), paginação, idempotência, pedido, numeração, dias úteis, CSV
  config/        toda a configuração (.env) num só ficheiro
  database/      pool pg, transações, migrações no arranque
  ferramentas/   o que é uma ferramenta do agente e o registo de todas
  ia/            ClaudeService (fora da chamada: extrair com zod, escrever), texto externo
                 delimitado (nao-confiavel), dados pessoais tirados (minimizar), custo e uso
  agente-voz/    gerar, medir e sincronizar os agentes do ElevenLabs a partir do registo
  jobs/          pg-boss: filas e cron no próprio Postgres
  scripts/       os comandos de `bun run` acima
  modules/       ~70 módulos, um por área:
    base partilhada (globais): municipios, municipes, conversas, comunicacao (SMS,
      email, links curtos), armazenamento (S3), auditoria, auth (painel, permissões,
      acesso do júri), agent-tools (controller das ferramentas)
    atendimento: conhecimento (fontes, respostas, avaliação), atendimento, chat,
      chamadas-saida, ao-vivo, emails, reclamacoes, marcacoes, porta-ias, app-municipe
    processos e território: requerimentos, processos, licencas, ordenamento,
      ocorrencias, pagamentos, entregas, empresas
    câmara: painel, relatorios, concelho, emergencias, avisos-zona, campanhas, apoios,
      juntas, demo, pesquisa…
db/migrations/   NNNN_nome.sql, aplicadas por ordem; uma aplicada nunca se edita
db/seed/<slug>/  dados reais de um município (bun run db:seed)
```

## Convenções

**Genérico, nunca Guimarães no código.** Tudo filtra por `municipio_id`; o que é de cada câmara está nos dados (seed).

**Nomes em português**, como o domínio. JSON de resposta em `snake_case`, igual às colunas. Dinheiro em cêntimos (`integer`), datas ISO com fuso, telefones E.164.

**Erros**: lançar `ErroApi(HttpStatus.X, 'codigo_estavel', 'Mensagem para pessoas.', detalhes?)`. O filtro global devolve `{ erro: { codigo, mensagem, detalhes } }`. Quem consome decide pelo `codigo`.

**Validação**: `validar(esquemaZod, body)` em todos os corpos e queries. Nada de class-validator.

**SQL**: `this.db.query<Linha>(sql, params)` ou `this.db.transaction(async (tx) => ...)`. Parâmetros sempre `$n`, nunca concatenar valores. Serviços que podem correr dentro de uma transação aceitam `tx?: Tx`.

**Ferramentas do agente**: definidas com `ferramenta({ nome, descricao, entrada, executar })` num `<dominio>.ferramentas.ts` e registadas no `onModuleInit` do módulo com `RegistoFerramentas.registar(...)` (ver `modules/conhecimento`). A descrição é para o modelo: quando usar e o que fazer com o resultado. O resultado volta ao modelo: curto e com o que ele tem de dizer. Orçamento p95 < 400 ms; o que é lento vai para jobs. O chat corre as mesmas ferramentas.

Headers a configurar em cada ferramenta (webhook) do agente no ElevenLabs:

| Header | Valor | Para quê |
|---|---|---|
| `X-Agente-Segredo` | o `AGENTE_SEGREDO` | só o ElevenLabs chama as ferramentas |
| `X-Municipio` | o slug do município (ex.: `guimaraes`) | escolhe o município |
| `X-Conversa-Id` | `{{system__conversation_id}}` | liga tudo à conversa |
| `X-Telefone` | `{{system__caller_id}}` | o munícipe pelo número de onde liga |
| `X-Telefone-Web` | `{{telefone}}` | chamada pelo browser (página `/ligar`): aí não há `system__caller_id` e a página manda o número na variável dinâmica `telefone`. Só se usa quando o `X-Telefone` vem vazio ou inválido |

No fim da chamada (webhook `post_call_transcription`) vale a mesma regra: o número é o `system__caller_id` e, sem ele (ou inválido), o `telefone` das `dynamic_variables`. A variável `telefone` tem de existir no agente (valor por omissão vazio) para o ElevenLabs não recusar as chamadas por telefone.

**Painel**: `@Controller('painel/...')` + `@Painel('recurso')` (permissões em `modules/auth/permissoes.ts`), `@MunicipioAtual()` e `@UtilizadorAtual()`. Listas com `esquemaPaginacao` + `pagina()` → `{ itens, proximo_cursor }`. Ações sensíveis (ouvir gravação, reatribuir, aprovar) vão para `AuditoriaService.registar`.

**Público**: `@Controller('public/...')`. Requerimentos, ocorrências e marcações abrem-se pelo `token_publico`; resumo, processo e pagamento pelo código do link (`LinksCurtosService.resolver(codigo, tipo)`). Nunca dados pessoais completos (NIF, morada inteira de terceiros).

**Webhooks**: `@Controller('webhooks/...')`, verificar a assinatura com `req.rawBody` antes de tudo, idempotentes (o fornecedor repete).

**Jobs**: `JobsService.trabalhar(nome, fn)` no `onModuleInit`, `agendar(nome, cron)` para horários (fuso de Lisboa), `enviar(nome, dados, { singletonKey })` para pôr na fila.

**Mensagens**: SMS só por `MensagensService.sms({ ..., chave })` (idempotente, conta segmentos); links por `LinksCurtosService.criar()`. Email por `MensagensService.email()`.

**Simulado à vista**: `pagamentos.modo_teste = true`, `assinatura = 'simulada'`. As respostas e o painel mostram-no.

**Sem fornecedor configurado, não se finge**: em dev escreve no log; em produção 503 ou `falhou`.

**IA fora da chamada**: `ClaudeService.extrair(esquemaZod, { sistema, conteudo, esforco })` para JSON validado, `escrever()` para texto. O `sistema` fica em cache: nada de datas ou ids lá dentro.
