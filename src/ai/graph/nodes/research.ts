import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'

import { logger } from '../../../lib/logger.js'
import { digestResearch, LLMService } from '../../services/LLMService.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

const log = logger.child({ module: 'graph:research' })

/** Tool result bodies run to thousands of characters; the log only needs a shape. */
const RESULT_PREVIEW_CHARS = 120

function logMessage(chat: unknown, message: BaseMessage): void {
  const base = chat === undefined ? {} : { chat }

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
    const result = await llm.makeAIRequestAsync(state.question, (message) =>
      logMessage(chat, message),
    )
    const { sources } = digestResearch(result.messages)

    return {
      researchMessages: result.messages,
      truncated: result.truncated,
      sources,
    }
  }
}
