# Validar as regras da análise de projetos

> Gerado a partir do código (`code/api/src/modules/processos/checklist-regras.ts`) com `npm run checklist-regras` (em `code/api`). Não edite à mão: o teste `checklist-regras.spec.ts` falha se este ficheiro não corresponder ao código. As respostas dos técnicos registam-se numa cópia (impressa ou PDF) e passam para o código.

**Para quem:** os técnicos de urbanismo da câmara. **Para quê:** confirmar, tipo de operação a tipo de operação, o que as verificações automáticas fazem antes de o técnico abrir o processo (V4 #2).

Como preencher: em cada linha, marque **certo** ou **errado**; se estiver errado, escreva o valor correto e o artigo (PDM, RGEU, RJUE, Portaria n.º 113/2015, regulamento municipal…). O que diz **valor de demonstração** ainda não vem de uma fonte oficial: foi posto para mostrar o motor.

Lembrete: a leitura da IA **nunca aprova nada**. Só aponta (com a folha onde viu) e fica sempre "a confirmar pelo técnico". As regras abaixo são determinísticas: o mesmo processo dá sempre o mesmo resultado.

Técnico: ______________________ · Data: ____/____/______ · Assinatura: ______________________

## 0. Regras comuns a todos os tipos de operação

### 0.1 Parâmetros das zonas do PDM

Os limites com que se comparam as medidas, por zona de demonstração (ERC = Espaço residencial consolidado; CH = Centro Histórico; EA = Espaço agrícola; EF = Espaço florestal (Penha)). Fonte no código: `PARAMETROS_DEMONSTRACAO` (`perfis-verificacao.ts`). Quando a câmara carrega os parâmetros do seu PDM (`zonas_pdm.parametros`), estes deixam de contar.

| Parâmetro | ERC | CH | EA | EF | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|---|---|
| Índice de implantação máximo | 0,5 | — | 0,05 | — | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Índice de construção máximo | 0,8 | — | 0,05 | — | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Pisos acima do solo (máximo) | 2 | 3 | 1 | 1 | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Cércea máxima | 7,5 m | 10 m | 4,5 m | — | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento mínimo às extremas | 3 m | — | 5 m | — | Regulamento do PDM / RGEU (a indicar o artigo) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento mínimo à via | 5 m | — | — | — | Regulamento do PDM (alinhamentos) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Distância mínima da piscina às extremas | 3 m | — | — | — | Regulamento municipal ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Altura máxima de muro à face da via | 1,5 m | 1,5 m | 1,2 m | — | Regulamento municipal de urbanização ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Altura máxima de muro entre vizinhos | 2 m | 2 m | 1,5 m | — | Regulamento municipal de urbanização ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Usos admitidos | habitação, comércio, serviços, restauração e bebidas, alojamento local | habitação, comércio, serviços, restauração e bebidas, alojamento local | apoio agrícola, habitação | nenhum uso de construção | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Estacionamento mínimo (lugares por fogo ou unidade) | habitação 1, comércio 1, serviços 1, restauração e bebidas 2, alojamento local 1 | sem mínimo | sem mínimo | — | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Centro histórico (carta de cores) | — | sim | — | — | a indicar · **valor de demonstração** | ☐ certo ☐ errado |  |

### 0.2 Plausibilidade e tolerância dos números

Um número que a IA lê fora do intervalo plausível (ou na unidade errada) é posto de parte e fica "por verificar". Entre o desenhado e o declarado, uma diferença maior do que a tolerância dá "não batem certo" (atenção).

| Medida | Unidade | Intervalo plausível | Tolerância desenhado × declarado | Fonte | Certo? | Valor correto |
|---|---|---|---|---|---|---|
| Área do lote | m² | 20 a 1000000 | 2% (mínimo 0,5 m²) | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área da obra | m² | 0,5 a 10000 | 2% (mínimo 0,5 m²) | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área de implantação total | m² | 2 a 100000 | 2% (mínimo 0,5 m²) | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área de construção total | m² | 2 a 200000 | 2% (mínimo 0,5 m²) | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Pisos acima do solo | pisos | 1 a 30 (inteiro) | tem de ser igual | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Cércea | m | 2 a 80 | 0,05 m | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento às extremas (o menor) | m | 0 a 500 | 0,05 m | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento à via | m | 0 a 500 | 0,05 m | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Altura do muro | m | 0,2 a 5 | 0,05 m | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento | lugares | 0 a 500 (inteiro) | tem de ser igual | regra interna · **valor de demonstração** | ☐ certo ☐ errado |  |

### 0.3 Limites da leitura pela IA

| Limite | Valor atual | Certo? | Valor correto |
|---|---|---|---|
| Documentos por leitura | 5 | ☐ certo ☐ errado |  |
| Páginas por leitura (o que passa fica "por ler") | 100 | ☐ certo ☐ errado |  |
| Tamanho total por leitura | 20 MB | ☐ certo ☐ errado |  |

## 1. Alteração interior (`interior`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas

Nenhuma: esta operação não compara números. Devia comparar algum? ______________________

### Controlo prévio no PDM para "obras dentro de casa"

| Zona | Degraus atuais | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | sempre: não precisa de pedir nada à câmara | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | sempre: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | sempre: não precisa de pedir nada à câmara | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | sempre: não precisa de pedir nada à câmara | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · Paredes a abrir ou a demolir e se o projeto diz que não são estruturais.
- ☐ certo ☐ errado · Se a fachada e a cobertura ficam como estão.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · Se a parede a abrir é mesmo não estrutural (sem planta de estruturas, pedir ao técnico autor).
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 2. Ampliação ou anexo (`ampliacao`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | obrigatório (falta → falha) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Levantamento topográfico | obrigatório (falta → falha) | `levantamento` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de estabilidade | recomendado (falta → atenção) | `estabilidade\|estruturas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Fotografias do existente | recomendado (falta → atenção) | `fotografia` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Área da obra | Área máxima dos degraus do PDM para esta obra, só quando acima deles não é permitido | ERC: sem limite; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (degraus da obra) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área de implantação total | Índice de implantação da zona × área do lote. | ERC: ≤ 0,5 × área do lote; CH: sem limite; EA: ≤ 0,05 × área do lote; EF: sem limite | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área de construção total | Índice de construção da zona × área do lote. | ERC: ≤ 0,8 × área do lote; CH: sem limite; EA: ≤ 0,05 × área do lote; EF: sem limite | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Pisos acima do solo | Número máximo de pisos da zona. | ERC: ≤ 2 pisos; CH: ≤ 3 pisos; EA: ≤ 1 piso; EF: ≤ 1 piso | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Cércea | Cércea máxima da zona. | ERC: ≤ 7,5 m; CH: ≤ 10 m; EA: ≤ 4,5 m; EF: sem limite | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento às extremas (o menor) | Afastamento mínimo às extremas do lote. | ERC: ≥ 3 m; CH: sem limite; EA: ≥ 5 m; EF: sem limite | Regulamento do PDM / RGEU (a indicar o artigo) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM para "ampliação da casa"

| Zona | Degraus atuais | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | até 50 m²: precisa de uma comunicação prévia; acima: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | sempre: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | sempre: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | sempre: não é permitido nesta zona | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · A área da ampliação e a área de implantação total desenhadas (quadro de áreas e planta de implantação).
- ☐ certo ☐ errado · A área de construção total, o número de pisos acima do solo e a cércea (cortes e alçados).
- ☐ certo ☐ errado · O menor afastamento às extremas do lote, cotado na planta de implantação.
- ☐ certo ☐ errado · A área do lote, se estiver escrita.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · A inserção da ampliação na envolvente e a qualidade arquitetónica.
- ☐ certo ☐ errado · Se a ampliação mexe na estrutura existente.
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 3. Construção nova de moradia (`construcao_nova`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | obrigatório (falta → falha) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Levantamento topográfico | obrigatório (falta → falha) | `levantamento` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de estabilidade | obrigatório (falta → falha) | `estabilidade\|estruturas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projetos de especialidades (águas, esgotos, eletricidade, térmica) | obrigatório (falta → falha) | `especialidades\|[aá]guas\|esgotos\|t[eé]rmic` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Área de implantação total | Índice de implantação da zona × área do lote. | ERC: ≤ 0,5 × área do lote; CH: sem limite; EA: ≤ 0,05 × área do lote; EF: sem limite | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Área de construção total | Índice de construção da zona × área do lote. | ERC: ≤ 0,8 × área do lote; CH: sem limite; EA: ≤ 0,05 × área do lote; EF: sem limite | Regulamento do PDM (índices da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Pisos acima do solo | Número máximo de pisos da zona. | ERC: ≤ 2 pisos; CH: ≤ 3 pisos; EA: ≤ 1 piso; EF: ≤ 1 piso | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Cércea | Cércea máxima da zona. | ERC: ≤ 7,5 m; CH: ≤ 10 m; EA: ≤ 4,5 m; EF: sem limite | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento às extremas (o menor) | Afastamento mínimo às extremas do lote. | ERC: ≥ 3 m; CH: sem limite; EA: ≥ 5 m; EF: sem limite | Regulamento do PDM / RGEU (a indicar o artigo) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento à via | Afastamento mínimo à via. | ERC: ≥ 5 m; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (alinhamentos) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento (habitação) | Estacionamento mínimo para habitação. | ERC: ≥ 1 lugar; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Classe de espaço (o uso pretendido é admitido na zona?)

| Zona | Usos admitidos (atual) | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | habitação, comércio, serviços, restauração e bebidas, alojamento local | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | habitação, comércio, serviços, restauração e bebidas, alojamento local | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | apoio agrícola, habitação | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | nenhum uso de construção | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM

O motor do PDM não tem esta operação: contam só os parâmetros da zona (acima). Está bem assim? ☐ sim ☐ não

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · Área de implantação e de construção totais (quadro de áreas).
- ☐ certo ☐ errado · Número de pisos acima do solo e cércea (cortes e alçados).
- ☐ certo ☐ errado · Afastamentos às extremas e à via, cotados na planta de implantação.
- ☐ certo ☐ errado · Lugares de estacionamento dentro do lote.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · A inserção urbana, o alinhamento com os vizinhos e a qualidade arquitetónica.
- ☐ certo ☐ errado · As infraestruturas (água, esgotos, acesso) e eventuais cedências.
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 4. Piscina (`piscina`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | obrigatório (falta → falha) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de estabilidade | recomendado (falta → atenção) | `estabilidade\|estruturas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Área da obra | Área máxima dos degraus do PDM para esta obra, só quando acima deles não é permitido | ERC: sem limite; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (degraus da obra) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Afastamento às extremas (o menor) | Distância mínima da piscina às extremas do lote. | ERC: ≥ 3 m; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento municipal ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM para "piscina"

| Zona | Degraus atuais | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | até 50 m²: precisa de uma comunicação prévia; acima: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | sempre: não é permitido nesta zona | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | sempre: não é permitido nesta zona | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | sempre: não é permitido nesta zona | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |

### Perguntas de sim/não à IA

| Elemento | Pergunta | Resposta esperada | Certo? | Correção |
|---|---|---|---|---|
| Casa das máquinas da piscina | Se a casa das máquinas (filtragem e bombagem) está desenhada, onde e com que dimensão. | sim (não → atenção) | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · A área do plano de água (planta).
- ☐ certo ☐ errado · A menor distância da piscina às extremas do lote, cotada na planta.
- ☐ certo ☐ errado · Onde fica a casa das máquinas e se está desenhada.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · A drenagem e o destino da água da piscina.
- ☐ certo ☐ errado · A segurança (vedação da piscina) e o impacto nos vizinhos.
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 5. Muro de vedação (`muro`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | obrigatório (falta → falha) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Altura do muro (à face da via) | Altura máxima de muro confinante com a via pública. | ERC: ≤ 1,5 m; CH: ≤ 1,5 m; EA: ≤ 1,2 m; EF: sem limite | Regulamento municipal de urbanização ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Altura do muro (entre vizinhos) | Altura máxima de muro entre vizinhos. | ERC: ≤ 2 m; CH: ≤ 2 m; EA: ≤ 1,5 m; EF: sem limite | Regulamento municipal de urbanização ou PDM (a indicar) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM para "muro de vedação"

| Zona | Degraus atuais | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | até 1,8 m de altura: não precisa de pedir nada à câmara; acima: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | sempre: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | até 1,5 m de altura: não precisa de pedir nada à câmara; acima: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | sempre: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |

### Perguntas de sim/não à IA

| Elemento | Pergunta | Resposta esperada | Certo? | Correção |
|---|---|---|---|---|
| Muro confinante com a via pública | Se o muro confronta com a via pública (arruamento ou passeio), pela planta. | informativo (não falha) | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · A altura do muro cotada no alçado (do lado da via, se confronta com ela).
- ☐ certo ☐ errado · Se o muro confronta com a via pública e o alinhamento proposto.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · O alinhamento do muro face à via (recuos, alargamentos previstos, visibilidade nos cruzamentos).
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 6. Alteração de fachada ou janelas (`fachada`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Fotografias do existente | obrigatório (falta → falha) | `fotografia` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | recomendado (falta → atenção) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Cércea | Cércea máxima da zona. | ERC: ≤ 7,5 m; CH: ≤ 10 m; EA: ≤ 4,5 m; EF: sem limite | Regulamento do PDM · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM para "mudar a fachada (abrir porta ou janela, pintar de outra cor)"

| Zona | Degraus atuais | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | sempre: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | sempre: precisa de licença | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | sempre: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | sempre: precisa de uma comunicação prévia | PDM de Guimarães · regulamento · **valor de demonstração** | ☐ certo ☐ errado |  |

### Perguntas de sim/não à IA

| Elemento | Pergunta | Resposta esperada | Certo? | Correção |
|---|---|---|---|---|
| Materiais e cores do exterior | Se os materiais, as cores e a caixilharia do exterior estão indicados, e quais. | sim (não → atenção) | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · O que muda nos alçados: vãos, caixilharia, cores, materiais, cobertura.
- ☐ certo ☐ errado · Os materiais e as cores indicados (no centro histórico têm de seguir a carta de cores).
- ☐ certo ☐ errado · Se a cércea se mantém.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · A conformidade com a carta de cores e materiais, sobretudo no centro histórico.
- ☐ certo ☐ errado · A harmonia com o conjunto (edifícios vizinhos, frente de rua).
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 7. Demolição (`demolicao`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Plano de demolição | obrigatório (falta → falha) | `plano de demoli` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Plano de prevenção e gestão de resíduos de construção e demolição | obrigatório (falta → falha) | `res[ií]duos\|\bRCD\b` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Fotografias do existente | obrigatório (falta → falha) | `fotografia` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | recomendado (falta → atenção) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas

Nenhuma: esta operação não compara números. Devia comparar algum? ______________________

### Controlo prévio no PDM

O motor do PDM não tem esta operação: contam só os parâmetros da zona (acima). Está bem assim? ☐ sim ☐ não

### Perguntas de sim/não à IA

| Elemento | Pergunta | Resposta esperada | Certo? | Correção |
|---|---|---|---|---|
| Plano de demolição | Se há plano de demolição: o que se demole, por que ordem, com que meios e como se protege a via e os vizinhos. | sim (não → atenção) | ☐ certo ☐ errado |  |
| Materiais com amianto | Se os documentos referem fibrocimento ou amianto (coberturas, tubagens, painéis). | não (sim → atenção) | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · O plano de demolição: o que se demole, faseamento, meios e proteção da via e dos vizinhos.
- ☐ certo ☐ errado · Referências a fibrocimento ou amianto (coberturas, tubagens).

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · O valor patrimonial do que se demole e se a demolição é admissível.
- ☐ certo ☐ errado · A remoção de amianto, se houver, por empresa habilitada.
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________

## 8. Mudança de uso (`mudanca_uso`)

### Documentos exigidos

| Documento | Exigência | Reconhecido pelo nome (expressão) | Fonte | Certo? | Correção |
|---|---|---|---|---|---|
| Certidão do registo predial | obrigatório (falta → falha) | `certid[aã]o\|registo predial` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Termo de responsabilidade do autor do projeto | obrigatório (falta → falha) | `termo\s+de\s+responsabilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Projeto de arquitetura (memória e peças desenhadas) | obrigatório (falta → falha) | `arquite(c)?tura\|pe[cç]as desenhadas` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Planta de localização | obrigatório (falta → falha) | `planta de localiza\|extrato.*(pdm\|planta)\|ortofoto` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Plano de acessibilidades | obrigatório (falta → falha) | `acessibilidade` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Segurança contra incêndio (ficha ou projeto) | obrigatório (falta → falha) | `inc[eê]ndio\|\bSCIE\b` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |
| Fotografias do existente | recomendado (falta → atenção) | `fotografia` | Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração · **valor de demonstração** | ☐ certo ☐ errado |  |

Falta algum documento que a câmara exige para esta operação? ______________________

### Medidas verificadas (lido nos desenhos × declarado × permitido)

| Medida | Como se calcula o permitido | Valor atual por zona | Fonte | Certo? | Valor correto / artigo |
|---|---|---|---|---|---|
| Lugares de estacionamento (habitação) | Estacionamento mínimo para habitação. | ERC: ≥ 1 lugar; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento (comércio) | Estacionamento mínimo para comércio. | ERC: ≥ 1 lugar; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento (serviços) | Estacionamento mínimo para serviços. | ERC: ≥ 1 lugar; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento (restauração e bebidas) | Estacionamento mínimo para restauração e bebidas. | ERC: ≥ 2 lugares; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |
| Lugares de estacionamento (alojamento local) | Estacionamento mínimo para alojamento local. | ERC: ≥ 1 lugar; CH: sem limite; EA: sem limite; EF: sem limite | Regulamento do PDM (parâmetros de estacionamento) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Classe de espaço (o uso pretendido é admitido na zona?)

| Zona | Usos admitidos (atual) | Fonte | Certo? | Correção |
|---|---|---|---|---|
| ERC · Espaço residencial consolidado | habitação, comércio, serviços, restauração e bebidas, alojamento local | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| CH · Centro Histórico | habitação, comércio, serviços, restauração e bebidas, alojamento local | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| EA · Espaço agrícola | apoio agrícola, habitação | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |
| EF · Espaço florestal (Penha) | nenhum uso de construção | Regulamento do PDM (usos da classe de espaço) · **valor de demonstração** | ☐ certo ☐ errado |  |

### Controlo prévio no PDM

O motor do PDM não tem esta operação: contam só os parâmetros da zona (acima). Está bem assim? ☐ sim ☐ não

### Perguntas de sim/não à IA

| Elemento | Pergunta | Resposta esperada | Certo? | Correção |
|---|---|---|---|---|
| Acessibilidades | Se o projeto mostra entrada sem degraus (ou rampa) e instalação sanitária adaptada. | sim (não → atenção) | ☐ certo ☐ errado |  |

### O que a IA procura nos desenhos

- ☐ certo ☐ errado · O uso atual e o uso proposto, e a área afeta ao novo uso.
- ☐ certo ☐ errado · Os lugares de estacionamento previstos.
- ☐ certo ☐ errado · Acessibilidades: entrada sem degraus ou rampa, instalação sanitária adaptada.

### Fica sempre para o técnico (nem a regra nem a IA decidem)

- ☐ certo ☐ errado · A compatibilidade do novo uso com a vizinhança (ruído, cargas e descargas).
- ☐ certo ☐ errado · As condições de segurança contra incêndio e de salubridade.
- ☐ certo ☐ errado · A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.

Falta alguma coisa? ______________________
