import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AIMessage, ToolMessage } from '@langchain/core/messages'

/*
The graph is exercised end to end with fake services.

Env is set before the dynamic imports below because src/config/env.ts snapshots
process.env at module load. The reference/persist flags are off so no node touches
the network or the disk.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'
process.env.USE_IMAGE_REFERENCES = 'false'
process.env.SAVE_GENERATED_IMAGES = 'false'

const { createAssistantGraph, runAssistant } = await import('../../src/ai/graph/graph.js')
const { normaliseIntent } = await import('../../src/ai/services/LLMService.js')

type LLMService = import('../../src/ai/services/LLMService.js').LLMService
type ImageService = import('../../src/ai/services/ImageService.js').ImageService
type Intent = import('../../src/ai/services/LLMService.js').Intent
type InfographicBrief = import('../../src/ai/infographic/schema.js').InfographicBrief
type GeneratedImage = import('../../src/ai/services/ImageService.js').GeneratedImage

const sampleBrief = (): InfographicBrief => ({
  layout: 'stats',
  art: { tone: 'editorial', palette: 'charcoal, lime, off-white', mood: 'sharp, cinematic' },
  title: 'Taxa Selic em 2026',
  subtitle: 'O Copom manteve a taxa em dois dígitos.',
  panels: [
    {
      label: 'Taxa atual',
      figure: '14,00% a.a.',
      note: 'Definida pelo Copom em agosto',
      icon: 'a bronze coin on descending steps',
      visual: 'photo',
    },
  ],
  items: [],
  takeaway: 'Juros altos seguem enquanto a inflação não ceder.',
})

const researchMessages = () => [
  new ToolMessage({
    content: 'Selic a 14,00% a.a. Fonte: https://bcb.gov.br/selic',
    tool_call_id: 'call_1',
    name: 'web_search',
  }),
  new AIMessage('A Selic esta em 14,00% ao ano, definida pelo Copom em agosto de 2026.'),
]

type Calls = {
  classify: number
  research: number
  answer: number
  brief: number
  image: number
  /** Depth the answer stage was actually asked for. */
  depth: string
}

function fakes(intent: Intent) {
  const calls: Calls = {
    classify: 0,
    research: 0,
    answer: 0,
    brief: 0,
    image: 0,
    depth: '',
  }

  const llm = {
    async classifyIntentAsync(): Promise<Intent> {
      calls.classify += 1
      return normaliseIntent(intent)
    },
    async makeAIRequestAsync() {
      calls.research += 1
      return { messages: researchMessages(), truncated: false }
    },
    async writeChatAnswerAsync(
      _question: string,
      research?: unknown,
      depth?: string,
    ): Promise<string> {
      calls.answer += 1
      calls.depth = depth ?? 'topics'
      return research ? 'A Selic esta em *14,00% a.a.*' : 'Oi! Tudo bem por aqui.'
    },
    async writeInfographicBriefAsync(): Promise<InfographicBrief> {
      calls.brief += 1
      return sampleBrief()
    },
  } as unknown as LLMService

  const images = {
    async generateAsync(): Promise<GeneratedImage> {
      calls.image += 1
      return { bytes: Buffer.from('fake-png'), mediaType: 'image/png', costUsd: 0.02 }
    },
  } as unknown as ImageService

  return { llm, images, calls }
}

