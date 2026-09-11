import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AIMessage, SystemMessage } from '@langchain/core/messages'

/*
The wall-clock bound on the research loop, checked at the hook rather than through a whole agent:
what matters is that an out-of-time turn reaches the model with no tools attached, and that the run
is marked as cut short even though it answered normally.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'

const { researchDeadline, researchDeadlineMiddleware } = await import(
  '../../src/ai/lib/deadline.js'
)

type Hook = NonNullable<ReturnType<typeof researchDeadlineMiddleware>['wrapModelCall']>

/** A model request carrying just the fields the deadline hook reads or rewrites. */
function request(deadline: unknown, toolCount = 2) {
  return {
    tools: Array.from({ length: toolCount }, (_, index) => ({ name: `tool_${index}` })),
    systemMessage: new SystemMessage('Research carefully.'),
    messages: [],
    runtime: { configurable: deadline === undefined ? {} : { researchDeadline: deadline } },
  }
}

async function call(deadline: unknown, toolCount = 2) {
  const hook = researchDeadlineMiddleware().wrapModelCall as Hook
  const seen: { tools: unknown[]; system: string }[] = []

  const result = await hook(request(deadline, toolCount) as never, ((given: {
    tools: unknown[]
    systemMessage: SystemMessage
  }) => {
    seen.push({ tools: given.tools, system: String(given.systemMessage.content) })
    return new AIMessage('notes')
  }) as never)

  return { seen, result }
}

describe('researchDeadlineMiddleware', () => {
  it('leaves a run that is still in time untouched', async () => {
    const { seen } = await call(researchDeadline(60_000))

    assert.equal(seen[0]?.tools.length, 2)
    assert.equal(seen[0]?.system, 'Research carefully.')
  })

  it('takes the tools away once the deadline has passed', async () => {
    const { seen } = await call(researchDeadline(-1))

    assert.equal(seen[0]?.tools.length, 0, 'the model must have nothing left to call')
  })

  // Without this the model gets a turn with no tools and no explanation, and asks to search.
  it('tells the model to write up what it has', async () => {
    const { seen } = await call(researchDeadline(-1))

    assert.match(seen[0]?.system ?? '', /RESEARCH TIME IS UP/)
    assert.match(seen[0]?.system ?? '', /could not confirm/)
    // The original instructions have to survive, or the notes lose their attribution rules.
    assert.match(seen[0]?.system ?? '', /Research carefully\./)
  })

  /*
  A deadline-cut run answers normally, so `endedWithoutAnswer` sees nothing wrong. This flag is the
  only evidence, and it is what makes the reply admit the research was incomplete.
  */
  it('records that it cut the run short', async () => {
    const deadline = researchDeadline(-1)
    assert.equal(deadline.hit, false)

    const hook = researchDeadlineMiddleware().wrapModelCall as Hook
    await hook(request(deadline) as never, (() => new AIMessage('notes')) as never)

    assert.equal(deadline.hit, true)
  })

  it('stays out of the way when there is no deadline in config', async () => {
    const { seen } = await call(undefined)

    assert.equal(seen[0]?.tools.length, 2)
  })

  // The stage after the cut already has no tools; rewriting it again would append the wrap-up
  // instruction on every remaining turn.
  it('does not re-mark a turn that already has no tools', async () => {
    const deadline = researchDeadline(-1)
    const hook = researchDeadlineMiddleware().wrapModelCall as Hook

    await hook(request(deadline, 0) as never, (() => new AIMessage('notes')) as never)

    assert.equal(deadline.hit, false)
  })
})
