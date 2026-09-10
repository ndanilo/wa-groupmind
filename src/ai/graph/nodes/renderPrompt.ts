import { getImageConfig, getOutputConfig } from '../../config.js'
import { renderImagePrompt } from '../../infographic/prompt.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

/** Pure string composition — no model call, so figures and names stay verbatim. */
export function renderPrompt() {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    if (!state.brief) throw new Error('renderPrompt reached without a brief')

    const image = getImageConfig()
    const output = getOutputConfig()

    return {
      imagePrompt: renderImagePrompt(state.brief, {
        language: output.language,
        aspectRatio: image.aspectRatio,
        paletteOverride: image.paletteOverride,
        hasStyleReferences: state.styleReferences.length > 0,
      }),
    }
  }
}
