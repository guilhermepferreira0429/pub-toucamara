# Avaliador

Avalia o nosso agente (chat e voz) e as assistentes que as câmaras já têm nos sites, com as mesmas perguntas, o mesmo gabarito e o mesmo juiz. Design: [`docs/superpowers/specs/2026-10-19-avaliador-design.md`](../../docs/arquivo/superpowers/specs/2026-10-19-avaliador-design.md).

**Como o juiz decide:**
- cada pergunta tem uma resposta certa (o gabarito), escrita a partir das fontes oficiais e aprovada por uma pessoa;
- o juiz (Claude) compara a resposta dada com a certa e diz se está certa, se foi bem passada a um funcionário, se está errada ou se ficou sem resposta, e explica porquê;
- inventar um número ou um facto conta sempre como errado;
- passar a um funcionário uma pergunta que o pede (urgência, caso pessoal) conta como certo.

**Escala por categorias (v2, rubrica `2026-10-23.2`).** Ao lado do veredicto certa/errada, que continua a sair das mesmas regras (`src/juiz/regras.ts`) para as rondas antigas continuarem comparáveis, cada avaliação grava uma categoria:
- respondeu: `certa`, `maioritariamente_certa`, `parcialmente_certa`, `maioritariamente_errada`, `errada`;
- não respondeu: `mandou_contactar`, `nao_encontrou`, `inconclusiva`, `sem_resposta`.

Cada facto obrigatório do gabarito é E (essencial) ou S (secundário); sem classificação, todos contam como E. O juiz descreve a resposta (factos certos e em falta, erros graves e menores, se só manda contactar, se diz que não encontrou, se manda ligar 112) e a categoria sai de 10 regras puras, pela ordem (`src/juiz/categorias.ts`, códigos `C1` a `C10`, gravados em `regra_categoria`). O juiz diz também se a resposta chega para o munícipe (`suficiente`: sim, em parte, não) e dá a sua leitura (`categoria_juiz`), que serve só para encontrar regras mal calibradas. Nota de 0 a 100: certa 100, maioritariamente certa 75, parcialmente certa 50, maioritariamente errada 25, as outras 0; reporta-se sempre com a distribuição.

Os resultados medidos estão públicos em [`/avaliacao`](https://toucamara.descortina.pt/avaliacao). A assistente do site nunca aparece pelo nome: lá chama-se "a assistente do site da Câmara Municipal de …".

Dados no esquema `avaliacao` do Postgres da API (migrações `0022` e `0101`, a da escala v2: colunas novas em `avaliacoes` e `gabarito.factos_secundarios`, vista `resultados_categorias`). A API lê os resultados para três sítios:
- o painel (Qualidade);
- o bloqueio de publicação (≥ 80%);
- a página pública `/avaliacao` (`GET /v1/public/avaliacao/:municipio`, só execuções medidas, nunca as de demonstração).

## Arrancar

```bash
cp .env.example .env        # DB_*, ANTHROPIC_API_KEY (o juiz), ANTHROPIC_MODEL, API_URL, AGENTE_SEGREDO,
                            # ELEVENLABS_API_KEY (só para o sistema tou-voz), PASTA_SAIDA (capturas e relatórios)
bun install
npx playwright install chromium
bun run avaliador ajuda
bun run test
```

## Fluxo

```bash
# 1. Perguntas (as 180 base) e sistemas
bun run avaliador perguntas importar src/perguntas/perguntas-base.json
bun run avaliador sistemas preparar-base --municipios guimaraes,matosinhos

# 2. Gabarito do município: o Claude propõe, uma pessoa revê
bun run avaliador gabarito propor --municipio guimaraes
bun run avaliador gabarito exportar --municipio guimaraes > revisao.md   # editar e marcar [x] aprovar
bun run avaliador gabarito importar revisao.md --por "Nome"

# 3. Executar e avaliar
bun run avaliador executar --sistema "Tou, Câmara? · Guimarães · chat" --motivo pitch
bun run avaliador executar --sistema "<assistente do site> · Guimarães" --motivo pitch   # ritmo de pessoa: ~2 h para 180
bun run avaliador repetir-erros --execucao <id>       # volta a perguntar só as que deram erro
bun run avaliador avaliar --execucao <id> [--lote]

# 3b. Escala v2: classificar os factos (uma vez) e reavaliar execuções antigas sem voltar a perguntar
bun run avaliador gabarito essenciais docs/avaliacao/escala/essenciais.json --municipio guimaraes [--seco]
bun run avaliador reavaliar --execucao <id> [--lote]

# 4. Calibrar o juiz e relatórios
bun run avaliador calibrar exportar --execucoes <id,id> > calibrar.md
bun run avaliador calibrar importar calibrar.md --por "Nome"
bun run avaliador relatorio comparar --execucoes <id,id> --pdf
bun run avaliador relatorio auditoria --municipio matosinhos --pdf
bun run avaliador relatorio pitch
```

Outros comandos (`bun run avaliador ajuda` mostra todos):

| Comando | O que faz |
|---|---|
| `perguntas listar` | As perguntas de um conjunto |
| `sistemas listar` | Os sistemas, com o número de execuções e a última |
| `gabarito estado --municipio <slug>` | Quantas perguntas têm gabarito aprovado, proposto ou em falta, por categoria |
| `gabarito essenciais <ficheiro.json> --municipio <slug>` | Grava a classificação E/S dos factos (`[{"ordem":1,"factos":[{"facto":"...","tipo":"E"}]}]`); `--seco` só mostra |
| `reavaliar --execucao <id>` | Passa as respostas já dadas pelo juiz com a rubrica atual, sem perguntar outra vez ao sistema; retoma onde parou (`--todas` repete tudo) e compara o veredicto com a rubrica anterior |
| `calibrar concordancia --execucoes <id,id>` | Acordo juiz × pessoa (kappa de Cohen) e as discordâncias |
| `pedidos trabalhar [--uma-vez]` | Trata os pedidos que chegam da API ("Correr teste agora" no painel, fontes mudadas, versão nova do agente): executa e avalia. No servidor fica a correr |

Sistemas sem adaptador: `importar-respostas --sistema <nome> respostas.csv` (`pergunta;resposta`).

## Regras de uso dos sistemas de outros

Uma pergunta de cada vez, 20–40 s entre perguntas, conversa nova por pergunta, sem dados pessoais, e aviso se já houve uma execução ao mesmo sistema nas últimas 24 h. As capturas de ecrã ficam em `PASTA_SAIDA` com data e hora.
