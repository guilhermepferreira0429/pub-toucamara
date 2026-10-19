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
