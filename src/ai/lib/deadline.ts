import { createMiddleware } from 'langchain'

import { logger } from '../../lib/logger.js'

const log = logger.child({ module: 'graph:research' })

/*
A wall-clock bound on the research loop, because "answer in time" is the real requirement and
"answer in at most K tool calls" was only ever a proxy for it.

The proxy fails in both directions. Too low, and a question needing a figure per item runs out
of budget having read two of a dozen. Raising the cap on its own just moves the failure: a slow
provider turns eight permitted calls into many minutes, and the requester is told the bot gave
up rather than being given the partial answer it had already assembled.

Time is the thing that actually matters to whoever is waiting, so time is what is capped. The
tool budget stays as a cost ceiling; this is the latency ceiling, and it degrades gracefully —
the loop keeps whatever it has found and is made to write its notes now.
*/

/** The key a run's deadline travels under in the research agent's `configurable`. */
export const DEADLINE_KEY = 'researchDeadline'

export type ResearchDeadline = {
  /** Epoch milliseconds after which no further tool call is allowed. */
  at: number
  /**
   * Set when the deadline actually cut the loop short.
   *
   * Mutable because the agent is compiled once and shared across concurrent runs, so this object
   * is the only per-run channel back out of the middleware. The answer stage needs it: a run that
   * stopped early produced a real answer, so `endedWithoutAnswer` reports nothing wrong, and the
   * reader would be handed partial research with no caveat on it.
   */
  hit: boolean
}

export function researchDeadline(budgetMs: number): ResearchDeadline {
  return { at: Date.now() + budgetMs, hit: false }
}

function deadlineFrom(
  configurable: Record<string, unknown> | undefined,
): ResearchDeadline | undefined {
  const value = configurable?.[DEADLINE_KEY]
  if (value === null || typeof value !== 'object') return undefined
  return 'at' in value && typeof (value as ResearchDeadline).at === 'number'
    ? (value as ResearchDeadline)
    : undefined
}

const WRAP_UP =
  '\n\nYOUR RESEARCH TIME IS UP. No tools are available to you now. Write your notes from' +
  ' what you have already retrieved, and say plainly which part of the question you could' +
  ' not confirm. Do not apologise and do not ask for more time.'

/**
 * Takes the tools away once the run is out of time, so the model has to write its notes.
 *
 * Removing the tools rather than throwing is what keeps the partial research usable: the model
 * still gets a turn, still produces attributable notes, and the answer stage still runs. The
 * alternative — letting the node timeout fire — throws away every search the run paid for.
 */
export function researchDeadlineMiddleware() {
  return createMiddleware({
    name: 'ResearchDeadline',
    wrapModelCall: async (request, handler) => {
      const deadline = deadlineFrom(request.runtime.configurable)

      if (deadline === undefined || Date.now() < deadline.at || request.tools.length === 0) {
        return handler(request)
      }

      if (!deadline.hit) {
        deadline.hit = true
        log.warn(
          { overdueMs: Date.now() - deadline.at, tools: request.tools.length },
          'research deadline reached, writing notes from what was retrieved',
        )
      }

      return handler({
        ...request,
        tools: [],
        systemMessage: request.systemMessage.concat(WRAP_UP),
      })
    },
  })
}
