import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

/*
capAnswer is tested directly because the graph tests fake the answer stage, so the bug it
exists to prevent was invisible there: a real run went out as a topic list ending in a bare
"Sources…" with all four sources trimmed away.

Env is set before the dynamic import because src/config/env.ts snapshots process.env at
module load. Nothing here touches the network.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'

const { capAnswer, LLMService } = await import('../../src/ai/services/LLMService.js')

const LIMIT = 1500

const topic = (index: number): string =>
  `*Headline number ${index}*\n` +
  'One line with the concrete fact, the number, the date and the proper name the reader' +
  ' needs to read in the group without opening any link.'

const SOURCES = [
  'https://www.example.com/news/articles/c99dnrkvnr1o',
  'https://news.example.org/technology/2026/09/01/single-view-messages.html',
  'https://example.net/coverage',
  'https://www.example.com/politics/agency-report',
  'https://agency.example.org/justice/news/2026-09/report',
]

const body = (topics: number): string =>
  Array.from({ length: topics }, (_, index) => topic(index + 1)).join('\n\n')

const answer = (topics: number): string => `${body(topics)}\n\nSources:\n${SOURCES.join('\n')}`

describe('capAnswer', () => {
  it('leaves an answer inside the budget untouched', () => {
    const short = answer(3)

    assert.equal(capAnswer(short, LIMIT), short)
  })

  it('keeps every source when the body has to be trimmed', () => {
    const capped = capAnswer(answer(14), LIMIT)

    assert.ok(capped.includes('Sources:'), 'kept the sources header')
    for (const url of SOURCES) {
      assert.ok(capped.includes(url), `kept ${url}`)
    }
    assert.ok(capped.length <= LIMIT, `stayed in budget, got ${capped.length}`)
  })

  it('never sends a bare sources header', () => {
    // The production failure: the cut landed just after "Sources:", the colon was stripped
    // as trailing punctuation and an ellipsis was appended in its place.
    const capped = capAnswer(answer(14), LIMIT)

    assert.doesNotMatch(capped, /Sources\s*…\s*$/)
    assert.match(capped, /https?:\/\/\S+$/)
  })

  it('marks a trimmed body with an ellipsis', () => {
    const capped = capAnswer(answer(14), LIMIT)
    const [trimmed] = capped.split('\n\nSources:')

    assert.ok(trimmed !== undefined && trimmed.endsWith('…'), 'body ends with an ellipsis')
  })

  it('cuts at a topic boundary rather than mid-sentence', () => {
    const capped = capAnswer(answer(14), LIMIT)
    const [trimmed] = capped.split('\n\nSources:')

    // The boundary snap means the last surviving topic is whole.
    assert.ok(trimmed?.endsWith('any link…'), `cut cleanly, got ${trimmed?.slice(-30)}`)
  })

  it('collapses the oversized gaps models leave between topics', () => {
    const capped = capAnswer(`${topic(1)}\n\n\n\n${topic(2)}\n\nSources:\n${SOURCES[0]}`, LIMIT)

    assert.doesNotMatch(capped, /\n{3,}/)
  })

  it('handles a sources header with the first URL on the same line', () => {
    const capped = capAnswer(`${body(14)}\n\nSources: ${SOURCES[0]}\n${SOURCES[1]}`, LIMIT)

    assert.ok(capped.includes(`Sources:\n${SOURCES[0]}`), 'split the inline URL onto its own line')
    assert.ok(capped.includes(String(SOURCES[1])), 'kept the second source')
    assert.ok(capped.length <= LIMIT, `stayed in budget, got ${capped.length}`)
  })

  it('drops sources past the fifth, matching the prompt', () => {
    const extra = 'https://example.com/sixth-source'
    const capped = capAnswer(`${body(3)}\n\nSources:\n${SOURCES.join('\n')}\n${extra}`, LIMIT)

    assert.ok(!capped.includes(extra), 'dropped the sixth source')
    assert.ok(capped.includes(String(SOURCES[4])), 'kept the fifth source')
  })

  it('still caps an answer that carries no sources', () => {
    const capped = capAnswer(body(14), 600)

    assert.ok(capped.length <= 600, `stayed in budget, got ${capped.length}`)
    assert.ok(capped.endsWith('…'), 'marked as trimmed')
    assert.ok(!capped.includes('Sources'), 'invented no sources block')
  })

  it('keeps the sources when the body is empty', () => {
    const capped = capAnswer(`Sources:\n${SOURCES[0]}`, LIMIT)

    assert.equal(capped, `Sources:\n${SOURCES[0]}`)
  })
})

/*
The answer stage end to end with a faked presenter, because the citation block is now built
from the tags the writer used rather than copied out of the notes. The header word still has
to come from the model: OUTPUT_LANGUAGE accepts any BCP-47 tag, so a hardcoded word would
put "Sources:" under a reply written in German.
*/
const FIRST = 'https://example.com/one'
const SECOND = 'https://example.org/two'
const THIRD = 'https://example.net/three'

