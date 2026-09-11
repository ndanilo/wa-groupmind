import { END, START, StateGraph } from '@langchain/langgraph'

import { logger } from '../../lib/logger.js'
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

const log = logger.child({ module: 'graph' })

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

/*
Per-node ceilings, which are the real bound on a run — JOB_TIMEOUT_MS is only the net underneath
them.

Each is the worst case of the model calls inside it: a stage's `timeoutMs * (maxRetries + 1)` from
src/ai/config.ts, and for research the tool-calling deadline plus one final generation. Their sum
along either path has to stay under JOB_TIMEOUT_MS (900s):

  text  = classify 60 + research 360 + writeAnswer 180                  = 600s
  image = classify 60 + research 360 + brief 240 + refs 20 + image 180  = 860s

A node that blows its ceiling aborts with the run rather than starving the ones after it, which is
what used to happen: research could spend the entire job budget and the answer stage never ran.
*/
const NODE_TIMEOUT_MS = {
  classify: 60_000,
  research: 360_000,
  writeAnswer: 180_000,
  writeBrief: 240_000,
  image: 180_000,
} as const

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
      .addNode('classify', classify(llm), {
        timeout: { runTimeout: NODE_TIMEOUT_MS.classify },
      })
      .addNode('research', research(llm), {
        timeout: { runTimeout: NODE_TIMEOUT_MS.research },
      })
      .addNode('writeAnswer', answer(llm), {
        timeout: { runTimeout: NODE_TIMEOUT_MS.writeAnswer },
      })
      .addNode('writeBrief', brief(llm), {
        timeout: { runTimeout: NODE_TIMEOUT_MS.writeBrief },
      })
      .addNode('styleRefs', styleRefs())
      .addNode('renderPrompt', renderPrompt())
      .addNode('generateImage', generateImage(images), {
        timeout: { runTimeout: NODE_TIMEOUT_MS.image },
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
  freshness: 'day' | 'week' | 'none'
  question: string
  answer: string
  /** Every citable URL the run retrieved. */
  sources: string[]
  /** The subset the answer cited, which is what the reader was linked to. */
  citedSources: string[]
  /** Publication dates at either end of what was retrieved, when Tavily gave them. */
  newestSource?: string
  oldestSource?: string
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
 * The single-attempt budget behind each node that makes exactly one model call.
 *
 * `research` is absent on purpose: it makes several calls, and its own middleware times each turn
 * individually. These three cannot do that — they are plain `model.invoke` — so the node's elapsed
 * time *is* the call's, which makes this comparison sound.
 */
const NODE_ATTEMPT_BUDGET: Record<string, keyof ReturnType<typeof getChatConfig>['budgets']> = {
  classify: 'classify',
  writeAnswer: 'answer',
  writeBrief: 'brief',
}

/**
 * Flags a node that took longer than one attempt of its model call is allowed to.
 *
 * LangChain retries a timed-out completion silently, so the only trace is arithmetic: a stage
 * cannot outlast its own per-attempt timeout without having been retried. Left unlogged, that
 * shows up as "the bot is sometimes slow" rather than as a setting to change.
 */
function warnIfRetried(chat: string | undefined, node: string, elapsedMs: number): void {
  const stage = NODE_ATTEMPT_BUDGET[node]
  if (stage === undefined) return

  const budget = getChatConfig().budgets[stage]
  if (elapsedMs <= budget.timeoutMs) return

  log.warn(
    { chat, node, elapsedMs, attemptTimeoutMs: budget.timeoutMs },
    'node outlasted one attempt of its model call, so it was retried',
  )
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
 *
 * `signal` is what makes the queue's job timeout mean something. LangGraph passes it down to every
 * node's config, and the nodes hand it to their model calls, so an abandoned run stops instead of
 * finishing an answer nobody is waiting for any more.
 */
export async function runAssistant(
  graph: AssistantGraph,
  question: string,
  events: AssistantEvents = {},
  chat?: string,
  signal?: AbortSignal,
): Promise<AssistantRun> {
  const stream = await graph.stream(
    { question },
    {
      streamMode: ['updates', 'tasks'],
      recursionLimit: getChatConfig().recursionLimit,
      ...(signal === undefined ? {} : { signal }),
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
        const elapsedMs = started === undefined ? 0 : Date.now() - started
        warnIfRetried(chat, node, elapsedMs)
        events.onStage?.(node, elapsedMs)
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
    freshness: state.freshness ?? 'none',
    question,
    answer: state.answer ?? '',
    sources: state.sources ?? [],
    citedSources: state.citedSources ?? [],
    newestSource: state.newestSource,
    oldestSource: state.oldestSource,
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
