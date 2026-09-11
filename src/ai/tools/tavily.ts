import { TavilyExtract, TavilySearch } from '@langchain/tavily'
import { tool } from 'langchain'
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'

import { logger } from '../../lib/logger.js'
import { getTavilyConfig } from '../config.js'

const log = logger.child({ module: 'tools:tavily' })

/*
Tavily's web tools, wrapped as factories so nothing hits the network at import time
and tests can build them on demand.

Both are exposed through our own `tool()` façade rather than handed to the model directly.
`TavilySearch`'s own schema asks the model for `topic`, `timeRange`, `searchDepth`,
`includeDomains` and `excludeDomains`, which made retrieval quality a sampling outcome: the
same question, minutes apart, once ran an undated general search and read two news front
pages, and once ran `topic=news, timeRange=day` and read dated articles. The second answer
was visibly better and nothing about the question decided which one you got.

The narrow schemas here leave the model the one decision it is good at — what to look for —
and take back the ones the run already knows the answer to.

Tavily also offers crawl and map. They are not wired up: a whole-site crawl is slow and
expensive, and no question this bot answers has needed one.
*/

/**
 * How fresh the sources for one run have to be.
 *
 * `none` means no recency constraint, which is what a question with no time words gets.
 */
export type Freshness = 'day' | 'week' | 'none'

/** The key `freshness` travels under in the graph's `configurable`. */
export const FRESHNESS_KEY = 'freshness'

/**
 * Reads the run's freshness off the graph config.
 *
 * Falls back to `none` rather than throwing: the research agent is compiled once and shared
 * across concurrent runs, so per-run settings can only arrive through config, and an answer
 * researched without a recency filter is worse than one with it but still an answer.
 */
export function freshnessFrom(config?: RunnableConfig): Freshness {
  const value = config?.configurable?.[FRESHNESS_KEY]
  return value === 'day' || value === 'week' ? value : 'none'
}

type SearchSettings = {
  topic: 'general' | 'news'
  timeRange?: 'day' | 'week'
  /** Appended to the query text, for when Tavily will not apply `country` itself. */
  scope?: string
}

/**
 * The retrieval settings for one run, derived rather than sampled.
 *
 * The news topic is what makes Tavily return `published_date`, without which nothing
 * downstream can tell today's reporting from last night's. It costs the `country` boost,
 * though — Tavily applies that only on the general topic — so the country name goes into
 * the query text instead, which is the only compensation the API offers. With a plain `en`
 * OUTPUT_LANGUAGE there is no country to lose either way.
 */
export function searchSettings(freshness: Freshness, country?: string): SearchSettings {
  if (freshness === 'none') return { topic: 'general' }

  return {
    topic: 'news',
    timeRange: freshness,
    ...(country === undefined ? {} : { scope: country }),
  }
}

/** The Tavily client behind `web_search`, pinned to settings the model cannot reach. */
function createSearchClient(): TavilySearch {
  const TavilyConfig = getTavilyConfig()
  return new TavilySearch({
    tavilyApiKey: TavilyConfig.apiKey,
    maxResults: TavilyConfig.maxResults,
    searchDepth: TavilyConfig.searchDepth,
    chunksPerSource: TavilyConfig.chunksPerSource,
    /*
    Derived from OUTPUT_LANGUAGE, so a pt-BR bot ranks Brazilian sources first instead of
    answering "in Brazil" questions with US data. A language tag with no region (plain "en")
    yields no boost, which is the right default for a global audience.

    Tavily applies this only when topic is general, which is why searchSettings names the
    country in the query text on the news path. This is a ranking boost either way, never
    a filter.
    */
    ...(TavilyConfig.country === undefined ? {} : { country: TavilyConfig.country }),
    // Tavily can pre-summarise, but then our model never reasons over the sources.
    includeAnswer: false,
    // Snippets only: full page text is what web_extract is for.
    includeRawContent: false,
  })
}

/**
 * Runs one search with fixed settings.
 *
 * `topic` and `timeRange` are passed as input rather than set on the instance because
 * `TavilySearch` lets an instance field win over its input, and leaving them off the
 * instance is what keeps one client usable for both the general and news paths.
 */
export async function runSearch(
  client: TavilySearch,
  query: string,
  settings: SearchSettings,
): Promise<unknown> {
  return client.invoke({
    query: settings.scope === undefined ? query : `${query} ${settings.scope}`,
    topic: settings.topic,
    ...(settings.timeRange === undefined ? {} : { timeRange: settings.timeRange }),
  })
}

