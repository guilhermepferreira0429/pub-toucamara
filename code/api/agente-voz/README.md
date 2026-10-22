# Agente de voz (ElevenLabs)

A configuração dos **dois agentes de voz** vive aqui e é **gerada a partir do código**. Não se edita à mão no ElevenLabs: muda-se o código e sincroniza-se.

- **`entrada/`**: o agente que atende quem liga (a linha telefónica e o `/ligar`). Todas as ferramentas do atendimento, sem as exclusivas das chamadas da câmara.
- **`saida/`**: o agente das chamadas que a câmara faz (campanhas, emergências, antecipações, renovações, processos, consultas e apoios). As exclusivas dessas chamadas mais o núcleo para quando a pessoa aproveita para perguntar outra coisa.

Cada ferramenta diz em que agentes aparece (`agentes` em `ferramenta({ … })`: `'entrada'`, `'saida'`, `'chat'`; por omissão entrada e chat). Está sempre registada uma vez só: a rota `/v1/agent/tools/{nome}` corre qualquer uma, de qualquer agente. O chat mostra as que têm `'chat'` (sem `motivo_da_chamada` nem `resposta_campanha`).

| Ficheiro (em cada pasta) | O que é | De onde vem |
|---|---|---|
| `ferramentas.json` | As ferramentas desse agente como webhook tools do ElevenLabs (`tool_config`): nome, descrição, `POST ${API_URL}/v1/agent/tools/{nome}`, headers e o esquema dos parâmetros | `RegistoFerramentas` (o zod, a descrição e os `agentes` de cada `ferramenta({ … })`) |
| `prompt.md` | O prompt de sistema desse agente: o mesmo núcleo (como responder, o que as ferramentas devolvem, como falar, SMS) e as secções próprias (turistas e início da chamada na entrada; "esta chamada foi feita pela câmara" na saída) | `src/agente-voz/prompt-voz.ts` + `src/ferramentas/regras-gerais.ts` + `agente_config` do município |
| `agente.json` | Primeira mensagem, idioma, voz e ritmo, variáveis dinâmicas, eventos para o `/ligar`, webhooks, recolha do consentimento. `_notas` explica cada valor `null` | `agente_config`, `municipios`, `src/agente-voz/configuracao.ts` |

### Peso das ferramentas (tokens em cada resposta)

A descrição e o esquema de cada ferramenta vão no contexto de **todas** as respostas do agente: pesam no custo, na latência da voz e na escolha da ferramenta. O `gerar` mostra o peso de cada agente (tokens ≈ caracteres / 4, `src/agente-voz/medir.ts`) e o teste de alinhamento falha acima de `LIMITE_TOKENS` (entrada 8 800, saída 3 000; o limite da entrada subiu de 8 500 para 8 800 em out. para o catálogo de serviços da V4).

| | Ferramentas | Tokens das ferramentas | Prompt |
|---|---|---|---|
| Antes (um só agente, out. 2026) | 53 | ≈ 15 400 | ≈ 2 500 |
| Entrada (22/10) | 48 | ≈ 8 556 | ≈ 2 766 |
| Saída (22/10) | 16 | ≈ 2 293 | ≈ 1 957 |

Para não voltar a crescer:
- **Descrição = quando usar + o que devolve**, em 1–2 frases, mais só o que é próprio dessa ferramenta. As regras gerais (diz o "dizer", segue a "instrucao", pergunta o que falta, confirma antes de agir, valores de demonstração, pagamentos de teste, erros) estão **uma vez** em `src/ferramentas/regras-gerais.ts` e entram nos prompts da voz, do chat e da porta para IAs.
- Parâmetros: descrições curtas, sem exemplos longos; enums em vez de texto.
- Ferramenta nova numa chamada da câmara? `agentes: ['entrada', 'saida', 'chat']` só se a pessoa precisar dela numa chamada nossa.

### Licenças: duas ferramentas para os seis tipos

`campos_da_licenca(tipo)` diz o que perguntar (campo, pergunta, obrigatório, formato, valores), a partir do zod de cada tipo (`src/modules/licencas/ferramentas.ts`, uma só fonte de verdade); `pedir_licenca(tipo, dados)` valida com o esquema desse tipo e pede pelo caminho de sempre (`LicencasService.pedir`: decisão automática, taxa, pagamento, PDF, SMS). Se faltar ou estiver mal algum dado, devolve `em_falta`/`invalidos` em português e não pede nada. `renovar_licenca` fica à parte: não precisa do tipo nem dos dados (lê os da licença anterior e pergunta só o que mudou).

### Chamadas de saída

As chamadas que a câmara faz (`chamadas-saida`) usam `agente_config.elevenlabs_agent_id_saida` (migração `0082`); se estiver vazio, usam o de entrada (`elevenlabs_agent_id`), que não tem as ferramentas das campanhas, emergências e antecipações (o painel avisa: `agente_saida_configurado: false`). O webhook do início e o do fim da chamada reconhecem os dois ids como do mesmo município. Como o id de entrada, define-se na BD:

