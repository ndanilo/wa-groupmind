import { requireAiKeys, config } from '../config/env.js'
import { logger } from '../lib/logger.js'

const log = logger.child({ module: 'ai:config' })

/*
Validated AI settings derived from the single env reader.

Kept separate from src/config/env.ts so the WhatsApp connection layer can start
(and pair) without AI keys, while the pipeline fails loudly the first time a
run is attempted without them.
*/

const keys = () => requireAiKeys()

/** How much hidden thinking a stage gets. `off` is the cheapest and the least careful. */
export type ReasoningEffort = 'low' | 'medium' | 'high'

/** What one stage is allowed to spend on a single chat completion. */
export type StageBudget = {
  /** Per attempt, not per stage. */
  timeoutMs: number
  /** Attempts after the first, so the worst case is `timeoutMs * (maxRetries + 1)`. */
  maxRetries: number
}

export type ChatConfig = {
  apiKey: string
  apiHost: string
  model: string
  researchTemperature: number
  briefTemperature: number
  /** Friendly WhatsApp answer after research. */
  answerTemperature: number
  /** Intent classifier (mode + needsResearch). Keep at 0. */
  classifierTemperature: number
  recursionLimit: number
  maxToolCallsPerRun: number
  /** How long the research loop may keep calling tools before it must write its notes. */
  researchDeadlineMs: number
  /**
   * Thinking budget for the research loop, or `false` to switch it off.
   *
   * The one stage where reasoning earns its cost, since it picks the tools and the queries. It
   * is also where an unbounded budget hurts most: reasoning is the bulk of generation time, and
   * generation is very nearly all of a research run.
   */
  researchReasoning: false | ReasoningEffort
  budgets: {
    classify: StageBudget
    research: StageBudget
    brief: StageBudget
    answer: StageBudget
  }
}

export type TavilyConfigType = {
  apiKey: string
  maxResults: number
  searchDepth: 'basic' | 'advanced'
  /** Snippet chunks per result. Tavily only honours it on the advanced depth. */
  chunksPerSource: number
  extractDepth: 'basic' | 'advanced'
  format: 'markdown' | 'text'
  /** Full lowercase country name Tavily boosts results from, e.g. "brazil". */
  country?: string
}

export type ImageConfigType = {
  apiKey: string
  apiHost: string
  model: string
  aspectRatio: string
  resolution: '512' | '1K' | '2K' | '4K'
  outputFormat: 'png' | 'jpeg' | 'webp'
  paletteOverride?: string
  imagesPerRun: number
  requestTimeoutMs: number
  maxRetries: number
}

export type OutputConfigType = {
  language: string
  directory: string
  saveToDisk: boolean
  useImageReferences: boolean
  imageReferenceCount: number
}

/*
Per-stage request budgets, because one stalled call must not be able to eat the whole job.

It used to be a single CHAT_REQUEST_TIMEOUT_MS with CHAT_MAX_RETRIES applied to every stage,
which made one model call worth up to three times the timeout — longer than JOB_TIMEOUT_MS —
and the research node makes several in a row.

The env var stays the ceiling: a structured brief over a fat research digest genuinely needs it.
The other stages cap below it, because routing is a two-field answer and a research turn that
has not emitted a tool call in 90s is not about to. Lowering the env var still lowers every
stage; raising it only helps the stage that asked for the room.

Worst case per stage is `timeoutMs * (maxRetries + 1)`, and the node timeouts in graph.ts are
sized from these numbers so their sum stays under JOB_TIMEOUT_MS. If that stops being true, the
job ceiling fires on every hard question and the per-node limits never get to work.
*/
const stageBudget = (timeoutMs: number, maxRetries: number): StageBudget => ({
  timeoutMs: Math.min(config.chatRequestTimeoutMs, timeoutMs),
  maxRetries: Math.min(config.chatMaxRetries, maxRetries),
})

let chat: ChatConfig | undefined
let tavily: TavilyConfigType | undefined
let image: ImageConfigType | undefined

