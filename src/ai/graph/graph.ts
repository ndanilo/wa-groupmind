import { END, START, StateGraph } from '@langchain/langgraph'

import { getChatConfig } from '../config.js'
import { ImageService } from '../services/ImageService.js'
import { LLMService } from '../services/LLMService.js'
import {
  answer,
  brief,
  classify,
  generateImage,
  persist,
  renderPrompt,
  research,
  styleRefs,
} from './nodes/index.js'
import { AssistantState, type AssistantStateType } from './state.js'

/*
Question in, either a text reply or a poster out.

             +--> writeAnswer --------------------------------> END
  classify --+
             +--> research --+--> writeAnswer ----------------> END
                             |
                             +--> writeBrief -> styleRefs -> renderPrompt
                                             -> generateImage -> persist -> END

Text is the default. The image branch costs a chat call, a research loop, a brief and an
image generation, so it only runs when the user actually asked for a picture.

styleRefs and persist are plain nodes that no-op internally on their config flags, which
keeps the graph shape honest in LangGraph Studio.

Node names are verbs because LangGraph forbids a node name that matches a state channel,
and `answer` / `brief` are both fields on AssistantState.
*/

export type AssistantDeps = {
  llm?: LLMService
  images?: ImageService
}

/** Timeout for one image generation. Well under the queue's JOB_TIMEOUT_MS. */
const IMAGE_TIMEOUT_MS = 180_000

export function createAssistantGraph(deps: AssistantDeps = {}) {
  const llm = deps.llm ?? new LLMService()
  const images = deps.images ?? new ImageService()

  return (
    new StateGraph(AssistantState)
      /*
      No node-level retry on purpose.

      Every node that talks to a provider already retries underneath: the chat models via
      CHAT_MAX_RETRIES, ImageService via its own backoff, styleRefs by returning []. Adding
      a second layer here multiplies the worst case instead of improving reliability — a
      model call that hits CHAT_REQUEST_TIMEOUT_MS three times is already 6 minutes, and
      retrying the node doubled that to 12, well past JOB_TIMEOUT_MS.
      */
      .addNode('classify', classify(llm))
      .addNode('research', research(llm))
      .addNode('writeAnswer', answer(llm))
      .addNode('writeBrief', brief(llm))
      .addNode('styleRefs', styleRefs())
      .addNode('renderPrompt', renderPrompt())
      .addNode('generateImage', generateImage(images), {
        timeout: { runTimeout: IMAGE_TIMEOUT_MS },
      })
      .addNode('persist', persist())
      .addEdge(START, 'classify')
      .addConditionalEdges('classify', afterClassify, ['research', 'writeAnswer'])
      .addConditionalEdges('research', afterResearch, ['writeAnswer', 'writeBrief'])
      .addEdge('writeBrief', 'styleRefs')
      .addEdge('styleRefs', 'renderPrompt')
      .addEdge('renderPrompt', 'generateImage')
      .addEdge('generateImage', 'persist')
      .addEdge('writeAnswer', END)
      .addEdge('persist', END)
      .compile()
  )
}

/** Skip the research loop only when the classifier is confident it adds nothing. */
function afterClassify(state: AssistantStateType): 'research' | 'writeAnswer' {
  return state.needsResearch ? 'research' : 'writeAnswer'
}

/** Both branches share the research, so the split happens after it, not before. */
function afterResearch(state: AssistantStateType): 'writeAnswer' | 'writeBrief' {
  return state.mode === 'image' ? 'writeBrief' : 'writeAnswer'
}

export type AssistantGraph = ReturnType<typeof createAssistantGraph>

export type AssistantRun = {
  mode: 'text' | 'image'
  depth: 'topics' | 'detailed'
  question: string
  answer: string
  sources: string[]
  truncated: boolean
  intentSource: 'keyword' | 'llm'
  brief?: AssistantStateType['brief']
  image?: AssistantStateType['image']
  saved?: AssistantStateType['saved']
  imagePrompt: string
  styleReferences: string[]
  costUsd?: number
}

export type AssistantEvents = {
  /** Fires when a node starts. Without it, a 100s research node looks like dead air. */
  onNodeStart?(node: string): void
  /** Fires once per finished node, in order, for progress logging. */
  onStage?(node: string, elapsedMs: number): void
}

/** One `tasks` stream event. Starts carry `input`, completions carry `result`. */
type TaskEvent = {
  name?: string
  input?: unknown
  result?: unknown
}

/**
 * Runs one question through the graph.
 *
 * Streamed rather than invoked so the caller can follow progress:
 * - `tasks` marks each node starting and finishing, which is what keeps a 100s research
 *   node from looking like a hung process in the log.
 * - `updates` carries the state deltas, which are merged back into the final result.
 *
 * `chat` is threaded through `configurable` so nodes can tag their own logs with it while
 * several requests run concurrently.
 */
export async function runAssistant(
  graph: AssistantGraph,
  question: string,
  events: AssistantEvents = {},
  chat?: string,
): Promise<AssistantRun> {
  const stream = await graph.stream(
    { question },
    {
      streamMode: ['updates', 'tasks'],
      recursionLimit: getChatConfig().recursionLimit,
      ...(chat === undefined ? {} : { configurable: { chat } }),
    },
  )

  let state: Partial<AssistantStateType> = { question }
  const startedAt = new Map<string, number>()

  for await (const chunk of stream) {
    const [mode, payload] = chunk as unknown as [string, Record<string, unknown>]

    if (mode === 'tasks') {
      const task = payload as TaskEvent
      const node = task.name
      if (!node) continue

      if ('result' in task) {
        const started = startedAt.get(node)
        events.onStage?.(node, started === undefined ? 0 : Date.now() - started)
      } else {
        startedAt.set(node, Date.now())
        events.onNodeStart?.(node)
      }
      continue
    }

    for (const update of Object.values(payload)) {
      state = { ...state, ...(update as Partial<AssistantStateType>) }
    }
  }

  return {
    mode: state.mode ?? 'text',
    depth: state.depth ?? 'topics',
    question,
    answer: state.answer ?? '',
    sources: state.sources ?? [],
    truncated: state.truncated ?? false,
    intentSource: state.intentSource ?? 'keyword',
    brief: state.brief,
    image: state.image,
    saved: state.saved,
    imagePrompt: state.imagePrompt ?? '',
    styleReferences: state.styleReferences ?? [],
    costUsd: state.costUsd,
  }
}
