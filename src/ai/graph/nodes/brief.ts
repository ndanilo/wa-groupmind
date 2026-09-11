import type { LangGraphRunnableConfig } from '@langchain/langgraph'

import { LLMService } from '../../services/LLMService.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

/** Reduces the research to the structured copy that gets drawn on the poster. */
export function brief(llm: LLMService) {
  return async (
    state: AssistantStateType,
    config?: LangGraphRunnableConfig,
  ): Promise<AssistantStateUpdate> => {
    const written = await llm.writeInfographicBriefAsync(
      state.question,
      {
        messages: state.researchMessages,
        truncated: state.truncated,
      },
      config?.signal,
    )

    return { brief: written }
  }
}