/** Lazily builds chat config so missing keys only fail on first pipeline run. */
export function getChatConfig(): ChatConfig {
  if (chat) return chat
  const { openRouterApiKey } = keys()
  chat = {
    apiKey: openRouterApiKey,
    apiHost: 'https://openrouter.ai/api/v1',
    model: config.chatModel,
    researchTemperature: 0,
    briefTemperature: 0.2,
    // Rewriting researched notes is mechanical. At 0.4 proper names drifted — a report on
    // Daniel Vorcaro went out as "Vorcarar" — and the prose reads no worse at 0.2.
    answerTemperature: 0.2,
    classifierTemperature: 0,
    recursionLimit: 30,
    /*
    A cost ceiling, not a latency one — researchDeadlineMs is what actually bounds the loop.

    It was 5, which is the right shape for "what is the current inflation rate" and far too
    tight for a question that needs a figure per item: a request to rank a dozen companies on
    two metrics each got as far as two of them before the budget ran out.
    */
    maxToolCallsPerRun: 10,
    /*
    The real bound on the loop: answer-in-time beats answer-in-K-calls. Sized so the worst case
    (deadline reached, then one final generation) fits the research node's runTimeout.
    */
    researchDeadlineMs: 270_000,
    researchReasoning:
      config.chatResearchReasoning === 'off' ? false : config.chatResearchReasoning,
    budgets: {
      classify: stageBudget(30_000, 1),
      research: stageBudget(90_000, 1),
      brief: stageBudget(120_000, 1),
      answer: stageBudget(90_000, 1),
    },
  }

  /*
  Logged once, on the first run rather than at boot, because building this needs the API keys
  and the WhatsApp socket is allowed to pair without them.

  Worth a line at all because every number here bounds how long a question can take, and when
  one of them is wrong the symptom is a slow or truncated answer with nothing in the log to
  connect it to a setting.
  */
  log.info(
    {
      model: chat.model,
      researchReasoning: chat.researchReasoning === false ? 'off' : chat.researchReasoning,
      maxToolCallsPerRun: chat.maxToolCallsPerRun,
      researchDeadlineMs: chat.researchDeadlineMs,
      budgets: chat.budgets,
      jobTimeoutMs: config.jobTimeoutMs,
    },
    'chat pipeline configured',
  )

  return chat
}

/**
 * The country Tavily should boost, taken from the output language's region so a pt-BR bot
 * prefers Brazilian sources without a second env var. Returns the full lowercase name the
 * API expects ("brazil"), or undefined when the language tag carries no region.
 */
function searchCountry(tag: string): string | undefined {
  try {
    const region = new Intl.Locale(tag).region
    if (region === undefined) return undefined
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(region)?.toLowerCase()
  } catch {
    return undefined
  }
}

export function getTavilyConfig(): TavilyConfigType {
  if (tavily) return tavily
  const { tavilyApiKey } = keys()
  tavily = {
    apiKey: tavilyApiKey,
    maxResults: 8,
    searchDepth: config.searchDepth,
    // Tavily ignores this unless searchDepth is advanced, which is why it is not gated too.
    chunksPerSource: 3,
    extractDepth: 'basic',
    format: 'markdown',
    country: searchCountry(config.outputLanguage),
  }
  return tavily
}

export function getImageConfig(): ImageConfigType {
  if (image) return image
  const { openRouterApiKey } = keys()
  image = {
    apiKey: config.imageApiKey ?? openRouterApiKey,
    apiHost: config.imageApiHost,
    model: config.imageModel,
    aspectRatio: config.imageAspectRatio,
    resolution: config.imageResolution,
    outputFormat: config.imageOutputFormat,
    paletteOverride: config.imagePalette,
    imagesPerRun: 1,
    requestTimeoutMs: config.imageRequestTimeoutMs,
    maxRetries: 2,
  }
  return image
}

export function getOutputConfig(): OutputConfigType {
  return {
    language: config.outputLanguage,
    directory: config.imageOutputDir,
    saveToDisk: config.saveGeneratedImages,
    useImageReferences: config.useImageReferences,
    imageReferenceCount: config.imageReferenceCount,
  }
}
