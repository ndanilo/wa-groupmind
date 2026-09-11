import type { LangGraphRunnableConfig } from '@langchain/langgraph'

import { errorFields, logger } from '../../../lib/logger.js'
import { LLMService } from '../../services/LLMService.js'
import { detectAnswerDepth, detectFreshness, detectImageIntent } from '../intent.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

const log = logger.child({ module: 'graph:classify' })

/**
 * Decides the shape of the reply: text (default) or image, whether to research, how deep
 * the text answer should go, and how fresh its sources have to be.
 *
 * Two-tier on purpose. The keyword pass is free and covers the obvious asks, so the
 * classifier model is only paid for when the wording is genuinely ambiguous. An explicit
 * "explica"/"detalha" outranks the classifier, which tends to over-explain.
 */
export function classify(llm: LLMService) {
  return async (
    state: AssistantStateType,
    config?: LangGraphRunnableConfig,
  ): Promise<AssistantStateUpdate> => {
    const keywordImage = detectImageIntent(state.question)
    // Neither depth nor freshness comes from the model. Asked to judge depth it called
    // ordinary questions detailed and produced walls of prose; freshness sits alongside it
    // because it decides how Tavily retrieves, and a retrieval regime that changes between
    // two runs of the same question is what this path exists to stop.
    const depth = detectAnswerDepth(state.question) ?? 'topics'
    const freshness = detectFreshness(state.question) ?? 'none'

    if (keywordImage === 'image') {
      log.debug({ mode: keywordImage, freshness }, 'intent from keyword')
      // An infographic is only worth drawing on top of researched facts.
      return { mode: 'image', needsResearch: true, freshness, intentSource: 'keyword' }
    }

    try {
      const intent = await llm.classifyIntentAsync(state.question, config?.signal)
      log.debug({ ...intent, depth, freshness }, 'intent from classifier')
      return { ...intent, depth, freshness, intentSource: 'llm' }
    } catch (error: unknown) {
      // A cancelled job must not be papered over as a routing failure: the whole run is being
      // torn down, and defaulting to researched text would start the expensive path for a
      // requester who has already been told the bot gave up.
      if (config?.signal?.aborted === true) throw error
      // Never fail a request over routing. Text + research is the safe default:
      // a researched answer is never wrong, an unwanted image costs money.
      log.warn(errorFields(error), 'classifier failed, defaulting to researched text')
      return { mode: 'text', needsResearch: true, depth, freshness, intentSource: 'llm' }
    }
  }
}
