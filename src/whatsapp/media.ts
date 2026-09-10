import sharp from 'sharp'

/*
WhatsApp chokes on multi‑MB 2K posters. We downscale and re-encode before send so the
upload is fast and less likely to drop the socket mid-transfer. Disk copies stay full-res.
*/

/**
 * Just enough of an image to compress it.
 *
 * Structural rather than tied to the AI pipeline's `GeneratedImage`, so uploads arriving through
 * the notification webhook can reuse this without dragging AI types into that path.
 * `GeneratedImage` still satisfies it, and `costUsd` is passed through untouched.
 */
export type MediaPayload = {
  bytes: Buffer
  mediaType: string
  costUsd?: number
}

const MAX_EDGE_PX = 1280
const JPEG_QUALITY = 82

export async function compressForWhatsApp(image: MediaPayload): Promise<MediaPayload> {
  const pipeline = sharp(image.bytes).rotate()
  const meta = await pipeline.metadata()
  const width = meta.width ?? MAX_EDGE_PX
  const height = meta.height ?? MAX_EDGE_PX
  const longest = Math.max(width, height)

  let img = pipeline
  if (longest > MAX_EDGE_PX) {
    img = img.resize({
      width: width >= height ? MAX_EDGE_PX : undefined,
      height: height > width ? MAX_EDGE_PX : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  const bytes = await img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  return { bytes, mediaType: 'image/jpeg', costUsd: image.costUsd }
}
