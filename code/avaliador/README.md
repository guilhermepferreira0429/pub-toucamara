# Avaliador

Avalia o nosso agente (chat e voz) e o assistente do site de cada câmara com as mesmas perguntas, o mesmo gabarito e o mesmo juiz. Design: [`docs/superpowers/specs/2026-10-19-avaliador-design.md`](../../docs/superpowers/specs/2026-10-19-avaliador-design.md).

Dados no esquema `avaliacao` do Postgres da API (migração `0022`). A API lê os resultados para o painel (Qualidade) e para o gate de publicação (≥ 80%).

## Arrancar

```bash
cp .env.example .env        # DB_*, ANTHROPIC_API_KEY, API_URL, AGENTE_SEGREDO
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
bun run avaliador executar --sistema "Assistente do site · Guimarães" --motivo pitch     # ritmo de pessoa: ~2 h para 180
bun run avaliador avaliar --execucao <id> [--lote]

# 4. Calibrar o juiz e relatórios
bun run avaliador calibrar exportar --execucoes <id,id> > calibrar.md
bun run avaliador calibrar importar calibrar.md --por "Nome"
bun run avaliador relatorio comparar --execucoes <id,id> --pdf
bun run avaliador relatorio auditoria --municipio matosinhos --pdf
bun run avaliador relatorio pitch
```

Sistemas sem adaptador: `importar-respostas --sistema <nome> respostas.csv` (`pergunta;resposta`).

## Regras de uso dos sistemas de outros

Uma pergunta de cada vez, 20–40 s entre perguntas, conversa nova por pergunta, sem dados pessoais, e aviso se já houve uma execução ao mesmo sistema nas últimas 24 h. As capturas de ecrã ficam em `PASTA_SAIDA` com data e hora.
