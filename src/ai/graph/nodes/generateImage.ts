import { errorFields, logger } from '../../../lib/logger.js'
import { ImageService } from '../../services/ImageService.js'
import type { AssistantStateType, AssistantStateUpdate } from '../state.js'

const log = logger.child({ module: 'graph:generateImage' })

/** Calls the image model, retrying once without style references if they are rejected. */
export function generateImage(images: ImageService) {
  return async (state: AssistantStateType): Promise<AssistantStateUpdate> => {
    if (!state.imagePrompt) throw new Error('generateImage reached without a prompt')

    try {
      const image = await images.generateAsync(state.imagePrompt, {
        referenceUrls: state.styleReferences,
      })
      return { image, costUsd: image.costUsd }
    } catch (error: unknown) {
      // Style-reference URLs are often hotlinked and get rejected by the provider.
      // Losing the references beats losing the whole reply.
      if (state.styleReferences.length === 0) throw error

      log.warn(
        errorFields(error),
        'image failed with style references, retrying without them',
      )
      const image = await images.generateAsync(state.imagePrompt, { referenceUrls: [] })
      return { image, costUsd: image.costUsd, styleReferences: [] }
    }
  }
}
