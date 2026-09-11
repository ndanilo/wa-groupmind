<div align="center">

<img src="docs/assets/logo.png" alt="wa-groupmind" width="140">

# wa-groupmind

**Um bot para grupos que transforma `@bot <pergunta>` em uma resposta pesquisada e com fontes — em texto por padrão, ou como um infográfico gerado por IA quando você pede.**

[![CI](https://github.com/ndanilo/wa-groupmind/actions/workflows/ci.yml/badge.svg)](https://github.com/ndanilo/wa-groupmind/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![PRs bem-vindos](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Leia em outros idiomas:** [English](README.md) | **Português (Brasil)** | [Español](README.es.md)

<img src="docs/assets/hero.jpg" alt="Várias perguntas de um grupo convergindo em uma única resposta com fontes" width="100%">

</div>

---

> [!CAUTION]
> **Não oficial, sem qualquer vínculo, e pode banir sua conta.**
>
> Este projeto não é afiliado, endossado nem conectado ao WhatsApp LLC ou à Meta Platforms, Inc.
> Ele conversa com o WhatsApp através do [Baileys](https://github.com/WhiskeySockets/Baileys),
> um cliente de engenharia reversa. O uso automatizado pode violar os
> [Termos de Serviço do WhatsApp](https://www.whatsapp.com/legal/terms-of-service), e a Meta
> bane contas por isso sem aviso.
>
> **Vincule um número de teste que você pode perder — nunca um pessoal ou crítico para o
> negócio.** Para qualquer uso comercial, utilize a
> [Plataforma WhatsApp Business](https://business.whatsapp.com/products/business-platform) oficial.
>
> Leia [DISCLAIMER.md](DISCLAIMER.md) e [PRIVACY.md](PRIVACY.md) antes de colocar no ar.

> [!WARNING]
> **Cada execução custa dinheiro de verdade** no OpenRouter (chat + imagem) e no Tavily (busca).
> Mantenha a concorrência baixa e configure `ALLOWED_GROUP_JIDS` para que estranhos não gastem
> o seu crédito.
>
> A pasta em `AUTH_DIR` guarda credenciais que dão acesso total à conta vinculada. Trate como
> uma senha e mantenha fora do git.

## O que ele faz

Alguém marca o bot em um grupo. Ele pesquisa a pergunta na web ao vivo e responde na mesma
conversa — uma lista de tópicos escaneável por padrão, texto corrido quando pedem explicação, ou
um infográfico gerado quando a pergunta pede uma imagem. Toda resposta factual termina com as
URLs em que ela se baseou.

```
@groupmind qual a taxa de inflação atual?          -> lista de tópicos em negrito, com fontes
@groupmind explica a alta do dólar                 -> explicação em texto corrido
@groupmind faz um infográfico da taxa de juros     -> pôster gerado
```

Uma execução real em um número de teste: menção, confirmação e depois a lista de tópicos com
fontes. Log à esquerda, celular à direita. O log fica legível na
[gravação em resolução original](docs/assets/ai-bot-demo.mp4).

<div align="center">
<img src="docs/assets/ai-bot-demo.gif" alt="Gravação de tela: log do terminal à esquerda e um celular à direita. Uma menção no grupo vira a confirmação e depois uma resposta em tópicos com fontes." width="100%">
</div>

<img src="docs/assets/demo-answer.jpg" alt="Um integrante do grupo marca o bot, chega a confirmação e depois a resposta em tópicos com fontes" width="100%">

## Stack

| Aspecto | Escolha |
| --- | --- |
| Runtime | Node.js 22+ (desenvolvido no 24), ESM |
| Linguagem | TypeScript, strict, resolução `nodenext` |
| WhatsApp | `baileys` 7.x |
| Orquestração | `StateGraph` do `@langchain/langgraph` com roteamento condicional |
| Chat de IA | OpenRouter via `@langchain/openai` + agente com tool calling |
| Busca web | Tavily (`@langchain/tavily`) |
| Imagens | OpenRouter `POST /images` |
| Logs | `pino`, formatado em desenvolvimento |

## Primeiros passos

Você precisa de Node 22 ou mais recente, uma chave do [OpenRouter](https://openrouter.ai/keys),
uma chave do [Tavily](https://app.tavily.com) e um número de WhatsApp que esteja disposto a
arriscar.

```bash
git clone https://github.com/ndanilo/wa-groupmind.git
cd wa-groupmind
npm install
cp .env.example .env
# preencha OPENROUTER_API_KEY, TAVILY_API_KEY e PHONE_NUMBER
npm run dev
```

### Vinculando a conta

São dois caminhos, escolhidos com `PAIRING_MODE`.

**Código de pareamento (`PAIRING_MODE=code`, o padrão)** — defina `PHONE_NUMBER` com o número
que está sendo vinculado, apenas dígitos com código do país e sem `+`. O terminal imprime um
código de 8 caracteres; digite-o em
**Configurações → Dispositivos conectados → Conectar com número de telefone**. `PHONE_NUMBER` é
obrigatório nesse modo e o app se recusa a iniciar sem ele.

**QR code (`PAIRING_MODE=qr`)** — imprime um QR no terminal para escanear em
**Configurações → Dispositivos conectados → Conectar um dispositivo**. Não precisa de
`PHONE_NUMBER`, mas QR codes no terminal frequentemente não são escaneáveis dependendo da sua
fonte e do esquema de cores, e é por isso que não são o padrão.

<img src="docs/assets/demo-pairing.jpg" alt="Saída do terminal mostrando os logs de inicialização e o código de pareamento de oito caracteres" width="100%">

As credenciais ficam em `.auth/` depois do vínculo, então as execuções seguintes reconectam sem
parear de novo.

### Escolhendo o idioma

O bot responde no idioma definido em `OUTPUT_LANGUAGE` (BCP-47, padrão `en`). Uma tag que carrega
região também informa ao Tavily quais fontes priorizar — `pt-BR` prioriza o Brasil, `es-MX`
prioriza o México. Um `en` puro não aplica nenhum reforço regional.

As mensagens operacionais do próprio bot (confirmações, erros, dica de uso) estão em inglês e
ficam em um único lugar: `MESSAGES` em [src/whatsapp/reply.ts](src/whatsapp/reply.ts).

## Como uma requisição flui

Somente mensagens **de grupo** que **marcam o bot** disparam uma execução. Conversas diretas são
ignoradas.

1. O bot verifica a menção, remove o token `@…` e usa o resto como pergunta.
2. Se a pergunta estiver vazia, responde com uma dica de uso curta.
3. Ao aceitar, envia uma confirmação imediata citando a mensagem e inicia o indicador de digitação.
4. O grafo roteia a pergunta, pesquisando e gerando apenas o necessário.
5. A resposta volta **citada**: texto marcando quem perguntou, ou uma imagem cuja legenda é
   `*título*` + subtítulo (mais a lista numerada em rankings).
6. Em qualquer falha, nada é enviado além de um erro amigável, citado e marcando quem perguntou.
   Stack traces ficam no log.

```mermaid
sequenceDiagram
    participant Member as Integrante do grupo
    participant Handler as detector de menção
    participant Queue as pool de workers
    participant Assistant as assistente LangGraph
    participant Tavily
    participant Router as OpenRouter

    Member->>Handler: marca o bot com uma pergunta
    Handler->>Handler: remove o token, checa idade, grupo e allowlist
    Handler->>Queue: admite o job
    Handler-->>Member: confirmação citada, indicador de digitação ligado
    Queue->>Assistant: executa
    Assistant->>Router: classifica modo e needsResearch
    Assistant->>Tavily: busca e extrai as melhores páginas
    Tavily-->>Assistant: notas e URLs das fontes
    Assistant->>Router: escreve a resposta, ou um briefing de pôster
    opt modo imagem
        Assistant->>Router: gera o pôster
    end
    Assistant-->>Queue: resposta em texto, ou imagem com legenda
    Queue-->>Handler: resultado
    Handler-->>Member: resposta citada marcando quem perguntou
```

Tudo antes de "admite o job" é gratuito. Cada seta para o Tavily ou o OpenRouter custa dinheiro,
e é por isso que as travas de admissão abaixo importam.

### O grafo

Texto é o padrão. Uma imagem custa um ciclo de pesquisa, um briefing e uma geração de imagem, por
isso esse ramo só roda quando a pergunta realmente pede uma figura.

```mermaid
flowchart LR
    classify{classify}
    research[research]
    writeAnswer[writeAnswer]
    writeBrief[writeBrief]
    styleRefs[styleRefs]
    renderPrompt[renderPrompt]
    generateImage[generateImage]
    persist[persist]
    done([END])

    classify -->|"texto, sem pesquisa"| writeAnswer
    classify -->|"precisa pesquisar"| research
    research --> writeAnswer
    research -->|"modo imagem"| writeBrief
    writeBrief --> styleRefs --> renderPrompt --> generateImage --> persist --> done
    writeAnswer --> done
```

`classify` decide quatro coisas: **modo** (`text` ou `image`), **needsResearch**, **depth** e
**freshness**.

- Uma passada gratuita por palavras-chave ([src/ai/graph/intent.ts](src/ai/graph/intent.ts))
  captura os pedidos óbvios — `infográfico`, `imagem`, `arte`, `pôster`, `desenha`, além dos
  equivalentes em inglês. Um pedido de imagem sempre implica pesquisa, então ele resolve na hora
  sem pagar por uma chamada de modelo.
- Qualquer coisa ambígua vai para um classificador com temperatura 0 e saída estruturada. Se
  falhar, o fallback é texto pesquisado: uma resposta pesquisada nunca está errada, uma imagem
  indesejada custa dinheiro.
- `needsResearch` é `false` apenas para conversa fiada ou tarefas de linguagem autocontidas
  (traduz isso, o que significa esta palavra). Nesse caso a etapa de resposta roda sob um prompt
  que proíbe afirmar qualquer coisa sensível ao tempo, já que não há acesso à web nesse caminho.

`styleRefs` e `persist` são nós comuns que internamente não fazem nada conforme
`USE_IMAGE_REFERENCES` e `SAVE_GENERATED_IMAGES`, o que mantém o formato do grafo honesto no Studio.

### A busca é derivada, não sorteada

`detectFreshness` procura um sinal de recência — `today`, `right now`, `latest`,
`main headlines`, `top stories`, `this week`, `recent`, uma data explícita como `September 11`,
além dos equivalentes em espanhol e português — e devolve `day`, `week` ou `none`. Isso decide
como o Tavily busca durante toda a execução:

- `day` / `week` → `topic=news` com o `timeRange` correspondente. Os resultados trazem
  `published_date`, que é o que permite ao redator distinguir a apuração desta manhã da de
  ontem à noite.
- `none` → `topic=general`, com o reforço de `country` derivado de `OUTPUT_LANGUAGE`.

**Antes esses eram campos que o modelo de pesquisa preenchia.** O schema do próprio
`TavilySearch` pede `topic`, `timeRange`, `searchDepth` e os filtros de domínio, então o quão
bem uma pergunta era pesquisada dependia de quais deles o modelo por acaso definia. A mesma
pergunta, com minutos de diferença, uma vez fez uma busca geral sem data e leu duas capas de
portais de notícias, e outra vez fez `topic=news, timeRange=day` e leu matérias datadas — a
segunda resposta era visivelmente melhor, e nada na pergunta decidia qual delas você recebia.
Agora [src/ai/tools/tavily.ts](src/ai/tools/tavily.ts) envolve as duas ferramentas em um schema
que só aceita a query e deriva o resto.

Duas consequências que vale conhecer:

- O Tavily aplica `country` **apenas** no tópico `general`, então o caminho de notícias acrescenta
  o nome do país ao texto da query. É a única compensação que a API oferece. Com o padrão `en`
  não há região e, portanto, nada a perder de qualquer forma.
- No caminho de recência, o `web_extract` **recusa uma capa ou índice de seção** (um host puro,
  `/news`, `/latest-news`, `/ultimas-noticias`) e explica o motivo, porque uma página dessas traz
  chamadas de manchete e nenhum corpo de matéria ao qual atribuir algo. Fora desse caminho a raiz
  de um site continua valendo — "resume essa página pra mim" é um pedido legítimo.

A data de hoje é informada na mensagem de pesquisa em vez de buscada: `get_current_datetime` era
o passo um do prompt e o modelo o seguia mais ou menos metade das vezes. A ferramenta continua lá
para aritmética com datas.

### O laço de pesquisa é limitado por tempo, não por número de chamadas

A pesquisa é de longe o nó mais lento, e quase nada disso é a API de busca. Em uma pergunta que
pedia uma lista ordenada com dois números por item, uma execução gastou **675 segundos** no nó: 667s
de geração do modelo contra 8s de Tavily. E não devolveu nada, porque o teto do job havia disparado
seis minutos antes. Quatro coisas garantem que isso não se repita.

| Correção | Onde |
| --- | --- |
| Cancelamento. Um job que estoura o tempo aborta a execução em vez de deixar o grafo gastando dinheiro em uma resposta que ninguém vai ler | [src/lib/queue.ts](src/lib/queue.ts), propagado por `runAssistant` até a chamada de modelo de cada nó |
| Orçamentos de requisição por etapa, para que uma chamada travada não consuma o job inteiro. O pior caso é `timeoutMs × (maxRetries + 1)` por etapa, e os tetos dos nós são dimensionados para caber dentro de `JOB_TIMEOUT_MS` | `budgets` em [src/ai/config.ts](src/ai/config.ts), `NODE_TIMEOUT_MS` em [src/ai/graph/graph.ts](src/ai/graph/graph.ts) |
| Um orçamento de raciocínio limitado para o laço, exposto como `CHAT_RESEARCH_REASONING`. O raciocínio é a maior parte do tempo de geração, e o laço era a única etapa que ainda o tinha sem limite | `createResearchModel` em [src/ai/services/LLMService.ts](src/ai/services/LLMService.ts) |
| Um prazo em tempo real que retira as ferramentas e obriga o modelo a escrever suas notas, em vez de deixar o timeout do nó jogar fora todas as buscas que a execução pagou | [src/ai/lib/deadline.ts](src/ai/lib/deadline.ts) |

O orçamento de ferramentas (`maxToolCallsPerRun`, 10) agora é um teto de **custo**, não de latência.
Era 5, o que é adequado para "qual é a inflação atual" e apertado demais para uma lista ordenada de
uma dúzia de itens — essa pergunta chegou a dois deles. Uma execução interrompida pelo prazo é
marcada como `truncated`, então a resposta admite qual parte não pôde ser confirmada.

Duas correções de payload acompanham isso. Os resultados das ferramentas que chegam ao laço são
reduzidos aos campos realmente lidos (`leanPayload` em
[src/ai/tools/tavily.ts](src/ai/tools/tavily.ts)): com `SEARCH_DEPTH=advanced` e três trechos por
fonte, duas buscas em paralelo voltam como dezenas de kilobytes de JSON que cada turno seguinte
relê, e nada disso chega ao leitor de qualquer forma, porque o `sources.ts` corta cada fonte ao
coletar. Resultados antigos passam então a ser removidos da transcrição por completo quando ela
ultrapassa ~16 mil tokens (`contextEditingMiddleware`), já que o laço os incorporou às próprias
notas.

Cada turno registra seu próprio `elapsedMs`, a contagem de tokens incluindo os de raciocínio oculto,
e qual provedor da OpenRouter o atendeu — porque reconstruir essa divisão à mão a partir de
timestamps não é algo que alguém deva fazer duas vezes. Um turno que ultrapassa o tempo de uma única
tentativa é registrado como repetido: o LangChain não reporta as próprias repetições.

### As fontes ficam ligadas às afirmações

Os resultados das ferramentas chegavam às etapas de escrita como um bloco único por chamada — a
resposta do Tavily, serializada, cortada em um orçamento de caracteres. Uma resposta de busca com
cinco resultados sobrevivia como mais ou menos o primeiro resultado e meio, então títulos, URLs e
corpos chegavam separados uns dos outros — e um redator que vê frases soltas sem dono as remonta
por plausibilidade. É assim que uma ação acaba creditada a quem foi citado por perto em vez de a
quem a praticou.

Agora [src/ai/lib/sources.ts](src/ai/lib/sources.ts) transforma os payloads em registros:

```
[S1] Supreme court opens inquiry into film funding
(example.com — published 2026-09-11)
The reporting justice authorised the inquiry on Thursday…
```

Um bloco por fonte, deduplicado por URL, com o corpo extraído substituindo o trecho da busca para
a mesma página e com título e data preservados de qualquer um dos dois. O prompt de resposta então
exige que cada linha de fato termine com a sua etiqueta, e proíbe escrever um nome e uma ação
juntos a menos que o texto de uma fonte os coloque juntos.

O `bindSources` resolve essas etiquetas depois: o bloco de fontes é montado a partir das etiquetas
que a resposta realmente usou, na ordem de uso, e as etiquetas são removidas do que o leitor vê.
Assim a lista de links descreve aquilo em que a resposta se apoia, e não tudo o que a execução
pesquisou — e uma etiqueta que não resolve para nada é uma afirmação sem fonte nenhuma, registrada
no log como `answer cited a source that was never retrieved`. Nenhuma chamada extra de modelo está
envolvida.

A palavra do cabeçalho acima dos links continua vindo do modelo, no idioma que `OUTPUT_LANGUAGE`
indicar, para que uma resposta em um idioma que ninguém fixou aqui não termine com um "Sources:"
em inglês. Se o redator ignorar completamente a regra das etiquetas, as fontes principais são
usadas como fallback: uma resposta com fontes imprecisas é melhor que uma sem fonte.

### Formato da resposta

Respostas em texto vêm em dois formatos, e o **padrão é uma lista de tópicos escaneável** — de
três a seis manchetes em negrito com uma linha de fato concreto cada. É isso que as pessoas
realmente leem em um grupo.

Texto corrido é **opt-in**: `detectAnswerDepth` em
[src/ai/graph/intent.ts](src/ai/graph/intent.ts) procura um pedido explícito (`detalha`,
`explica`, `aprofunda`, `por que`, além de `explain`, `detailed`, `analysis`…) e só então muda
para parágrafos, com um orçamento maior de caracteres.

Ambos os orçamentos (`ANSWER_LIMITS` em
[src/ai/services/LLMService.ts](src/ai/services/LLMService.ts)) cobrem **apenas o corpo**. O
bloco final de fontes — até cinco URLs puras — é separado, fica fora do orçamento e é reanexado
depois, de modo que cortar uma resposta longa derruba o tópico mais fraco em vez das fontes.

`DIGEST_BUDGETS` é a outra metade disso: a etapa de resposta vê oito blocos de fonte com 700
caracteres cada, onde antes via quatro blocos de ferramenta cortados em 900. Um orçamento de
resposta que não pode ser preenchido com material real é um convite para inventar algum.

Toda resposta em texto passa então por `toWhatsAppText`
([src/ai/lib/whatsappText.ts](src/ai/lib/whatsappText.ts)), que reescreve qualquer markdown que o
modelo tenha vazado na única sintaxe que o WhatsApp renderiza: `**x**` e `## x` viram `*x*`,
bullets viram `•`, `[texto](url)` vira `texto: url`, blocos de código e tabelas são achatados. Os
prompts proíbem markdown, mas um prompt não é uma garantia.

A profundidade deliberadamente **não** é delegada ao classificador. Quando pedimos que ele
julgasse, o modelo classificou um "quais as notícias de hoje" comum como *detalhado* e produziu
exatamente o paredão de texto que esse formato existe para evitar. Um regex é determinístico,
testado, e enviesado para o lado certo — o custo de perder um "vai mais fundo" vago é o leitor
reformular com "explica".

Quando a pergunta pede uma imagem, a resposta é um pôster cuja legenda carrega o título, o
subtítulo e — em rankings — a lista numerada, de modo que a conversa continua útil mesmo se a
imagem ficar difícil de ler em uma tela pequena.

<table>
<tr>
<td width="58%"><img src="docs/assets/demo-infographic.jpg" alt="Um pedido de pôster no grupo e o infográfico gerado chegando com sua legenda"></td>
<td width="42%"><img src="docs/assets/demo-poster.jpg" alt="Um pôster infográfico em retrato com três painéis de números e uma conclusão no rodapé"></td>
</tr>
</table>

### Inspecionando uma execução

```bash
npm run langchain:server
```

Abre o LangGraph Studio contra o mesmo grafo compilado
([langgraph.json](langgraph.json) → [src/ai/graph/studio.ts](src/ai/graph/studio.ts)). Invoque
apenas com uma pergunta:

```json
{ "question": "quais as melhores séries de 2026?" }
```

O Studio mostra a decisão de roteamento, a atualização de estado de cada nó e cada chamada de
ferramenta, o que é bem melhor do que ler a saída do pino quando uma execução dá errado.

### Concorrência

Várias pessoas podem perguntar ao mesmo tempo. As requisições compartilham um pool limitado de
workers no processo:

| Regra | Padrão |
| --- | --- |
| Execuções simultâneas do grafo | `INFOGRAPHIC_CONCURRENCY=3` |
| Vagas extras de espera | `INFOGRAPHIC_MAX_QUEUED=10` |
| Máximo de 1 em andamento por usuário | — |
| Intervalo por usuário após concluir | `USER_COOLDOWN_MS=5000` |
| Rede de segurança de timeout do job | `JOB_TIMEOUT_MS=900000` |

Quando a fila está cheia ou o usuário já está executando ou em intervalo, o bot responde com uma
mensagem específica em vez de iniciar outra execução paga.

`JOB_TIMEOUT_MS` é a rede, não o controle — os tetos por nó em
[src/ai/graph/graph.ts](src/ai/graph/graph.ts) limitam uma execução muito antes dele. Alcançá-lo
**aborta** a execução: antes ele apenas rejeitava quem chamou, então uma pergunta que estourava o
tempo recebia uma desculpa e o grafo seguia chamando OpenRouter e Tavily por minutos, fora do limite
de concorrência, para uma resposta que era descartada. Se a pesquisa passa de 90s o grupo também
recebe um aviso de "ainda estou pesquisando", para que uma pergunta realmente difícil não pareça um
bot morto.

### Travas de segurança

Toda mensagem passa por este funil antes que qualquer coisa cobrável aconteça. Só o último ramo
gasta dinheiro.

```mermaid
flowchart TD
    msg[messages.upsert] --> grp{"É de um grupo?"}
    grp -->|não| drop([descartada, não custa nada])
    grp -->|sim| live{"Mensagem ao vivo, não backlog de reconexão?"}
    live -->|não| drop
    live -->|sim| own{"De outra pessoa, não do próprio bot?"}
    own -->|não| drop
    own -->|sim| age{"Mais nova que REQUEST_MAX_AGE_SECONDS?"}
    age -->|não| drop
    age -->|sim| allow{"Grupo passa em ALLOWED_GROUP_JIDS?"}
    allow -->|não| drop
    allow -->|sim| ment{"Realmente marca o bot?"}
    ment -->|não| drop
    ment -->|sim| cool{"Passou USER_COOLDOWN_MS, nada rodando para essa pessoa?"}
    cool -->|não| busy[resposta citada pedindo para aguardar]
    cool -->|sim| slot{"Fila abaixo de INFOGRAPHIC_MAX_QUEUED?"}
    slot -->|não| busy
    slot -->|sim| run([executa o assistente, o único caminho que gasta dinheiro])
```

- Somente grupos; status e canais são ignorados.
- Somente mensagens ao vivo (`notify`); backlogs de reconexão (`append`) são ignorados.
- Mensagens mais antigas que `REQUEST_MAX_AGE_SECONDS` são ignoradas.
- Mensagens próprias nunca são respondidas, o que evita um laço de auto-resposta.
- Lista opcional de permissão `ALLOWED_GROUP_JIDS`.
- O conteúdo das mensagens fica fora dos logs, a menos que você defina `LOG_MESSAGE_CONTENT=true`.

## Webhook de notificação

Um endpoint HTTP opcional que permite a um sistema externo enviar uma mensagem de WhatsApp — com
arquivo anexado — através deste app. Sem IA, e completamente separado do bot acima: aquele é de
entrada e reativo, este é apenas de saída.

**Desligado por padrão.** Defina `NOTIFY_ENABLED=true` e `NOTIFY_API_KEY` para ligar.

```bash
curl -X POST http://127.0.0.1:3001/notifications \
  -H "x-api-key: $NOTIFY_API_KEY" \
  -F "to=5511987654321" \
  -F "message=Deploy finalizado" \
  -F "file=@grafico.png;type=image/png"
```

```json
{ "id": "7d27fa53-f6fb-4d87-bb97-70a028bc0593", "status": "queued" }
```

<img src="docs/assets/demo-webhook.jpg" alt="Uma requisição curl à esquerda e a mensagem entregue com seu anexo à direita" width="100%">

`202` significa enfileirado, não entregue — um envio leva segundos e pode cair no meio de uma
reconexão, então quem chamou é liberado imediatamente e `GET /notifications/:id` reporta como
realmente foi. As notificações rodam no próprio pool de workers, então não conseguem sufocar o
pipeline de `@menção`.

A camada HTTP é deliberadamente isolada do WhatsApp para poder migrar para o próprio repositório
mais tarde. **[Documentação completa, decisões de projeto e o guia de separação →](src/notifications/README.md)**

## Scripts

| Script | Descrição |
| --- | --- |
| `npm run dev` | Roda a partir do TypeScript; recarrega só quando `./src` muda |
| `npm run dev:stable` | Igual, **sem** observar arquivos (mais seguro para sessões longas) |
| `npm run typecheck` | Checagem de tipos sem emitir |
| `npm run build` | Compila para `dist/` |
| `npm start` | Roda o build compilado (exige `npm run build` antes) |
| `npm test` | Testes unitários (`node:test`) |
| `npm run langchain:server` | LangGraph Studio contra o grafo do assistente |
| `npm run notify:server` | Só o webhook de notificação, entregas logadas e não enviadas |

## Configuração

Lida a partir do `.env`; veja [.env.example](.env.example) para a lista completa comentada.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PAIRING_MODE` | `code` | `code` ou `qr` |
| `PHONE_NUMBER` | — | Dígitos com código do país. **Obrigatório**, exceto com `PAIRING_MODE=qr` |
| `AUTH_DIR` | `.auth` | Pasta das credenciais de sessão |
| `LOG_LEVEL` | `info` | Nível do pino |
| `LOG_MESSAGE_CONTENT` | `false` | Loga o corpo das mensagens. Desligado por padrão, por privacidade |
| `ALLOWED_GROUP_JIDS` | _(todos)_ | JIDs de grupo separados por vírgula |
| `REQUEST_MAX_AGE_SECONDS` | `60` | Ignora mensagens mais antigas |
| `MAX_QUESTION_LENGTH` | `500` | Limite após remover as menções |
| `INFOGRAPHIC_CONCURRENCY` | `3` | Execuções paralelas do grafo |
| `INFOGRAPHIC_MAX_QUEUED` | `10` | Tamanho da fila de espera |
| `USER_COOLDOWN_MS` | `5000` | Intervalo após um job *bem-sucedido* do mesmo usuário (`0` desativa) |
| `JOB_TIMEOUT_MS` | `900000` | Rede de segurança por job; alcançá-lo aborta a execução |
| `BOT_DISPLAY_NAME` | `groupmind` | Nome mostrado nas dicas de uso (`@nome …`) |
| `SEND_ACK` | `true` | Confirmação imediata (o texto se adapta a texto vs imagem) |
| `TYPING_INDICATOR` | `true` | Presença "digitando" enquanto trabalha |
| `SAVE_GENERATED_IMAGES` | `true` | Grava os pôsteres em `IMAGE_OUTPUT_DIR` |
| `USE_IMAGE_REFERENCES` | `true` | Temas editoriais: busca fotos reais como referência de estilo |
| `IMAGE_REFERENCE_COUNT` | `2` | Quantas URLs de foto passar ao modelo de imagem |
| `OPENROUTER_API_KEY` | — | **Obrigatória** para geração |
| `TAVILY_API_KEY` | — | **Obrigatória** para busca web |
| `SEARCH_DEPTH` | `advanced` | `basic` ou `advanced`. O principal fator de custo no Tavily — veja abaixo |
| `CHAT_MODEL` | `deepseek/deepseek-v4-flash-0731` | Slug de chat do OpenRouter |
| `CHAT_REQUEST_TIMEOUT_MS` | `120000` | Teto de uma tentativa de completion; etapas mais baratas limitam-se abaixo disso |
| `CHAT_MAX_RETRIES` | `1` | Tentativas após a primeira, por etapa |
| `CHAT_RESEARCH_REASONING` | `low` | Orçamento de raciocínio do laço de pesquisa: `off`, `low`, `medium`, `high` |
| `IMAGE_MODEL` | `bytedance-seed/seedream-4.5` | Slug de imagem do OpenRouter |
| `IMAGE_ASPECT_RATIO` | `9:16` | Retrato por padrão |
| `IMAGE_RESOLUTION` | `2K` | Abaixo de 2K os rótulos ficam ilegíveis |
| `IMAGE_OUTPUT_FORMAT` | `jpeg` | Payloads menores no WhatsApp |
| `OUTPUT_LANGUAGE` | `en` | Idioma de toda resposta, e a região que o Tavily prioriza |

O WhatsApp ainda consegue parear sem as chaves de IA. A primeira requisição `@bot` sem elas falha
com uma resposta de erro de pesquisa e uma linha clara no log.

Vale um segundo olhar no `SEARCH_DEPTH` se os créditos do Tavily importam para você. O Tavily
cobra por profundidade, e não por quantidade de resultados, então `advanced` custa mais por busca
e é a única configuração de busca que muda o custo de uma execução. Ele é o padrão porque os
trechos são a base da atribuição de uma resposta: em `basic` um resultado vem como duas ou três
frases, suficiente para saber que um fato existe e insuficiente para saber quem agiu nele. Use
`basic` para cortar esse custo pela metade em troca de evidências mais rasas.

Webhook de notificação (tudo opcional, tudo inerte enquanto `NOTIFY_ENABLED=false`):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NOTIFY_ENABLED` | `false` | Chave geral. Desligado significa que o Fastify nem é carregado |
| `NOTIFY_HOST` | `127.0.0.1` | Loopback por padrão; só amplie atrás de um proxy com TLS |
| `NOTIFY_PORT` | `3001` | |
| `NOTIFY_API_KEY` | — | **Obrigatória** quando ligado; o app se recusa a subir sem ela |
| `NOTIFY_MAX_FILE_BYTES` | `10485760` | Por arquivo (10 MB) |
| `NOTIFY_MAX_FILES` | `4` | Anexos por requisição |
| `NOTIFY_MAX_MESSAGE_LENGTH` | `4096` | |
| `NOTIFY_CONCURRENCY` | `2` | Pool próprio de workers, separado do bot |
| `NOTIFY_MAX_QUEUED` | `50` | Tamanho da fila antes de `503` |
| `NOTIFY_ALLOWED_RECIPIENTS` | _(qualquer)_ | Números ou JIDs separados por vírgula |
| `NOTIFY_DEFAULT_COUNTRY_CODE` | — | Prefixado a números locais, ex.: `1`, `55`, `44` |
| `NOTIFY_JOB_TTL_MS` | `3600000` | Por quanto tempo um job concluído fica consultável |
| `NOTIFY_READY_TIMEOUT_MS` | `30000` | Quanto um envio espera por um socket reconectando |
| `NOTIFY_JOB_TIMEOUT_MS` | `120000` | Teto do job inteiro |

## Estrutura do projeto

```
src/
  index.ts                      entrada, runtime compartilhado, shutdown gracioso
  server.ts                     só o webhook de notificação (sem WhatsApp)
  config/env.ts                 o único lugar que lê process.env
  lib/
    logger.ts                   logger pino compartilhado
    queue.ts                    pool limitado de workers + admissão por usuário
  whatsapp/
    connection.ts               ciclo de vida do socket: pareamento, reconexão, encerramento
    handlers/messages.ts        messages.upsert: loga e então roteia menções
    mention.ts                  detecção de @bot (PN + LID) e parsing da pergunta
    reply.ts                    envio de confirmação / texto / imagem / erro
    infographic.ts              orquestra fila + grafo + respostas
    socketGate.ts               publica o socket ativo; todo envio o consulta na hora
    notify.ts                   entrega de saída para o webhook
  notifications/                webhook HTTP — veja o README próprio
    contract.ts                 tipos compartilhados; não importa nada
    wiring.ts                   raiz de composição
    gateway/                    borda Fastify; nunca importa whatsapp/ ou ai/
    worker/                     fila + armazenamento de jobs; nunca importa HTTP
  ai/                           assistente LangGraph autocontido
    config.ts                   configurações de IA derivadas do env
    graph/
      graph.ts                  montagem do StateGraph, roteamento, runAssistant()
      state.ts                  AssistantState (StateSchema)
      intent.ts                 passadas por palavras-chave: imagem, profundidade, recência
      studio.ts                 ponto de entrada do LangGraph Studio
      nodes/                    um arquivo por nó, serviços injetados
    services/                   LLMService, ImageService
    infographic/                schema Zod do briefing + construtor do prompt de imagem
    tools/                      datetime + Tavily, configurações derivadas da recência
    lib/sources.ts              registros de fonte, etiquetagem, vínculo de citações
    lib/deadline.ts             limite de tempo real do laço de pesquisa
    lib/turnLog.ts              latência, tokens e provedor de cada turno
    lib/imageStore.ts           persistência opcional em disco
```

## Como a conexão se comporta

- **Rode apenas uma instância.** O WhatsApp permite uma única conexão por dispositivo vinculado,
  então uma segunda instância derruba a primeira com `conflict / replaced`. Quando isso acontece,
  a perdedora encerra imediatamente em vez de reconectar.
- **As credenciais são salvas a cada `creds.update`**, senão a próxima inicialização pede
  pareamento de novo.
- **Quedas transitórias reconectam** com backoff exponencial, limitado por `MAX_RECONNECT_ATTEMPTS`.
- **Uma execução sobrevive a uma reconexão.** O Baileys troca o socket inteiro ao reconectar,
  então cada resposta pede o socket ativo no momento em que envia, em vez de segurar aquele em
  que a pergunta chegou. Uma resposta pesquisada atravessando uma queda ainda chega ao grupo.
- **Credenciais mortas** limpam a pasta de autenticação e encerram — só parear de novo resolve.
- **Ctrl+C esvazia a fila** e então encerra de verdade. O Baileys deixa timers para trás, então o
  shutdown força a saída do processo; caso contrário uma instância remanescente briga com a
  próxima execução pela sessão.

Se você vir um laço repetido de `conflict / replaced`, uma instância anterior ainda está viva. No
Windows:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/index.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Contribuindo

Pull requests são bem-vindos — leia [CONTRIBUTING.md](CONTRIBUTING.md) primeiro. A versão curta:
rode `npm run typecheck`, `npm test` e `npm run build` antes de abrir um, nunca comite números,
JIDs ou chaves reais, e espelhe qualquer mudança de documentação voltada ao usuário nos três
READMEs.

A participação é regida pelo [Código de Conduta](CODE_OF_CONDUCT.md).

## Jurídico

| Documento | O que cobre |
| --- | --- |
| [LICENSE](LICENSE) | MIT |
| [DISCLAIMER.md](DISCLAIMER.md) | Ausência de vínculo com WhatsApp ou Meta, aviso de marcas, Termos de Serviço e risco de banimento, usos proibidos, responsabilidade do operador |
| [PRIVACY.md](PRIVACY.md) | O que é processado, o que é enviado ao OpenRouter e ao Tavily, o que é gravado em disco, e suas obrigações como controlador de dados sob a LGPD e o GDPR |
| [SECURITY.md](SECURITY.md) | Como reportar uma vulnerabilidade em privado, mais notas de segurança para o operador |
| [NOTICE](NOTICE) | Atribuições de terceiros e reconhecimento de marcas |

**wa-groupmind não é afiliado, endossado nem conectado ao WhatsApp LLC ou à Meta Platforms, Inc.**
WhatsApp e Meta são marcas registradas da Meta Platforms, Inc., usadas aqui apenas para descrever
a interoperabilidade. Os mantenedores não aprovam o uso deste software de qualquer forma que
viole os Termos de Serviço do WhatsApp, e não aceitam responsabilidade por como você o utiliza.

## Agradecimentos

Construído sobre o [Baileys](https://github.com/WhiskeySockets/Baileys) de Rajeh Taher e da
comunidade WhiskeySockets, [LangChain.js e LangGraph.js](https://github.com/langchain-ai/langchainjs),
[Fastify](https://fastify.dev), [pino](https://getpino.io) e [sharp](https://sharp.pixelplumbing.com).
