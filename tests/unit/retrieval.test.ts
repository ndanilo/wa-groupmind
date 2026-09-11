import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ToolMessage } from '@langchain/core/messages'
import { TavilyExtract, TavilySearch } from '@langchain/tavily'

/*
What actually reaches Tavily, asserted against a fake API wrapper.

These settings used to be fields the research model filled in, and the model filled them in
differently on consecutive runs of the same question — once `topic=general` with no date
filter, reading two news front pages, once `topic=news, timeRange=day`, reading dated
articles. Deriving them is the fix, and a derivation nobody watches is a derivation that
quietly stops happening, so the parameters are checked on the wire rather than in the
function that computes them.

Nothing here touches the network: the wrapper answers in-process.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'
/*
A regional tag, so the country wiring is exercised on the wire. The default `en` carries no
region and therefore no country at all, which is covered in the searchSettings cases below.
*/
process.env.OUTPUT_LANGUAGE = 'pt-BR'

const { createWebExtractTool, createWebSearchTool, isIndexPage, leanPayload, searchSettings } =
  await import('../../src/ai/tools/tavily.js')

const { collectSources } = await import('../../src/ai/lib/sources.js')

type Params = Record<string, unknown>

/** Stands in for TavilySearchAPIWrapper, recording every call it is handed. */
function fakeSearchApi() {
  const calls: Params[] = []
  const wrapper = {
    async rawResults(params: Params) {
      calls.push(params)
      return {
        query: params['query'],
        results: [
          {
            title: 'Report',
            url: 'https://example.com/report',
            content: 'Content.',
            score: 0.9,
          },
        ],
      }
    },
  }

  return { calls, wrapper }
}

function fakeExtractApi() {
  const calls: Params[] = []
  const wrapper = {
    async rawResults(params: Params) {
      calls.push(params)
      const urls = params['urls'] as string[]
      return {
        results: urls.map((url) => ({ url, raw_content: 'Article body.', images: [] })),
        failed_results: [],
        response_time: 0.1,
      }
    },
  }

  return { calls, wrapper }
}

const searchTool = (api: ReturnType<typeof fakeSearchApi>) =>
  createWebSearchTool(
    new TavilySearch({
      apiWrapper: api.wrapper as never,
      maxResults: 8,
      searchDepth: 'advanced',
      chunksPerSource: 3,
      country: 'brazil',
    }),
  )

const extractTool = (api: ReturnType<typeof fakeExtractApi>) =>
  createWebExtractTool(new TavilyExtract({ apiWrapper: api.wrapper as never }))

describe('searchSettings', () => {
  it('uses the news topic and a time filter for a recency ask', () => {
    assert.deepEqual(searchSettings('day', 'brazil'), {
      topic: 'news',
      timeRange: 'day',
      scope: 'brazil',
    })
    assert.deepEqual(searchSettings('week', 'brazil'), {
      topic: 'news',
      timeRange: 'week',
      scope: 'brazil',
    })
  })

  it('leaves a timeless question on the general topic', () => {
    // The general topic is the one Tavily applies `country` to, so it needs no scope word.
    assert.deepEqual(searchSettings('none', 'brazil'), { topic: 'general' })
  })

  it('omits the scope word when there is no country to boost', () => {
    // Which is the default: a plain `en` OUTPUT_LANGUAGE carries no region, so there is no
    // regional boost to lose on the news topic and nothing to compensate for.
    assert.deepEqual(searchSettings('day'), { topic: 'news', timeRange: 'day' })
  })
})

describe('web_search', () => {
  it('sends the news topic and time range when the run asks for today', async () => {
    const api = fakeSearchApi()

    await searchTool(api).invoke(
      { query: 'main headlines' },
      { configurable: { freshness: 'day' } },
    )

    const params = api.calls[0]
    assert.equal(params?.['topic'], 'news')
    assert.equal(params?.['timeRange'], 'day')
    // Tavily ignores `country` on the news topic, so the region has to ride in the query.
    assert.equal(params?.['query'], 'main headlines brazil')
  })

  it('falls back to the general topic with no filter when nothing asked for recency', async () => {
    const api = fakeSearchApi()

    await searchTool(api).invoke({ query: 'best series of 2026' }, { configurable: {} })

    const params = api.calls[0]
    assert.equal(params?.['topic'], 'general')
    assert.equal(params?.['timeRange'], undefined)
    assert.equal(params?.['query'], 'best series of 2026')
  })

  it('pins depth and breadth regardless of the call', async () => {
    const api = fakeSearchApi()

    await searchTool(api).invoke({ query: 'interest rate' }, { configurable: { freshness: 'week' } })

    const params = api.calls[0]
    assert.equal(params?.['searchDepth'], 'advanced')
    assert.equal(params?.['chunksPerSource'], 3)
    assert.equal(params?.['maxResults'], 8)
  })
})