```sql
UPDATE agente_config SET elevenlabs_agent_id_saida = '<agent_id>' WHERE municipio_id = (SELECT id FROM municipios WHERE slug = 'guimaraes');
```

A volta do agente à chamada para juntar um familiar (`juncao_familiar`) entra pela linha da câmara, logo pelo agente de entrada (é o número da linha que escolhe o agente): por isso `estado_familiar` é do de entrada.

Os ficheiros não têm valores de ambiente nem segredos, só marcadores resolvidos no `diff`/`sincronizar`: `${API_URL}`, `${MUNICIPIO}` (header `X-Municipio`) e `${SEGREDO:toucamara_agente_segredo}` (o id do segredo no ElevenLabs).

## Comandos (em `code/api`; `npm run` ou `bun run`)

```bash
npm run agente-voz -- gerar                 # escreve entrada/ e saida/ (precisa da BD para o agente_config) e mostra o peso
npm run agente-voz -- diff                  # gera e compara com o ElevenLabs
npm run agente-voz -- sincronizar           # = diff (não muda nada)
npm run agente-voz -- sincronizar --confirmar   # aplica
```

Opções: `--municipio <slug>` (por omissão `guimaraes`), `--agente-entrada <id>` (por omissão `agente_config.elevenlabs_agent_id`; `--agente <id>` continua a valer), `--agente-saida <id>` (por omissão `agente_config.elevenlabs_agent_id_saida`), `--criar-segredo` (com `--confirmar`: cria o segredo a partir do `AGENTE_SEGREDO`), `--base <url>` (outra região da API do ElevenLabs, ex.: residência de dados na UE), `--sem-bd` (gera o prompt e o `agente.json` mesmo sem BD, com `null`).

- Precisa de `ELEVENLABS_API_KEY` para o `diff` e o `sincronizar`; sem ela diz que só gerou os ficheiros.
- `API_URL` tem de ser o endereço HTTPS público da API (o ElevenLabs chama-o). Com `localhost` o `diff` avisa e o `sincronizar` recusa.
- O `diff` e o `sincronizar` tratam os dois agentes, um de cada vez (as ferramentas são do workspace e partilhadas: as de um agente não aparecem como obsoletas no outro).
- **Depois de mudar uma ferramenta** (nome, descrição, zod, `agentes`): `npm run agente-voz -- gerar` e commit. O teste `src/agente-voz/alinhamento.spec.ts` falha se um agente não tiver exatamente as ferramentas que o código lhe dá, se o prompt não falar delas (ou citar uma que o agente não tem), se uma ferramenta não tiver descrição ou se o peso passar do limite; o e2e `agente-voz` compara os ficheiros com o que o registo gera.

### O que o `sincronizar --confirmar` faz

1. Cria as ferramentas em falta e atualiza as alteradas. **Nossas** são as webhook tools cujo URL acaba em `/v1/agent/tools/{nome}` com o mesmo nome (incluindo as que foram criadas à mão com outro domínio: passam a apontar para o `API_URL`).
2. **Nunca apaga ferramentas.** As alheias (outro URL, system tools como `end_call`) ficam como estão e continuam no agente. Se uma alheia tiver o nome de uma das nossas, não se cria a nossa e o `diff` mostra o conflito. As nossas que deixaram de existir na API saem só da lista do agente.
3. Atualiza o agente: `tool_ids` (as alheias que já tinha + as nossas), o prompt de `prompt.md` e o que está em `agente.json` sem os `null`, por cima da configuração que lá está (o resto do agente não se perde).
4. É idempotente: corrido outra vez, o `diff` diz "O ElevenLabs está igual ao repositório" e não escreve nada.

## Segredos a criar no ElevenLabs

1. **Agents › Secrets** (segredos do workspace): `toucamara_agente_segredo` com o **mesmo valor** do `AGENTE_SEGREDO` da API. As ferramentas mandam-no no header `X-Agente-Segredo` (e o webhook de início de chamada também). Alternativa: `sincronizar --confirmar --criar-segredo` cria-o a partir do `AGENTE_SEGREDO`.
2. **Webhook do fim da chamada** (é do workspace, não do agente): Settings › Webhooks, URL `${API_URL}/v1/webhooks/elevenlabs/conversa-terminada`, com HMAC. Copiar o segredo HMAC para `ELEVENLABS_WEBHOOK_SECRET` da API e, se quiser que o agente o use, o id para `platform_settings.workspace_overrides.webhooks.post_call_webhook_id` em `agente.json` (está `null`).
3. Para usar a voz e o ritmo do painel (`ELEVENLABS_SOBREPOR_VOZ=true`): o `agente.json` já autoriza os overrides `tts.voice_id` e `tts.speed`.

## Checklist para a demo

