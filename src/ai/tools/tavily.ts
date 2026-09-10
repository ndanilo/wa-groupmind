import { TavilyExtract, TavilySearch } from '@langchain/tavily'

import { getTavilyConfig } from '../config.js'

/*
Tavily's web tools, wrapped as factories so nothing hits the network at import time
and tests can build them on demand.

The `description` of each tool is the only thing the model reads when deciding what to
call, so these are written to spell out the intended chain: search to find URLs, then
extract to read them.

Tavily also offers crawl and map. They are not wired up: a whole-site crawl is slow and
expensive, and no question this bot answers has needed one.
*/

/** Ranked web results with snippets. The agent's entry point for anything time-sensitive. */
export function createWebSearchTool(): TavilySearch {
  const TavilyConfig = getTavilyConfig()
  return new TavilySearch({
    tavilyApiKey: TavilyConfig.apiKey,
    maxResults: TavilyConfig.maxResults,
    searchDepth: TavilyConfig.searchDepth,
    topic: 'general',
    /*
    Derived from OUTPUT_LANGUAGE, so a pt-BR bot ranks Brazilian sources first instead of
    answering "in Brazil" questions with US data. A language tag with no region (plain "en")
    yields no boost, which is the right default for a global audience.

    Tavily applies this only when topic is general, and the model can override topic with
    "news" per call, where it is ignored — so the research prompt also has to carry the
    scope rule. This is a ranking boost either way, never a filter.
    */
    ...(TavilyConfig.country === undefined ? {} : { country: TavilyConfig.country }),
    // Tavily can pre-summarise, but then our model never reasons over the sources.
    includeAnswer: false,
    // Snippets only: full page text is what web_extract is for.
    includeRawContent: false,
    name: 'web_search',
    description:
      'Search the web and return ranked results with title, URL and a short snippet. Use this FIRST for current facts, prices, news or anything after your training cutoff. If a snippet answers the question, stop here; if you need the full article, pass the URL to web_extract.',
  })
}

/** Clean, parsed text for URLs you already know. The read step after a search. */
export function createWebExtractTool(): TavilyExtract {
  const TavilyConfig = getTavilyConfig()
  return new TavilyExtract({
    tavilyApiKey: TavilyConfig.apiKey,
    extractDepth: TavilyConfig.extractDepth,
    format: TavilyConfig.format,
    name: 'web_extract',
    description:
      'Read one or more known URLs and return their cleaned main content. Use after web_search when a snippet is too short to answer. Do not guess URLs: only pass URLs that came from a search result or from the user.',
  })
}

