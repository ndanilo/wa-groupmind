import { requireAiKeys, config } from '../config/env.js'

/*
Validated AI settings derived from the single env reader.

Kept separate from src/config/env.ts so the WhatsApp connection layer can start
(and pair) without AI keys, while the pipeline fails loudly the first time a
run is attempted without them.
*/

const keys = () => requireAiKeys()

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
  requestTimeoutMs: number
  maxRetries: number
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
    Two searches and two extracts, which is what RESEARCH_PROMPT asks for, plus one call of
    slack. It was 8 against a prompt asking for 4, and the model split the difference
    differently every run — two tool calls on one pass, five on the next, for the same
    question. A limit that matches the instruction is one fewer thing left to sampling.
    */
    maxToolCallsPerRun: 5,
    requestTimeoutMs: config.chatRequestTimeoutMs,
    maxRetries: config.chatMaxRetries,
  }
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
