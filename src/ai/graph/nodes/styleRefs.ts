import { getOutputConfig } from '../../config.js'
import { fetchStyleReferences } from '../../lib/styleRefs.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

/**
 * Optional Tavily photo lookup used as style guidance for editorial posters.
 *
 * A plain node rather than a conditional edge: skipping happens inside, which keeps the
 * graph readable in Studio. Failures are swallowed — references are a nice-to-have.
 */
export function styleRefs() {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    const output = getOutputConfig()
    if (!output.useImageReferences || !state.brief || state.brief.art.tone !== 'editorial') {
      return { styleReferences: [] }
    }

    const urls = await fetchStyleReferences(
      state.question,
      state.brief,
      output.imageReferenceCount,
    )

    return { styleReferences: urls }
  }
}
