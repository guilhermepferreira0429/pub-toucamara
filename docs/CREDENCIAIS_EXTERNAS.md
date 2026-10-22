# Credenciais e acessos externos

O que depende de entidades de fora (AMA, câmara, fornecedores) para passar de
simulado a real. Cada secção diz o que já está pronto, o que é simulado e o
que falta, com quem tem de o fazer. Prazos e custos só quando os soubermos de
fonte certa; o resto fica "a confirmar".

Nenhum segredo neste ficheiro: as variáveis estão documentadas em
`code/api/.env.example` e os valores vão para o cofre de segredos do ambiente.

---

## Entregar o pedido em nome da pessoa

Fonte: `docs/material/Tou, Câmara — Funcionalidades que tiram trabalho.pdf`
("Entregar o pedido em nome da pessoa — Submeter no balcão online. Depois de
confirmar, o agente entrega. 🔜 precisa de autenticação com Chave Móvel
Digital"; "Entregar documentos com validade legal em nome do munícipe só
depois da autenticação real").

### O que já está pronto

- **Fluxo completo, de ponta a ponta** (migração `0065_entrega_em_nome.sql`,
  módulo `code/api/src/modules/entregas`):
  1. Ferramenta do agente `entregar_pedido` (voz e chat). Na primeira chamada
     devolve o resumo do requerimento para ler à pessoa e um código dessa
     versão; só avança com `confirmado: true`, o código e as palavras com que
     a pessoa confirmou (um "não" ou "espere" é recusado). Se o pedido mudar
     depois, o código deixa de bater certo e é preciso confirmar de novo.
  2. SMS (gravado em `mensagens_saida`) com o link
     `{WEB_URL}/entrega/{token}`, válido 24 horas (`ENTREGA_VALIDADE_HORAS`).
  3. Página do munícipe: rever o pedido, marcar o consentimento ("Autorizo a
     câmara a entregar este pedido em meu nome") e "Autorizar com Chave Móvel
     Digital".
  4. Autenticação (adaptador `AutenticacaoCidadao`), verificação de que quem
     se autenticou é o requerente (NIF comparado por hash; nunca guardado em
     claro), submissão (adaptador `SubmissaoBalcao`), processo criado ou
     atualizado, comprovativo PDF, SMS com o número de entrada.
  5. Estados: preparado → à espera de autorização → autorizado → entregue
     (ou falhou / expirou / cancelado). Uma entrega viva por requerimento
     (índice único), submissão com a linha bloqueada: não se entrega duas
     vezes. Falha do balcão → "falhou", e o painel tenta de novo sem pedir
     nova autorização.
  6. Auditoria de cada passo (`audit_log`, objeto `entrega_em_nome`):
     confirmação (palavras, canal, conversa), link enviado, consentimento,
     autenticações recusadas, autorização (nível de garantia, fornecedor, NIF
     mascarado, IP), entrega (número, documentos, processo), falhas,
     cancelamentos, expiração. Sempre com `simulado: true|false`.
- **Painel**: `/painel/entregas` (modo atual, o que falta, lista, histórico,
  comprovativo, tentar de novo, cancelar) e o cartão "Entrega em nome do
  munícipe" na ficha do processo e no requerimento ao vivo.
- **Esqueletos reais, por configurar**: adaptador `cmd`
  (`autenticacao-cidadao.ts`) e adaptador `balcao` (`submissao-balcao.ts`).
  Escolhidos por `ENTREGA_AUTENTICACAO=cmd` e `ENTREGA_SUBMISSAO=balcao`; sem
  configuração recusam com "Autenticação com Chave Móvel Digital por
  configurar — falta a credenciação na AMA" (e o equivalente para o balcão),
  e o painel mostra "real, por configurar" com as variáveis em falta.

### O que é simulado (e está marcado como tal)

- **Autenticação** (`ENTREGA_AUTENTICACAO=simulada`, por omissão): a página
  `/entrega/{token}/autorizar` imita o passo da Chave Móvel Digital
  (telemóvel + PIN de demonstração `1234`, mostrado no ecrã) com o aviso
  grande "Simulação — sem validade legal". A identidade devolvida é a que a
  câmara já tem do requerente; nível de garantia `simulado`.
- **Submissão** (`ENTREGA_SUBMISSAO=simulada`): número de entrada numa série
  própria `DEMO-AAAA/NNNNNN`; nada sai para fora. `ENTREGA_SUBMISSAO_TAXA_FALHA`
  faz falhar de propósito uma fração das submissões, para mostrar o "tentar
  de novo".
- **Comprovativo**: PDF com a marca de água diagonal "SIMULAÇÃO — SEM
  VALIDADE LEGAL" e o aviso no topo; título e assunto do PDF também o dizem.
- **SMS e página**: "DEMONSTRAÇÃO: sem validade legal". O requerimento fica
  com `assinatura = 'simulada'`.

Nada disto pode ser apresentado como uma entrega com validade legal.

### O que falta

#### 1. Credenciação na AMA (Chave Móvel Digital e Cartão de Cidadão)

Adesão ao **Fornecedor de Autenticação do Estado** (autenticacao.gov), gerido
pela AMA, para a câmara poder pedir a autenticação dos munícipes com a Chave
Móvel Digital e o Cartão de Cidadão.

| Passo | Quem | Notas |
|---|---|---|
| Pedido de adesão / protocolo entre a câmara e a AMA | **A câmara** (é ela a entidade que presta o serviço e que fica responsável pelos dados) | Termos, formulários e prazos: a confirmar com a AMA |
| Escolher o protocolo de integração (SAML 2.0 ou OAuth 2.0) e os atributos a pedir (pelo menos NIF e nome completo) | **Nós**, com a AMA | A confirmar com a AMA o que está disponível para este caso e o nível de garantia de cada meio |
| Certificado da entidade (para assinar os pedidos, no caso SAML) | **A câmara** obtém/emite; **nós** instalamos no cofre | Requisitos do certificado: a confirmar com a AMA |
| Registar o URL de retorno: `{API_URL}/v1/public/entregas/autenticacao/retorno` (um por ambiente) | **Nós** damos os URLs; **a câmara**/AMA registam | |
| Acesso ao ambiente de testes da AMA | **A câmara** pede; **nós** testamos | Endereço e credenciais de teste: a confirmar com a AMA |
| Ligar a validação da resposta no adaptador `cmd` (assinatura, destinatário, validade, `state`, atributos, nível de garantia) e testar ponta a ponta no ambiente de testes | **Nós** | Hoje o `retorno()` do `cmd` recusa com "por ligar" de propósito |
| Passagem a produção (novos URLs, certificados, valores) | **A câmara** e **nós** | A confirmar com a AMA |

Variáveis (ver `code/api/.env.example`): `ENTREGA_AUTENTICACAO=cmd`,
`CMD_PROTOCOLO`, `CMD_URL_BASE`, `CMD_CLIENT_ID` (OAuth 2.0),
`CMD_SAML_ENTITY_ID`, `CMD_SAML_CERTIFICADO`, `CMD_SAML_CHAVE_PRIVADA` (SAML),
`CMD_ATRIBUTOS`.

#### 2. Acesso de submissão ao balcão online

Para a entrega chegar de verdade à câmara, o adaptador `balcao` tem de falar
com o balcão online onde a câmara recebe os pedidos (o balcão próprio da
câmara, do fornecedor dela, ou o ePortugal, conforme o serviço).

| Passo | Quem | Notas |
|---|---|---|
| Dizer qual é o balcão de destino para cada tipo de pedido | **A câmara** | |
| Documentação da API de submissão, credenciais e ambiente de testes | **A câmara** pede ao fornecedor do balcão (ou à AMA, no caso do ePortugal) | Forma de autenticação (chave, OAuth2, certificado), rede (VPN/IP autorizado) e prazos: a confirmar com o fornecedor |
| Confirmar que o balcão aceita a submissão em nome do munícipe com a identidade autenticada pela Chave Móvel Digital | **A câmara**, com o fornecedor/AMA | Condição para haver validade legal |
| Preencher `SubmissaoBalcaoOnline.submeter` (requerimento, anexos, referência externa como chave de idempotência; devolver número de entrada e data/hora) | **Nós** | |

Variáveis: `ENTREGA_SUBMISSAO=balcao`, `BALCAO_URL`, `BALCAO_CREDENCIAL`.

#### 3. Antes de ligar o modo real

- Proteção de dados: rever com o encarregado de proteção de dados da câmara o
  texto do consentimento, o registo de auditoria e a retenção. **A câmara.**
- Rever os textos para o munícipe (SMS, página, comprovativo) sem a menção a
  "simulação". **Nós**, com a câmara.
- Só depois de 1 e 2 estarem testados se muda `ENTREGA_AUTENTICACAO` e
  `ENTREGA_SUBMISSAO`; o painel passa a mostrar "modo real".

---

## Avisos de emergência: números de toda a zona

Fonte: `docs/A_MEIO.md` (linha "Avisos de emergência em massa": falta "a
fonte externa com os números de toda a zona (operadores / cell broadcast /
ANEPC-SMPC)" e "acordo com a Proteção Civil ou operadores").

### O que já está pronto

- **Fonte "Todas as pessoas na zona (operadores)"** (`FonteOperadores`, em
  `code/api/src/modules/emergencias/operadores.ts`): dado o município e a zona
  do aviso (freguesias, polígono ou ponto + raio) dá primeiro uma estimativa
  (pessoas e telemóveis na zona, para o plano de tempo e custo) e depois os
  números por páginas (E.164, zona aproximada, origem), com reenvio das páginas
  que falham. Junta-se às fontes que já existiam sem duplicar números: se um
  número também é de um munícipe conhecido, da ação social ou da lista, conta
  como essa pessoa real e mantém o canal dela.
- **Cell broadcast** (`CellBroadcast`): pedido por área + texto, sem números,
  com o estado da difusão (pedida → em difusão → concluída; cancelada ao
  encerrar), guardado em `emergencia_difusoes` (migração
  `0072_emergencias_operadores.sql`).
- **Painel** `/painel/emergencias`: escolher "Todas as pessoas na zona
  (operadores)" e/ou "Cell broadcast"; o plano mostra quantos números vêm de
  cada fonte, quantos são novos, o tempo e o custo (também à escala real);
  o acompanhamento mostra as contagens por fonte e por estado e o estado da
  difusão.
- **Esqueletos reais, por configurar**: `EMERGENCIAS_OPERADORES=operadores`
  (`OPERADORES_URL`, `OPERADORES_CREDENCIAL`) e
  `EMERGENCIAS_CELL_BROADCAST=cell_broadcast` (`CELL_BROADCAST_URL`,
  `CELL_BROADCAST_CREDENCIAL`). Sem configuração recusam com "por configurar —
  falta acordo com a ANEPC / operadores" (o plano diz "por configurar"; o envio
  com cell broadcast é recusado). Com configuração recusam com "por ligar" até
  haver a especificação do serviço.

### O que é simulado (e está marcado como tal)

- **Por omissão as duas são simuladas** (`EMERGENCIAS_OPERADORES=simulada`,
  `EMERGENCIAS_CELL_BROADCAST=simulada`). A fonte simulada gera números falsos
  no formato `+351 9X 99N NNNN`, sempre os mesmos para a mesma zona, em
  quantidade proporcional à população da zona × `EMERGENCIAS_SIMULADA_ESCALA`
  (0,02 por omissão). Latência (`EMERGENCIAS_SIMULADA_LATENCIA_MS`) e falhas de
  página (`EMERGENCIAS_SIMULADA_TAXA_ERRO`) configuráveis, para mostrar o
  reenvio. A difusão simulada tem a referência `CB-DEMO-…`.
- **População por freguesia e densidade no mapa: valores de demonstração**
  (`POPULACAO_DEMONSTRACAO` em `operadores.regras.ts`, `demonstracao: true`).
  Não são os Censos 2021; substituir pelos resultados do INE por freguesia.
- **Regra de segurança**: os números simulados podem coincidir com números
  reais de pessoas. Nunca saem para o Twilio, o ElevenLabs ou outro
  fornecedor, em nenhum ambiente, mesmo com `SMS_PROVIDER=twilio`. A barreira
  está no ponto de envio (`comunicacao/destino-simulado.ts`, usada no
  `MensagensService` e nas chamadas de saída, a mesma que trava a gama de
  demonstração `+351 910 000 xxx`): cada mensagem/chamada tem `simulado = true`,
  fica gravada e aparece como "enviado (simulado)". Os números simulados nunca
  viram munícipes nem entram na campanha de chamadas; a BD recusa uma linha
  simulada com a referência de um fornecedor.

### O que falta

| Passo | Quem | Notas |
|---|---|---|
| Acordo com a ANEPC (e/ou a proteção civil municipal) e os operadores móveis para a câmara pedir avisos à população de uma zona | **A câmara** | Base legal, termos e prazos: a confirmar com a ANEPC |
| Decidir o modelo: o operador entrega os números à câmara, ou o operador envia ele próprio (SMS por área / cell broadcast) e a câmara só pede | **A câmara**, com a ANEPC / operadores | Muda o adaptador: no segundo caso a fonte dos operadores não devolve números, só o estado do envio |
| Acordo de tratamento de dados (RGPD) e retenção dos números recebidos | **A câmara** (encarregado de proteção de dados) | A confirmar |
| Especificação do serviço (endereço, autenticação, formato da área, contagem, páginas, estados da difusão), ambiente de testes e credenciais | **Operadores / ANEPC**; **nós** integramos | A confirmar |
| Preencher `FonteOperadoresReal` e `CellBroadcastReal` e testar no ambiente de testes | **Nós** | |
| Custo por SMS de área e por difusão de cell broadcast | **Operadores / ANEPC** | A confirmar; o painel mostra "a confirmar" e não inventa valores |
| Trocar a população de demonstração pelos Censos 2021 do INE por freguesia (ou usar a contagem do operador) | **Nós** | |

Só depois de testado no ambiente de testes se muda `EMERGENCIAS_OPERADORES` e
`EMERGENCIAS_CELL_BROADCAST`; o painel deixa de mostrar a pílula "simulado".
