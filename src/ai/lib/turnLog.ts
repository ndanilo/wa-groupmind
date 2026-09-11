import { AIMessage } from '@langchain/core/messages'
import { createMiddleware } from 'langchain'

import { logger } from '../../lib/logger.js'
import type { StageBudget } from '../config.js'

const log = logger.child({ module: 'graph:research' })

/*
Per-turn accounting for the research loop.

Without it, telling generation time from retrieval time means subtracting log timestamps by hand
— and the answer to "why did that take eleven minutes" turned out to be 667 seconds of model
against 8 seconds of Tavily, which no amount of tuning the search would have fixed. Even then,
how much of it went on hidden reasoning, and which provider served the call, were unknowable.
Every number that argument needs is emitted here instead.

`wrapModelCall` is the right seam because it wraps the whole call including any retry, so its
elapsed time is what the requester actually waits. That also makes retries visible without
touching `onFailedAttempt`: overriding that would replace LangChain's own handler, which is where
rate-limit classification and the do-not-retry status codes live. A turn cannot exceed one
attempt's timeout without having been retried, so the comparison is exact.
*/

type TokenCounts = {
  inputTokens?: number
  outputTokens?: number
  /** Hidden thinking. Usually the largest share, and the reason CHAT_RESEARCH_REASONING exists. */
  reasoningTokens?: number
}

function tokensOf(message: AIMessage): TokenCounts {
  const usage = message.usage_metadata
  if (usage === undefined) return {}

  const reasoning = usage.output_token_details?.reasoning

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}),
  }
}

/**
 * Which backend actually served the call.
 *
 * One OpenRouter slug is served by several providers at different speeds, and which one answered
 * is not otherwise recoverable — so a turn that took four times as long as its neighbour looks
 * like a mystery rather than a routing decision.
 */
function servedBy(message: AIMessage): { provider?: string; served?: string } {
  const meta = message.response_metadata as Record<string, unknown> | undefined
  const provider = meta?.['provider']
  const served = meta?.['model_name'] ?? meta?.['model']

  return {
    ...(typeof provider === 'string' ? { provider } : {}),
    ...(typeof served === 'string' ? { served } : {}),
  }
}

export function researchTurnLogMiddleware(budget: StageBudget) {
  return createMiddleware({
    name: 'ResearchTurnLog',
    wrapModelCall: async (request, handler) => {
      const startedAt = Date.now()
      const result = await handler(request)
      const elapsedMs = Date.now() - startedAt

      if (!AIMessage.isInstance(result as never)) return result
      const message = result as AIMessage

      const fields = {
        chat: request.runtime.configurable?.['chat'],
        elapsedMs,
        tools: request.tools.length,
        toolCalls: message.tool_calls?.length ?? 0,
        ...tokensOf(message),
        ...servedBy(message),
      }

      if (elapsedMs > budget.timeoutMs) {
        log.warn(
          { ...fields, attemptTimeoutMs: budget.timeoutMs },
          'research turn outlasted one attempt, so it was retried',
        )
      } else {
        log.info(fields, 'research turn')
      }

      return result
    },
  })
}
