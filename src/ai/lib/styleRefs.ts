import { getTavilyConfig } from '../config.js'
import { logger } from '../../lib/logger.js'
import type { InfographicBrief } from '../infographic/schema.js'

const log = logger.child({ module: 'style-refs' })

type TavilySearchResponse = {
  images?: Array<string | { url?: string }>
}

function collectUrls(payload: TavilySearchResponse, limit: number): string[] {
  const urls: string[] = []
  for (const entry of payload.images ?? []) {
    const url = typeof entry === 'string' ? entry : entry.url
    if (!url || !/^https?:\/\//i.test(url)) continue
    // Skip hosts that often 403 when the image model fetches them as references.
    if (/youtube\.com|ytimg\.com|instagram\.com|facebook\.com|fbcdn\.net/i.test(url)) continue
    if (urls.includes(url)) continue
    urls.push(url)
    if (urls.length >= limit) break
  }
  return urls
}

async function tavilyImages(query: string, limit: number): Promise<string[]> {
  const tavily = getTavilyConfig()
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavily.apiKey,
      query: query.slice(0, 400),
      include_images: true,
      max_results: Math.max(3, limit),
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    log.warn({ status: response.status, query }, 'tavily image search failed')
    return []
  }

  return collectUrls((await response.json()) as TavilySearchResponse, limit)
}

/**
 * Pulls a few real photo URLs from Tavily to use as style references for the image model.
 *
 * Used for editorial-tone posters so the generator leans on documentary photography
 * rather than inventing cartoon clip-art. References are for mood/lighting/print quality
 * only — the image prompt forbids copying faces or recreating the photos.
 */
export async function fetchStyleReferences(
  question: string,
  brief: InfographicBrief,
  limit: number,
): Promise<string[]> {
  if (limit <= 0 || brief.art.tone !== 'editorial') return []

  // English photojournalism keywords return images more reliably than PT-only queries.
  const queries = [
    `${brief.title} ${question} editorial news photography documentary photojournalism`,
    `${brief.title} Reuters AFP news photo`,
    `documentary photojournalism ${brief.art.mood}`,
  ]

  try {
    for (const query of queries) {
      const urls = await tavilyImages(query, limit)
      if (urls.length > 0) {
        log.info({ count: urls.length, query }, 'fetched style reference images')
        return urls
      }
    }

    log.warn('no style reference images found after fallbacks')
    return []
  } catch (error: unknown) {
    log.warn({ error }, 'tavily image search error')
    return []
  }
}
