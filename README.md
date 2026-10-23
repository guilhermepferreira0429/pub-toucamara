# Tou, Câmara?

**A câmara inteira numa só plataforma. Uma porta para o munícipe, um sistema para a câmara.**

O munícipe liga, escreve no chat, manda um SMS ou usa a app, a qualquer hora, e trata do assunto na conversa com um assistente que só responde com informação oficial. Quando há alguma coisa a fazer, é a câmara que liga primeiro. Por trás, a câmara recebe tudo no mesmo sistema: os pedidos chegam completos, o que é simples decide-se sozinho e as pessoas ficam com o que precisa de uma pessoa.

Hack4Guimarães 2035 · Desafio "Falar com a câmara sem burocracia".

## Experimentar

| | |
|---|---|
| Apresentação | [toucamara.descortina.pt](https://toucamara.descortina.pt) |
| Ligar (chamada no browser, sem instalar nada) | [toucamara.descortina.pt/ligar](https://toucamara.descortina.pt/ligar) |
| Uma renovação de ponta a ponta, com o seu telemóvel | [toucamara.descortina.pt/ligar?experimentar=renovacao](https://toucamara.descortina.pt/ligar?experimentar=renovacao) |
| Chat | [toucamara.descortina.pt/chat](https://toucamara.descortina.pt/chat) |
| Painel da câmara | [toucamara.descortina.pt/entrar](https://toucamara.descortina.pt/entrar) |
| Todas as funcionalidades, com o estado de cada uma | [toucamara.descortina.pt/funcionalidades](https://toucamara.descortina.pt/funcionalidades) |
| Avaliação, pergunta a pergunta | [toucamara.descortina.pt/avaliacao](https://toucamara.descortina.pt/avaliacao) |

## O que faz

**Para o munícipe**

- Respostas com a fonte oficial: o documento, o artigo e a data.
- O concelho inteiro numa só porta: a câmara, as juntas, as empresas municipais e os serviços nacionais.
- O requerimento preenchido durante a conversa, e os documentos verificados por foto antes de entregar.
- Licenças simples decididas na chamada, com PDF e QR; ocorrências com foto e morada; marcações; o estado do processo; a referência para pagar.
- Um funcionário quando é preciso, com o caso resumido. Numa emergência, o 112.

**Liga primeiro**

- Avisa antes de uma licença acabar e renova-a na própria chamada.
- Liga antes de um prazo prejudicar a pessoa, e liga de volta quando o processo avança.
- Numa onda de calor ou num corte de água, liga a quem vive sozinho e se inscreveu.
- Liga a quem pode ter direito a um apoio e ainda não o pediu.

**Para a câmara**

- Uma só entrada para telefone, chat, email e balcão, com cada pedido no serviço e no técnico certos.
- Apoio ao técnico: o projeto de obras analisado antes de ser aberto, o regulamento aplicável e o rascunho do ofício.
- O que cumpre regras públicas decide-se sozinho; uma regra nova pode ser testada contra os pedidos antigos antes de ser aprovada.
- Para a chefia: onde param os processos, perguntas em linguagem normal sobre os números, resumo diário e relatórios.
- Uma app para a equipa de campo, que funciona sem rede.

## Como sabemos que responde bem

O avaliador (`code/avaliador`) faz 180 perguntas de teste ao assistente. Para cada uma há uma resposta certa, escrita a partir das fontes oficiais e revista por uma pessoa. Um juiz automático compara as respostas e explica cada veredicto: passar a um funcionário numa pergunta difícil conta como certo, inventar conta como errado. As mesmas perguntas são feitas à assistente que a câmara já tem no site e avaliadas pelo mesmo juiz. Os resultados estão abertos em [`/avaliacao`](https://toucamara.descortina.pt/avaliacao).

## O que é real e o que é simulado

| | |
|---|---|
| **Funciona de ponta a ponta** | Chamada por voz no browser, chat, respostas com fonte, passagem a funcionário, requerimentos, ocorrências, estado do processo, renovação de licenças, marcações, as chamadas e os SMS da câmara, painel e relatórios |
| **Em modo de teste** (e marcado nos ecrãs) | Pagamentos, Chave Móvel Digital e entrega do pedido em nome da pessoa, ligação à empresa da água, alertas de emergência pelos operadores |
| **Dados de demonstração** | Escolas, habitação, estacionamento, reservas, cemitérios, animais, turismo, juntas, apoios, os valores das licenças e as zonas do PDM |
| **Ainda não** | Número de telefone português: a demonstração é por chamada no browser |

## O repositório

| Pasta | O quê | Com quê |
|---|---|---|
| `code/api` | API central: as ações do assistente, webhooks, chat, painel, páginas públicas e tarefas agendadas | NestJS 11, PostgreSQL 17 com pgvector, SQL à mão |
| `code/web` | Painel da câmara, chat, chamada no browser (`/ligar`) e as páginas dos links do SMS | Next.js 16, React 19, Tailwind 4 |
| `code/mobile` | App do munícipe e app da equipa de campo | Flutter |
| `code/avaliador` | As perguntas de teste, a resposta certa e o juiz | TypeScript (bun) |
| `env/` | Docker e instalação no servidor | Docker, Caddy |
| `docs/` | Acessibilidade, mapas, credenciais externas e as regras da análise de projetos para os técnicos validarem | — |

A voz é do ElevenLabs, ligado às ações da API (`code/api/agente-voz/`). A inteligência artificial é o Claude, da Anthropic, hoje pela API da Anthropic; em produção passaria para o Amazon Bedrock, com processamento na UE. Os SMS saem pelo Twilio.

**Qualidade e confiança:** cerca de 1 660 testes unitários e 79 conjuntos de testes de ponta a ponta na API; acessibilidade WCAG 2.1 AA (0 erros automáticos em 42 páginas, ver `docs/ACESSIBILIDADE.md`); aviso de gravação e consentimento, NIF cifrado, registo de acessos e dados apagados no fim do prazo; segurança por linha na base de dados, para cada câmara e cada junta só ver os seus dados.

## Arrancar em local

```bash
docker compose -f env/dev/docker-compose.yml up -d    # Postgres 17 + pgvector na porta 54330

cd code/api && cp .env.example .env && bun install && bun run start:dev   # migrações no arranque
cd code/web && cp .env.example .env.local && bun install && bun run dev
```

Cada pasta tem o seu README com os pormenores (testes, variáveis, agente de voz, apps).

## Próximos passos

Quase tudo o que falta é acesso, não código: o fluxo já existe e está à espera de uma credencial ou de um acordo.

| Próximo passo | Já existe | Falta |
|---|---|---|
| Número português | Assistente de voz, início e fim da chamada, chamadas feitas pela câmara | Comprar o número e ligá-lo ao assistente |
| Sistemas da câmara | Ligações simuladas à gestão documental, aos pagamentos e à empresa da água | Saber que sistemas a câmara usa e ter acesso; contrato com um fornecedor de pagamentos |
| Chave Móvel Digital | Entregar o pedido em nome da pessoa, de ponta a ponta, em simulação | Credenciação na AMA e acesso ao balcão online |
| Apps nas lojas | App do munícipe e app da equipa de campo | Publicar na Google Play; no iPhone, falta a aprovação da Apple |
| WhatsApp | Canal completo, com o mesmo assistente | Verificação da conta pela Meta |
| Inteligência artificial na Europa | O Claude, hoje pela API da Anthropic | Em produção, o Claude no Amazon Bedrock, com processamento na UE |

Depois, um piloto em Guimarães: medir a taxa de acerto com chamadas reais, os técnicos validarem as regras dos projetos de obras, carregar os dados reais da câmara, ligar as juntas de freguesia e fazer o acordo com a Proteção Civil para os avisos de emergência.

## Equipa

Guilherme Ferreira e David Vieira, desenvolvimento técnico.
