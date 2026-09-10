import { getOutputConfig } from '../../config.js'
import { saveInfographicAsync } from '../../lib/imageStore.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

/**
 * Optional disk write, gated by SAVE_GENERATED_IMAGES.
 *
 * The image is already sent from memory, so this is archival only.
 */
export function persist() {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    const output = getOutputConfig()
    if (!output.saveToDisk || !state.image || !state.brief) return {}

    const saved = await saveInfographicAsync(state.image, {
      question: state.question,
      imagePrompt: state.imagePrompt,
      brief: state.brief,
      sources: state.sources,
      styleReferences: state.styleReferences,
      truncated: state.truncated,
    })

    return { saved }
  }
}