const research = () => ({
  messages: [
    new ToolMessage({
      content: JSON.stringify({
        results: [
          { title: 'First', url: FIRST, content: 'The agency opened the case.' },
          { title: 'Second', url: SECOND, content: 'The committee put off the vote.' },
          { title: 'Third', url: THIRD, content: 'The rate held at 4.5 percent.' },
        ],
      }),
      tool_call_id: 'call_1',
      name: 'web_search',
    }),
    new AIMessage('Notes about the case, the vote and the rate.'),
  ],
  truncated: false,
})

/** A presenter that returns one fixed reply, so only the citation path is under test. */
const writer = (reply: string) =>
  new LLMService({
    tools: [],
    presenter: { async invoke() { return new AIMessage(reply) } } as unknown as BaseChatModel,
  })

describe('writeChatAnswerAsync citations', () => {
  it("keeps the model's own header word and resolves its tags in order of use", async () => {
    const written = await writer(
      '*Vote delayed*\nThe committee put off the vote. [S2]\n\n' +
        '*Case opened*\nThe agency opened the case. [S1]\n\nFuentes:',
    ).writeChatAnswerAsync('que paso hoy', { research: research() })

    assert.ok(written.text.includes('Fuentes:'), 'kept the Spanish header')
    assert.ok(!written.text.includes('Sources:'), 'did not hardcode English over it')
    assert.deepEqual(written.cited, [SECOND, FIRST])
    // The third source was retrieved and never cited, so it is not in the reply.
    assert.ok(!written.text.includes(THIRD))
  })

  it('strips the tags from what the reader sees', async () => {
    const written = await writer(
      '*Vote delayed*\nThe committee put off the vote. [S2]\n\nSources:',
    ).writeChatAnswerAsync('what happened', { research: research() })

    assert.doesNotMatch(written.text, /\[S\d/)
    assert.ok(written.text.includes('put off the vote.\n'), 'no space left behind the tag')
  })

  it('falls back to a header when the model wrote none', async () => {
    const written = await writer(
      '*Rate holds*\nThe rate held at 4.5 percent. [S3]',
    ).writeChatAnswerAsync('what is the rate', { research: research() })

    assert.ok(written.text.includes(`Sources:\n${THIRD}`))
  })

  it('cites the top sources rather than nothing when the writer used no tags', async () => {
    // An imprecisely sourced answer beats an unsourced one, which is what the old
    // everything-we-searched list at least guaranteed.
    const written = await writer(
      '*Rate holds*\nThe rate held at 4.5 percent.',
    ).writeChatAnswerAsync('what is the rate', { research: research() })

    assert.deepEqual(written.cited, [FIRST, SECOND, THIRD])
  })

  it('reports no sources on the no-research path', async () => {
    const written = await writer('Hi! All good here.').writeChatAnswerAsync('hi, how are you?')

    assert.equal(written.text, 'Hi! All good here.')
    assert.deepEqual(written.cited, [])
  })
})
