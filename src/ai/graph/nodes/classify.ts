import { errorFields, logger } from '../../../lib/logger.js'
import { LLMService } from '../../services/LLMService.js'
import { detectAnswerDepth, detectImageIntent } from '../intent.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

const log = logger.child({ module: 'graph:classify' })

/**
 * Decides the shape of the reply: text (default) or image, whether to research, and how
 * deep the text answer should go.
 *
 * Two-tier on purpose. The keyword pass is free and covers the obvious asks, so the
 * classifier model is only paid for when the wording is genuinely ambiguous. An explicit
 * "explica"/"detalha" outranks the classifier, which tends to over-explain.
 */
export function classify(llm: LLMService) {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    const keywordImage = detectImageIntent(state.question)
    const keywordDepth = detectAnswerDepth(state.question)

    if (keywordImage === 'image') {
      log.debug({ mode: keywordImage }, 'intent from keyword')
      // An infographic is only worth drawing on top of researched facts.
      return { mode: 'image', needsResearch: true, intentSource: 'keyword' }
    }

    // Depth never comes from the model: asked to judge it, it called ordinary questions
    // detailed and produced walls of prose. Prose is opt-in via an explicit word.
    const depth = keywordDepth ?? 'topics'

    try {
      const intent = await llm.classifyIntentAsync(state.question)
      log.debug({ ...intent, depth }, 'intent from classifier')
      return { ...intent, depth, intentSource: 'llm' }
    } catch (error: unknown) {
      // Never fail a request over routing. Text + research is the safe default:
      // a researched answer is never wrong, an unwanted image costs money.
      log.warn(errorFields(error), 'classifier failed, defaulting to researched text')
      return { mode: 'text', needsResearch: true, depth, intentSource: 'llm' }
    }
  }
}