describe('assistant graph routing', () => {
  let visited: string[]

  beforeEach(() => {
    visited = []
  })

  const onStage = (node: string) => {
    visited.push(node)
  }

  it('answers directly when no research is needed', async () => {
    const { llm, images, calls } = fakes({ mode: 'text', needsResearch: false })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'oi, tudo bem?', { onStage })

    assert.equal(run.mode, 'text')
    assert.deepEqual(visited, ['classify', 'writeAnswer'])
    assert.equal(calls.research, 0)
    assert.equal(calls.brief, 0)
    assert.equal(calls.image, 0)
    assert.equal(run.answer, 'Oi! Tudo bem por aqui.')
    assert.equal(run.image, undefined)
  })

  it('researches before answering a factual question', async () => {
    const { llm, images, calls } = fakes({ mode: 'text', needsResearch: true })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'qual a taxa Selic atual?', { onStage })

    assert.equal(run.mode, 'text')
    assert.deepEqual(visited, ['classify', 'research', 'writeAnswer'])
    assert.equal(calls.research, 1)
    assert.equal(calls.brief, 0)
    assert.equal(calls.image, 0)
    assert.ok(run.answer.includes('14,00%'))
    assert.deepEqual(run.sources, ['https://bcb.gov.br/selic'])
  })

  it('runs the full image branch when an infographic is asked for', async () => {
    const { llm, images, calls } = fakes({ mode: 'image', needsResearch: true })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'faz um infográfico da taxa Selic', { onStage })

    assert.equal(run.mode, 'image')
    assert.deepEqual(visited, [
      'classify',
      'research',
      'writeBrief',
      'styleRefs',
      'renderPrompt',
      'generateImage',
      'persist',
    ])
    assert.equal(calls.brief, 1)
    assert.equal(calls.image, 1)
    assert.ok(run.image)
    assert.equal(run.brief?.title, 'Taxa Selic em 2026')
    assert.ok(run.imagePrompt.includes('14,00% a.a.'))
    assert.equal(run.costUsd, 0.02)
  })

  it('skips the classifier model when a keyword already decided', async () => {
    // The fake classifier would say text; the keyword pass must win and never call it.
    const { llm, images, calls } = fakes({ mode: 'text', needsResearch: false })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'gera uma imagem sobre a inflação', { onStage })

    assert.equal(run.mode, 'image')
    assert.equal(run.intentSource, 'keyword')
    assert.equal(calls.classify, 0)
    assert.equal(calls.image, 1)
  })

  it('reports every node starting as well as finishing', async () => {
    const { llm, images } = fakes({ mode: 'text', needsResearch: true })
    const graph = createAssistantGraph({ llm, images })

    const started: string[] = []
    const finished: Array<[string, number]> = []

    await runAssistant(graph, 'qual a taxa Selic atual?', {
      onNodeStart: (node) => started.push(node),
      onStage: (node, elapsedMs) => finished.push([node, elapsedMs]),
    })

    // Start events are what keep a slow node from looking like a hung process.
    assert.deepEqual(started, ['classify', 'research', 'writeAnswer'])
    assert.deepEqual(
      finished.map(([node]) => node),
      ['classify', 'research', 'writeAnswer'],
    )
    // Timings are measured from the node's own start, so they must be real numbers.
    for (const [node, elapsedMs] of finished) {
      assert.ok(Number.isFinite(elapsedMs), `${node} reported a non-finite elapsed`)
      assert.ok(elapsedMs >= 0, `${node} reported a negative elapsed`)
    }
  })

  it('defaults to the topics format', async () => {
    const { llm, images, calls } = fakes({ mode: 'text', needsResearch: true })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'quais as noticias de hoje?', { onStage })

    assert.equal(run.depth, 'topics')
    assert.equal(calls.depth, 'topics')
  })

  it('switches to prose only when a keyword asks for it', async () => {
    const { llm, images, calls } = fakes({ mode: 'text', needsResearch: true })
    const graph = createAssistantGraph({ llm, images })

    const run = await runAssistant(graph, 'explica a alta do dolar', { onStage })

    assert.equal(run.depth, 'detailed')
    assert.equal(calls.depth, 'detailed')
  })

  it('falls back to researched text when the classifier throws', async () => {
    const { images } = fakes({ mode: 'text', needsResearch: true })
    let researched = 0

    const llm = {
      async classifyIntentAsync(): Promise<Intent> {
        throw new Error('classifier unavailable')
      },
      async makeAIRequestAsync() {
        researched += 1
        return { messages: researchMessages(), truncated: false }
      },
      async writeChatAnswerAsync(): Promise<string> {
        return 'Resposta com pesquisa.'
      },
    } as unknown as LLMService

    const graph = createAssistantGraph({ llm, images })
    const run = await runAssistant(graph, 'quanto custa o dolar hoje?', { onStage })

    assert.equal(run.mode, 'text')
    assert.equal(run.intentSource, 'llm')
    assert.equal(researched, 1)
    assert.equal(run.answer, 'Resposta com pesquisa.')
  })
})

describe('normaliseIntent', () => {
  it('forces research on for image requests', () => {
    assert.deepEqual(normaliseIntent({ mode: 'image', needsResearch: false }), {
      mode: 'image',
      needsResearch: true,
    })
  })

  it('keeps an explicit no-research text intent', () => {
    assert.deepEqual(normaliseIntent({ mode: 'text', needsResearch: false }), {
      mode: 'text',
      needsResearch: false,
    })
  })
})
