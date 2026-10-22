# Agente de voz (ElevenLabs)

A configuração do agente que atende o `/ligar` (e a linha telefónica) vive aqui e é **gerada a partir do código**. Não se edita à mão no ElevenLabs: muda-se o código e sincroniza-se.

| Ficheiro | O que é | De onde vem |
|---|---|---|
| `ferramentas.json` | As 48 ferramentas como webhook tools do ElevenLabs (`tool_config`): nome, descrição, `POST ${API_URL}/v1/agent/tools/{nome}`, headers e o esquema dos parâmetros | `RegistoFerramentas` (o zod e a descrição de cada `ferramenta({ … })`) |
| `prompt.md` | O prompt de sistema da voz | `src/agente-voz/prompt-voz.ts` (regras do chat adaptadas à voz) + `agente_config` do município |
| `agente.json` | Primeira mensagem, idioma, voz e ritmo, variáveis dinâmicas, eventos para o `/ligar`, webhooks, recolha do consentimento. `_notas` explica cada valor `null` | `agente_config`, `municipios`, `src/agente-voz/configuracao.ts` |

Os ficheiros não têm valores de ambiente nem segredos, só marcadores resolvidos no `diff`/`sincronizar`: `${API_URL}`, `${MUNICIPIO}` (header `X-Municipio`) e `${SEGREDO:toucamara_agente_segredo}` (o id do segredo no ElevenLabs).

## Comandos (em `code/api`)

```bash
npm run agente-voz -- gerar                 # escreve os 3 ficheiros (precisa da BD para o agente_config)
npm run agente-voz -- diff                  # gera e compara com o ElevenLabs
npm run agente-voz -- sincronizar           # = diff (não muda nada)
npm run agente-voz -- sincronizar --confirmar   # aplica
```

Opções: `--municipio <slug>` (por omissão `guimaraes`), `--agente <id>` (por omissão `agente_config.elevenlabs_agent_id`), `--criar-segredo` (com `--confirmar`: cria o segredo a partir do `AGENTE_SEGREDO`), `--base <url>` (outra região da API do ElevenLabs, ex.: residência de dados na UE), `--sem-bd` (gera o prompt e o `agente.json` mesmo sem BD, com `null`).

- Precisa de `ELEVENLABS_API_KEY` para o `diff` e o `sincronizar`; sem ela diz que só gerou os ficheiros.
- `API_URL` tem de ser o endereço HTTPS público da API (o ElevenLabs chama-o). Com `localhost` o `diff` avisa e o `sincronizar` recusa.
- **Depois de mudar uma ferramenta** (nome, descrição, zod): `npm run agente-voz -- gerar` e commit. O teste `src/agente-voz/alinhamento.spec.ts` falha se uma ferramenta registada não estiver em `ferramentas.json` (ou o prompt não falar dela), e o e2e `agente-voz` compara o ficheiro com o que o registo gera.

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

- [ ] `AGENTE_SEGREDO`, `ELEVENLABS_API_KEY` e `API_URL` (HTTPS público) configurados na API; segredo `toucamara_agente_segredo` criado no ElevenLabs
- [ ] `npm run agente-voz -- diff` sem conflitos; depois `npm run agente-voz -- sincronizar --confirmar`
- [ ] `npm run agente-voz -- diff` outra vez: "O ElevenLabs está igual ao repositório"
- [ ] No ElevenLabs, confirmar que a voz e o modelo de TTS são multilingues (português) e que o agente responde em português de Portugal
- [ ] Abrir `/ligar` (com `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` = o mesmo agente) e testar três ferramentas que não estavam no agente:
  - [ ] **`o_que_posso_fazer`**: "Quero fazer um anexo de 15 m² no quintal, na Rua de Santo António, 12": diz se é isento, comunicação prévia ou licença, com a fonte
  - [ ] **`pedir_licenca_ruido`**: "Vou fazer uma festa no sábado, das 20h à meia-noite, com música": confirma os dados lendo-os de volta e diz que vai SMS
  - [ ] **`que_apoios_tenho`**: "Tenho 70 anos e a renda está difícil": diz os apoios e pergunta se quer pedir (`pedir_apoio`)
- [ ] Ver no painel (Conversas → ficha) que as ferramentas ficaram ligadas à conversa e que o SMS do fim ficou gravado

## O que ficou por confirmar no formato do ElevenLabs

O formato segue o SDK oficial `@elevenlabs/elevenlabs-js` 2.74.0 (out. 2026); a documentação web não estava acessível ao gerar isto. Confirmar numa conta real:

- `preencher_campo.campos` é um objeto de chaves livres (`z.record`): vai como objeto sem propriedades. Confirmar que o modelo manda as chaves (é a única perda; o `diff` avisa).
- Que o `PATCH /v1/convai/agents/{id}` aceita a configuração completa de volta (é o que o CLI do ElevenLabs faz) e o campo `prompt.timezone`.
- Que os `dynamic_variable_placeholders` servem de valor quando a variável não chega (chamada pelo browser sem o webhook de início).
- O código de idioma: vai `pt`; não se confirmou se há um `pt-PT` próprio.
- Os parâmetros sem descrição no zod (lista em `avisos` de `ferramentas.json`) vão com o nome do campo como descrição: convém descrevê-los no zod.
