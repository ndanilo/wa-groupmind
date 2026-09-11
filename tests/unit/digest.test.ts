import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AIMessage, ToolMessage } from '@langchain/core/messages'

/*
The source pipeline is tested directly because it is where misattribution came from and the
graph tests cannot see it: they fake the writing stages, so a digest that handed the writer
five sentences with no owner looked identical to one that handed it labelled sources.

Nothing here touches the network. Env is set before the dynamic import because
src/config/env.ts snapshots process.env at module load.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'

const { bindSources, collectSources, renderSourceBlocks } = await import(
  '../../src/ai/lib/sources.js'
)
const { digestResearch } = await import('../../src/ai/services/LLMService.js')

type SourceRecord = import('../../src/ai/lib/sources.js').SourceRecord

const ARTICLE = 'https://example.com/politics/2026/09/11/inquiry-opened'
const SECOND = 'https://example.org/congress/committee-report'

const searchPayload = (extra: Record<string, unknown>[] = []) => ({
  query: 'main headlines today',
  results: [
    {
      title: 'Supreme court opens inquiry into film funding',
      url: ARTICLE,
      content: 'The reporting justice authorised the inquiry on Thursday.',
      score: 0.93,
      published_date: 'Fri, 11 Sep 2026 09:12:00 GMT',
    },
    {
      title: 'Rapporteur presents report to the committee',
      url: SECOND,
      content: 'The report was read to the committee and the vote was put off a week.',
      score: 0.81,
      published_date: '2026-09-10',
    },
    ...extra,
  ],
})

const searchMessage = (payload: unknown, name = 'web_search') =>
  new ToolMessage({ content: JSON.stringify(payload), tool_call_id: 'call_1', name })

describe('collectSources', () => {
  it('turns a search payload into tagged records', () => {
    const records = collectSources([searchMessage(searchPayload())])

    assert.equal(records.length, 2)
    assert.deepEqual(
      records.map((record) => record.tag),
      ['S1', 'S2'],
    )
    assert.equal(records[0]?.url, ARTICLE)
    assert.equal(records[0]?.title, 'Supreme court opens inquiry into film funding')
    assert.match(records[0]?.excerpt ?? '', /authorised the inquiry/)
  })

  it('normalises the publication date Tavily returns for news', () => {
    const records = collectSources([searchMessage(searchPayload())])

    // An RFC 822 timestamp and a bare date both have to land as the same shape, because
    // the writer is told to compare them against today.
    assert.equal(records[0]?.publishedDate, '2026-09-11')
    assert.equal(records[1]?.publishedDate, '2026-09-10')
  })

  it('lets an extracted body replace the snippet for the same URL', () => {
    const body =
      'The reporting justice authorised the inquiry on Thursday at the prosecutor general’s' +
      ' request, and the senator named in the request is not the author of the decision.'

    const records = collectSources([
      searchMessage(searchPayload()),
      searchMessage({ results: [{ url: ARTICLE, raw_content: body }] }, 'web_extract'),
    ])

    // Deduplicated: the article was seen twice and stays one source, so its tag is stable.
    assert.equal(records.length, 2)
    assert.equal(records[0]?.excerpt, body)
    assert.equal(records[0]?.extracted, true)
    // The extract payload carries no title or date, so both survive from the search hit.
    assert.equal(records[0]?.title, 'Supreme court opens inquiry into film funding')
    assert.equal(records[0]?.publishedDate, '2026-09-11')
  })

  it('prefers an extracted body even when the snippet is longer', () => {
    const records = collectSources([
      searchMessage({
        results: [{ title: 'Report', url: ARTICLE, content: 'long snippet '.repeat(40) }],
      }),
      searchMessage({ results: [{ url: ARTICLE, raw_content: 'Short body.' }] }, 'web_extract'),
    ])

    // Length is the wrong tiebreak here: only the article body says who acted.
    assert.equal(records[0]?.excerpt, 'Short body.')
    assert.equal(records[0]?.extracted, true)
  })

  it('drops hosts that cannot be cited', () => {
    const records = collectSources([
      searchMessage(
        searchPayload([
          {
            title: 'Video about the case',
            url: 'https://www.youtube.com/watch?v=abc123',
            content: 'Video summary.',
          },
        ]),
      ),
    ])

    assert.equal(records.length, 2)
    assert.ok(!records.some((record) => record.url.includes('youtube')))
  })

  it('ignores a failed extract instead of carrying it as evidence', () => {
    const records = collectSources([
      searchMessage(searchPayload()),
      searchMessage(
        { error: `No extracted results found for '${ARTICLE}'. Suggestions: ...` },
        'web_extract',
      ),
      searchMessage({ results: [], failed_results: [{ url: SECOND, error: 'timeout' }] }),
    ])

    assert.equal(records.length, 2)
    assert.ok(!records.some((record) => record.excerpt.includes('No extracted results')))
  })

  it('survives a tool result that is not JSON at all', () => {
    const records = collectSources([
      searchMessage(searchPayload()),
      new ToolMessage({
        content: 'Unknown time zone "Mars/Olympus".',
        tool_call_id: 'call_9',
        name: 'get_current_datetime',
      }),
    ])

    assert.equal(records.length, 2)
  })
})

describe('renderSourceBlocks', () => {
  const records = collectSources([searchMessage(searchPayload())])

  it('keeps each source with its own title, host and date', () => {
    const rendered = renderSourceBlocks(records, {
      excerptChars: 400,
      limit: 8,
      includeUrl: false,
    })

    assert.match(rendered, /\[S1\] Supreme court opens inquiry/)
    assert.match(rendered, /example\.com — published 2026-09-11/)
    assert.match(rendered, /\[S2\] Rapporteur presents report/)
    // Without the URL the writer cannot copy a link into the prose, which is the job of
    // the tag-resolved list instead.
    assert.ok(!rendered.includes(ARTICLE))
  })

  it('prints the URL when a caller needs something to extract', () => {
    const rendered = renderSourceBlocks(records, {
      excerptChars: 400,
      limit: 8,
      includeUrl: true,
    })

    assert.ok(rendered.includes(ARTICLE))
  })

  it('clips a long body on a word boundary', () => {
    const long = collectSources([
      searchMessage({
        results: [{ title: 'Long', url: ARTICLE, raw_content: 'palabra '.repeat(400) }],
      }),
    ])

    const rendered = renderSourceBlocks(long, {
      excerptChars: 120,
      limit: 8,
      includeUrl: false,
    })

    assert.ok(rendered.includes('…'))
    assert.ok(!rendered.includes('palab…'), 'did not cut inside a word')
  })

  it('shows a read article ahead of a headline snippet, keeping its tag', () => {
    const records2 = collectSources([
      searchMessage(searchPayload()),
      searchMessage({ results: [{ url: SECOND, raw_content: 'Full body.' }] }, 'web_extract'),
    ])

    const rendered = renderSourceBlocks(records2, {
      excerptChars: 400,
      limit: 1,
      includeUrl: false,
    })

    // Only the read article survives a limit of one, and it is still S2 — the tag stays
    // attached to the source, so a citation means the same thing wherever it is printed.
    assert.match(rendered, /^\[S2\] Rapporteur presents report/)
  })
})

describe('bindSources', () => {
  const records: SourceRecord[] = [
    { tag: 'S1', title: 'First', url: 'https://example.com/one', excerpt: 'a', extracted: false },
    { tag: 'S2', title: 'Second', url: 'https://example.com/two', excerpt: 'b', extracted: false },
    { tag: 'S3', title: 'Third', url: 'https://example.com/three', excerpt: 'c', extracted: false },
  ]

  it('keeps only the sources the answer used, in order of use', () => {
    const bound = bindSources('*One*\nA supported fact. [S3]\n\n*Two*\nAnother. [S1]', records)

    assert.deepEqual(
      bound.cited.map((record) => record.url),
      ['https://example.com/three', 'https://example.com/one'],
    )
    assert.deepEqual(bound.unknownTags, [])
  })

  it('strips every tag from what the reader sees', () => {
    const bound = bindSources('Fact one. [S1] Fact two. [S2][S3]', records)

    assert.equal(bound.body, 'Fact one. Fact two.')
  })

  it('counts a source once however often it is cited', () => {
    const bound = bindSources('A. [S1]\nB. [S1]\nC. [ s1 ]', records)

    assert.equal(bound.cited.length, 1)
  })

  it('reports a tag that resolves to nothing', () => {
    // The cheap hallucination signal: a claim whose source was never retrieved.
    const bound = bindSources('Invented fact. [S9]\nReal fact. [S2]', records)

    assert.deepEqual(bound.unknownTags, ['S9'])
    assert.deepEqual(
      bound.cited.map((record) => record.tag),
      ['S2'],
    )
    assert.ok(!bound.body.includes('S9'))
  })

  it('leaves an untagged answer alone', () => {
    const bound = bindSources('An answer with no markers at all.', records)

    assert.equal(bound.body, 'An answer with no markers at all.')
    assert.deepEqual(bound.cited, [])
  })
})

describe('digestResearch', () => {
  it('keeps the agent prose and the sources apart', () => {
    const digest = digestResearch([
      searchMessage(searchPayload()),
      new AIMessage('The inquiry was opened by the reporting justice on 2026-09-11.'),
    ])

    assert.match(digest.findings, /opened by the reporting justice/)
    assert.equal(digest.sources.length, 2)
    assert.equal(digest.sources[0]?.tag, 'S1')
  })

  it('does not treat a trailing tool message as the findings', () => {
    // The tool budget ends a run on a ToolMessage, and reading that as the research
    // summary fed the next stage a framework string instead of notes.
    const digest = digestResearch([
      new AIMessage('The real research notes.'),
      searchMessage({ error: 'Tool call limit exceeded' }, 'web_search'),
    ])

    assert.equal(digest.findings, 'The real research notes.')
  })
})
