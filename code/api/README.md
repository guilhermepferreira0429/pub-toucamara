# API Tou, Câmara?

NestJS + Postgres 17 (pgvector) com SQL à mão. Plano completo, modelo de dados e rotas: [`docs/PLANS/api-e-modelo-de-dados.md`](../../docs/PLANS/api-e-modelo-de-dados.md).

## Arrancar

```bash
docker compose -f ../../env/dev/docker-compose.yml up -d   # Postgres na porta 54330
cp .env.example .env                                       # e preencher
bun install
bun run start:dev                                          # migrações correm no arranque
bun run db:reset                                           # dev: recomeçar a BD do zero
bun run test && bun run lint
```

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
| `POST /v1/agent/tools/{nome}` | ElevenLabs durante a chamada | `X-Agente-Segredo` + `X-Municipio` (+ `X-Conversa-Id`, `X-Telefone`) |
| `GET /v1/agent/tools` | Nós, para configurar o ElevenLabs | `X-Agente-Segredo` |
| `/v1/webhooks/*` | ElevenLabs, SMS, pagamentos, email | Assinatura de cada fornecedor (`req.rawBody`) |
| `/v1/public/*` | Páginas dos links do SMS | Token do objeto (`token_publico`) ou código do link |
| `/v1/chat/*` | Chat no site e na app | Sessão anónima |
| `/v1/painel/*` | Painel da câmara | `Authorization: Bearer` (link mágico → JWT) + perfil |
| `GET /r/{codigo}` | O link que vai no SMS | — |

## Estrutura

```
src/
  common/        erros, validação (zod), paginação, idempotência, pedido, numeração, dias úteis
  config/        toda a configuração (.env) num só ficheiro
  database/      pool pg, transações, migrações no arranque
  ferramentas/   o que é uma ferramenta do agente e o registo de todas
  ia/            ClaudeService (Sonnet fora da chamada: extrair com zod, escrever)
  jobs/          pg-boss: filas e cron no próprio Postgres
  modules/
    base partilhada (globais): municipios, municipes, conversas, comunicacao (SMS,
      email, links curtos), armazenamento (S3), auditoria, auth (painel + permissões),
      agent-tools (controller das ferramentas)
    domínios: conhecimento, atendimento, requerimentos, processos, ocorrencias,
      pagamentos, marcacoes, chat, emails, painel, relatorios
db/migrations/   NNNN_nome.sql, aplicadas por ordem; uma aplicada nunca se edita
```

## Convenções

**Genérico, nunca Guimarães no código.** Tudo filtra por `municipio_id`; o que é de cada câmara está nos dados (seed).

**Nomes em português**, como o domínio. JSON de resposta em `snake_case`, igual às colunas. Dinheiro em cêntimos (`integer`), datas ISO com fuso, telefones E.164.

**Erros**: lançar `ErroApi(HttpStatus.X, 'codigo_estavel', 'Mensagem para pessoas.', detalhes?)`. O filtro global devolve `{ erro: { codigo, mensagem, detalhes } }`. Quem consome decide pelo `codigo`.

**Validação**: `validar(esquemaZod, body)` em todos os corpos e queries. Nada de class-validator.

**SQL**: `this.db.query<Linha>(sql, params)` ou `this.db.transaction(async (tx) => ...)`. Parâmetros sempre `$n`, nunca concatenar valores. Serviços que podem correr dentro de uma transação aceitam `tx?: Tx`.

**Ferramentas do agente**: definidas com `ferramenta({ nome, descricao, entrada, executar })` num `<dominio>.ferramentas.ts` e registadas no `onModuleInit` do módulo com `RegistoFerramentas.registar(...)` (ver `modules/conhecimento`). A descrição é para o modelo: quando usar e o que fazer com o resultado. O resultado volta ao modelo: curto e com o que ele tem de dizer. Orçamento p95 < 400 ms; o que é lento vai para jobs. O chat corre as mesmas ferramentas.

**Painel**: `@Controller('painel/...')` + `@Painel('recurso')` (permissões em `modules/auth/permissoes.ts`), `@MunicipioAtual()` e `@UtilizadorAtual()`. Listas com `esquemaPaginacao` + `pagina()` → `{ itens, proximo_cursor }`. Ações sensíveis (ouvir gravação, reatribuir, aprovar) vão para `AuditoriaService.registar`.

**Público**: `@Controller('public/...')`. Requerimentos, ocorrências e marcações abrem-se pelo `token_publico`; resumo, processo e pagamento pelo código do link (`LinksCurtosService.resolver(codigo, tipo)`). Nunca dados pessoais completos (NIF, morada inteira de terceiros).

**Webhooks**: `@Controller('webhooks/...')`, verificar a assinatura com `req.rawBody` antes de tudo, idempotentes (o fornecedor repete).

**Jobs**: `JobsService.trabalhar(nome, fn)` no `onModuleInit`, `agendar(nome, cron)` para horários (fuso de Lisboa), `enviar(nome, dados, { singletonKey })` para pôr na fila.

**Mensagens**: SMS só por `MensagensService.sms({ ..., chave })` (idempotente, conta segmentos); links por `LinksCurtosService.criar()`. Email por `MensagensService.email()`.

**Simulado à vista**: `pagamentos.modo_teste = true`, `assinatura = 'simulada'`. As respostas e o painel mostram-no.

**Sem fornecedor configurado, não se finge**: em dev escreve no log; em produção 503 ou `falhou`.

**IA fora da chamada**: `ClaudeService.extrair(esquemaZod, { sistema, conteudo, esforco })` para JSON validado, `escrever()` para texto. O `sistema` fica em cache: nada de datas ou ids lá dentro.