- [x] `AGENTE_SEGREDO`, `ELEVENLABS_API_KEY` e `API_URL` (HTTPS público) configurados na API; segredo `toucamara_agente_segredo` criado no ElevenLabs (22/10)
- [x] `npm run agente-voz -- diff` sem conflitos; depois `npm run agente-voz -- sincronizar --confirmar` (22/10)
- [ ] `npm run agente-voz -- diff` outra vez, depois de cada mudança nas ferramentas: "O ElevenLabs está igual ao repositório"
- [ ] No ElevenLabs, confirmar que a voz e o modelo de TTS são multilingues (português) e que o agente responde em português de Portugal
- [ ] Criar o segundo agente no ElevenLabs (saída), pôr o id em `agente_config.elevenlabs_agent_id_saida` e sincronizar outra vez
- [ ] Abrir `/ligar` (com `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` = o agente de **entrada**) e testar três ferramentas que não estavam no agente:
  - [ ] **`o_que_posso_fazer`**: "Quero fazer um anexo de 15 m² no quintal, na Rua de Santo António, 12": diz se é isento, comunicação prévia ou licença, com a fonte
  - [ ] **`campos_da_licenca` + `pedir_licenca`**: "Vou fazer uma festa no sábado, das 20h à meia-noite, com música": pergunta os campos um a um, confirma os dados lendo-os de volta e diz que vai SMS
  - [ ] **`que_apoios_tenho`**: "Tenho 70 anos e a renda está difícil": diz os apoios e pergunta se quer pedir (`pedir_apoio`)
- [ ] Ver no painel (Conversas → ficha) que as ferramentas ficaram ligadas à conversa e que o SMS do fim ficou gravado

## O que ficou por confirmar no formato do ElevenLabs

O formato segue o SDK oficial `@elevenlabs/elevenlabs-js` 2.74.0 (out. 2026); a documentação web não estava acessível ao gerar isto. Confirmar numa conta real:

- `preencher_campo.campos` é um objeto de chaves livres (`z.record`): vai como objeto sem propriedades. Confirmar que o modelo manda as chaves (é a única perda; o `diff` avisa).
- Que o `PATCH /v1/convai/agents/{id}` aceita a configuração completa de volta (é o que o CLI do ElevenLabs faz) e o campo `prompt.timezone`.
- Que os `dynamic_variable_placeholders` servem de valor quando a variável não chega (chamada pelo browser sem o webhook de início).
- O código de idioma: vai `pt`; não se confirmou se há um `pt-PT` próprio.
- Os parâmetros sem descrição no zod (lista em `avisos` de `ferramentas.json`) vão com o nome do campo como descrição: convém descrevê-los no zod.

## Próximo passo (só nota, não implementado): catálogo também para as ferramentas raras

As áreas da V4 (escolas, reservas, estacionamento, habitação, cemitérios, animais, água, junta) já estão num catálogo: `outros_servicos` diz o que há e `pedir_servico` pede, com uma linha por área no prompt. O passo seguinte é pôr no mesmo catálogo as ferramentas raras que ainda estão soltas (arquivo, deliberações, turismo, empresa, cartas): poupa mais ~2–3 mil tokens, mas pode piorar esses fluxos (o agente pode não saber que existem). **Avaliar com o avaliador** (`code/avaliador`, as 180 perguntas) antes e depois: taxa de acerto e ferramenta escolhida; aplicar só se não cair. Precisa da `ANTHROPIC_API_KEY` (o juiz) e da `ELEVENLABS_API_KEY` (o adaptador `tou-voz` simula a conversa com o agente publicado).

Como comparar (em `code/avaliador`):

```bash
# 1. Antes: o agente de entrada como está
bun run avaliador executar --sistema "Tou, Câmara? · Guimarães · voz" --motivo manual          # → execução A
bun run avaliador avaliar --execucao <A>

# 2. Depois: um agente de TESTE no ElevenLabs com a variante (num branch), sincronizado só para ele
#    (as ferramentas são do workspace: a variante só acrescenta outros_servicos; as raras continuam
#    a existir para o agente de produção, só saem da lista do agente de teste)
(cd ../api && npm run agente-voz -- sincronizar --confirmar --agente-entrada <id-agente-teste>)
bun run avaliador sistemas criar --nome "Tou, Câmara? · Guimarães · voz (catálogo)" --adaptador tou-voz \
  --municipio guimaraes --config '{"agent_id":"<id-agente-teste>"}' --nosso
bun run avaliador executar --sistema "Tou, Câmara? · Guimarães · voz (catálogo)" --motivo manual   # → execução B
bun run avaliador avaliar --execucao <B>

# 3. Taxa de acerto (global e por tema) e as divergências
bun run avaliador relatorio comparar --execucoes <A>,<B> --pdf

# 4. Ferramenta escolhida, pergunta a pergunta (o adaptador grava-as em avaliacao.respostas.ferramentas)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" -c "SELECT p.ordem, p.categoria, a.ferramentas AS antes, b.ferramentas AS depois
  FROM avaliacao.respostas a JOIN avaliacao.respostas b USING (pergunta_id)
  JOIN avaliacao.perguntas p ON p.id = a.pergunta_id
  WHERE a.execucao_id = '<A>' AND b.execucao_id = '<B>' AND a.ferramentas IS DISTINCT FROM b.ferramentas
  ORDER BY p.ordem"
```
