import { LLMService } from '../../services/LLMService.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

/**
 * Writes the WhatsApp text reply.
 *
 * Reached either straight from `classify` (no research needed) or after `research`.
 * When no research ran, the answer stage gets a prompt that forbids volatile facts.
 */
export function answer(llm: LLMService) {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    const researched =
      state.researchMessages.length > 0
        ? { messages: state.researchMessages, truncated: state.truncated }
        : undefined

    const written = await llm.writeChatAnswerAsync(state.question, {
      research: researched,
      depth: state.depth,
    })

    return { answer: written.text, citedSources: written.cited }
  }
}
