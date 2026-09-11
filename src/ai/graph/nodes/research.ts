import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'

import { logger } from '../../../lib/logger.js'
import type { SourceRecord } from '../../lib/sources.js'
import { digestResearch, LLMService } from '../../services/LLMService.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

const log = logger.child({ module: 'graph:research' })

/** Tool result bodies run to thousands of characters; the log only needs a shape. */
const RESULT_PREVIEW_CHARS = 120

/**
 * Logs one new message from the loop, with the gap since the previous one.
 *
 * `elapsedMs` is the whole point: without it, telling generation time from retrieval time means
 * subtracting wall-clock timestamps by hand, and the conclusion — that the model is very nearly
 * all of a slow run and the search API is a rounding error — is not something anyone should have
 * to reconstruct twice. On a tool result the gap is the API call; on a tool call it is the model
 * deciding.
 */
function logMessage(chat: unknown, message: BaseMessage, elapsedMs: number): void {
  const base = { ...(chat === undefined ? {} : { chat }), elapsedMs }

  if (AIMessage.isInstance(message)) {
    for (const call of message.tool_calls ?? []) {
      log.info({ ...base, tool: call.name, args: call.args }, 'tool call')
    }
    return
  }

  if (ToolMessage.isInstance(message)) {
    const body =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    log.info(
      { ...base, tool: message.name, chars: body.length, preview: body.slice(0, RESULT_PREVIEW_CHARS) },
      'tool result',
    )
  }
}

/**
 * The publication dates at either end of what the run retrieved.
 *
 * Logged rather than shown to anyone: "this answer was built on yesterday's reporting" is
 * invisible in the reply, and was invisible in the log too, which is the only place a
 * stale-looking answer can be told apart from a stale source.
 */
function dateRange(records: SourceRecord[]): { newestSource?: string; oldestSource?: string } {
  const dates = records
    .map((record) => record.publishedDate)
    .filter((date): date is string => date !== undefined)
    .sort()

  if (dates.length === 0) return {}

  return { newestSource: dates.at(-1), oldestSource: dates[0] }
}

/**
 * Runs the tool-calling research loop and parks the raw messages in state.
 *
 * This is the slowest node by a wide margin, so every tool call and result is logged as it
 * happens — otherwise the whole loop is a minute or more of silence.
 */
export function research(llm: LLMService) {
  return async (
    state: AssistantStateType,
    config?: LangGraphRunnableConfig,
  ): Promise<AssistantStateUpdate> => {
    const chat = config?.configurable?.chat
    let lastAt = Date.now()

    const result = await llm.makeAIRequestAsync({
      question: state.question,
      freshness: state.freshness,
      onMessage: (message) => {
        const now = Date.now()
        logMessage(chat, message, now - lastAt)
        lastAt = now
      },
      ...(typeof chat === 'string' ? { chat } : {}),
      ...(config?.signal === undefined ? {} : { signal: config.signal }),
    })

    const { sources } = digestResearch(result.messages)
    const dates = dateRange(sources)

    log.info(
      { chat, freshness: state.freshness, sources: sources.length, ...dates },
      'research collected',
    )

    return {
      researchMessages: result.messages,
      truncated: result.truncated,
      sources: sources.map((record) => record.url),
      ...dates,
    }
  }
}