/**
 * Ranked web results with snippets. The agent's entry point for anything time-sensitive.
 *
 * `client` is injectable so a test can watch what actually reached Tavily, which is the
 * only way to tell a correctly derived setting from one that never left the process.
 */
export function createWebSearchTool(client: TavilySearch = createSearchClient()) {
  const TavilyConfig = getTavilyConfig()

  return tool(
    async ({ query }, config: RunnableConfig) => {
      const freshness = freshnessFrom(config)
      const settings = searchSettings(freshness, TavilyConfig.country)
      // Logged because the run's freshness only reaches here through config, and a
      // propagation that silently failed would look exactly like a question with no time
      // words in it. The resolved topic in the log is the proof it arrived.
      log.debug({ freshness, ...settings }, 'web search settings')

      return JSON.stringify(await runSearch(client, query, settings))
    },
    {
      name: 'web_search',
      description:
        'Search the web and return ranked results with title, URL, publication date and a content snippet. Use this for current facts, prices, news or anything after your training cutoff. Recency and region are already set for you from the question — just write the best query. If a snippet answers the question, stop here; if you need the full article, pass its URL to web_extract.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'What to look for, written in the language of the sources you want. Do not add a date or a country: both are applied for you.',
          ),
      }),
    },
  )
}

/**
 * A single path segment that means "the list of everything", not one story.
 *
 * Kept closed rather than heuristic: `/politics/news/2026/09/11/inquiry-opened` is an
 * article and must stay extractable, while `/latest-news` is an index of teasers. The
 * non-English words are here for the same reason the intent keywords are.
 */
const INDEX_SEGMENT =
  /^(?:news|latest|latest-news|headlines|home|index(?:\.html?)?|noticias|ultimas|ultimas-noticias|titulares|actualidad|inicio|hoje|hoy)$/i

/**
 * True when the URL is a site index rather than one article.
 *
 * A front page carries headline teasers and no article body, so reading one spends the
 * extract budget and comes back with facts that cannot be attributed to anything. It is
 * also the concrete difference between two runs of the same question: the shallow answer
 * had read news front pages, the good one had read dated article URLs.
 */
export function isIndexPage(url: string): boolean {
  try {
    const segments = new URL(url).pathname.split('/').filter((part) => part.length > 0)
    if (segments.length === 0) return true
    if (segments.length > 1) return false

    return INDEX_SEGMENT.test(segments[0] ?? '')
  } catch {
    return false
  }
}

/** The Tavily client behind `web_extract`. */
function createExtractClient(): TavilyExtract {
  const TavilyConfig = getTavilyConfig()
  return new TavilyExtract({
    tavilyApiKey: TavilyConfig.apiKey,
    extractDepth: TavilyConfig.extractDepth,
    format: TavilyConfig.format,
  })
}

/** Clean, parsed text for URLs you already know. The read step after a search. */
export function createWebExtractTool(client: TavilyExtract = createExtractClient()) {
  return tool(
    async ({ urls, query }, config: RunnableConfig) => {
      /*
      Only guarded on the recency path. Elsewhere a site root can legitimately be the
      document the reader meant — "summarise this page for me" — and a question with no
      time words in it is not the one that goes looking for today's headlines.
      */
      const articles =
        freshnessFrom(config) === 'none' ? urls : urls.filter((url) => !isIndexPage(url))

      if (articles.length === 0) {
        return JSON.stringify({
          error: `Refused ${urls.join(', ')}: a site index carries headline teasers and no article body, so nothing read there can be attributed. Pass the URL of a specific article from the search results instead.`,
        })
      }

      return JSON.stringify(
        await client.invoke({
          urls: articles,
          ...(query === undefined ? {} : { query }),
        }),
      )
    },
    {
      name: 'web_extract',
      description:
        'Read one or more known URLs and return their cleaned main content. Use after web_search when a snippet is too short to say who did what. Do not guess URLs: only pass URLs that came from a search result or from the user, and pass article URLs rather than a section or front page.',
      schema: z.object({
        urls: z
          .array(z.string())
          .describe(
            'Article URLs taken from a search result. One or two, not a whole page of them.',
          ),
        query: z
          .string()
          .optional()
          .describe('What you are looking for in these pages, used to rank the extracted chunks.'),
      }),
    },
  )
}