describe('isIndexPage', () => {
  it('recognises a bare host and a section index', () => {
    assert.equal(isIndexPage('https://example.com'), true)
    assert.equal(isIndexPage('https://example.com/'), true)
    assert.equal(isIndexPage('https://example.com/news'), true)
    assert.equal(isIndexPage('https://example.com/latest-news'), true)
    assert.equal(isIndexPage('https://example.com/ultimas-noticias'), true)
  })

  it('leaves an article alone', () => {
    assert.equal(
      isIndexPage('https://example.com/politics/2026/09/11/inquiry-opened'),
      false,
    )
    // One segment, but not one of the index words.
    assert.equal(isIndexPage('https://example.com/annual-report-2026'), false)
  })
})

describe('web_extract', () => {
  it('refuses a front page on the recency path', async () => {
    const api = fakeExtractApi()

    const result = await extractTool(api).invoke(
      { urls: ['https://example.com'] },
      { configurable: { freshness: 'day' } },
    )

    assert.equal(api.calls.length, 0, 'never reached Tavily')
    assert.match(String(result), /site index/)
    // The refusal has to tell the model what to do instead, or it repeats the same call.
    assert.match(String(result), /specific article/)
  })

  it('keeps the articles and drops the index when both are passed', async () => {
    const api = fakeExtractApi()
    const article = 'https://example.com/politics/2026/09/11/inquiry-opened'

    await extractTool(api).invoke(
      { urls: ['https://example.com/news', article] },
      { configurable: { freshness: 'day' } },
    )

    assert.deepEqual(api.calls[0]?.['urls'], [article])
  })

  it('allows a site root when the question carries no recency', async () => {
    const api = fakeExtractApi()

    await extractTool(api).invoke({ urls: ['https://example.com'] }, { configurable: {} })

    assert.deepEqual(api.calls[0]?.['urls'], ['https://example.com'])
  })

  it('passes the reranking query through', async () => {
    const api = fakeExtractApi()

    await extractTool(api).invoke(
      { urls: ['https://example.com/article'], query: 'who opened the inquiry' },
      { configurable: {} },
    )

    assert.equal(api.calls[0]?.['query'], 'who opened the inquiry')
  })
})

/*
The trim exists to keep the research loop from re-reading tens of kilobytes of JSON on every turn,
but the same bodies are what `collectSources` builds citations from — so the shape it leaves behind
matters as much as the size.
*/
describe('leanPayload', () => {
  const payload = {
    query: 'inflation rate',
    answer: 'pre-summarised text we asked Tavily not to send',
    images: ['https://example.com/a.png'],
    follow_up_questions: ['what about unemployment?'],
    response_time: 1.4,
    results: [
      {
        title: 'Report',
        url: 'https://example.com/report',
        content: 'x'.repeat(4000),
        published_date: 'Thu, 11 Sep 2026 10:00:00 GMT',
        score: 0.9,
      },
    ],
  }

  it('clips bodies and drops the fields nothing reads', () => {
    const lean = leanPayload(payload, 800) as {
      results: Record<string, unknown>[]
      answer?: unknown
    }

    assert.equal(lean.answer, undefined)
    assert.equal('images' in lean, false)
    assert.equal(lean.results[0]?.['score'], undefined)
    assert.ok(String(lean.results[0]?.['content']).length <= 801)
  })

  it('keeps every field a citation is built from', () => {
    const lean = leanPayload(payload, 800) as { results: Record<string, unknown>[] }
    const first = lean.results[0]

    assert.equal(first?.['url'], 'https://example.com/report')
    assert.equal(first?.['title'], 'Report')
    // Kept verbatim: sources.ts is what normalises it to a bare date.
    assert.equal(first?.['published_date'], 'Thu, 11 Sep 2026 10:00:00 GMT')
  })

  it('still parses into a tagged source after the round trip through a tool message', () => {
    const body = JSON.stringify(leanPayload(payload, 800))
    const sources = collectSources([new ToolMessage({ content: body, tool_call_id: 'call-1' })])

    assert.equal(sources.length, 1)
    assert.equal(sources[0]?.tag, 'S1')
    assert.equal(sources[0]?.title, 'Report')
    assert.equal(sources[0]?.publishedDate, '2026-09-11')
  })

  it('keeps failed_results so the model stops retrying a dead URL', () => {
    const lean = leanPayload(
      { results: [], failed_results: [{ url: 'https://example.com/gone', error: '404' }] },
      2000,
    ) as Record<string, unknown>

    assert.equal((lean['failed_results'] as unknown[]).length, 1)
  })

  it('passes an error body through untouched rather than reporting no results', () => {
    const error = { detail: 'rate limit exceeded' }
    assert.deepEqual(leanPayload(error, 800), error)
  })
})
