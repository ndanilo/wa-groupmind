import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { getImageConfig, getOutputConfig } from '../config.js'
import type { GeneratedImage } from '../services/ImageService.js'
import type { InfographicBrief } from '../infographic/schema.js'

/*
Writes a finished run to disk.

Every image is saved next to a JSON sidecar holding the question, the exact prompt and the
source URLs. Without it a folder of posters is unusable a week later.
*/

export type InfographicRecord = {
  question: string
  imagePrompt: string
  brief: InfographicBrief
  sources: string[]
  /** Style-reference photo URLs sent to the image model, if any. */
  styleReferences?: string[]
  /** True when the research loop was cut short, so the figures are less trustworthy. */
  truncated: boolean
}

export type SavedInfographic = {
  imagePath: string
  metadataPath: string
}

const MAX_SLUG_LENGTH = 60

/**
 * Filename-safe slug.
 *
 * Decomposes first so Portuguese accents survive as their base letters: "inflação" becomes
 * "inflacao" rather than "infla-o".
 */
function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')

  return slug || 'infographic'
}

/** Colons are legal in an ISO timestamp and illegal in a Windows filename. */
function timestampFor(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function extensionFor(mediaType: string): string {
  const subtype = mediaType.split('/')[1]?.split('+')[0]?.toLowerCase()
  if (!subtype) return getImageConfig().outputFormat
  return subtype === 'jpeg' ? 'jpg' : subtype
}

/** Resolves the configured output directory against the project root. */
function outputDirectory(): string {
  const OutputConfig = getOutputConfig()
  return isAbsolute(OutputConfig.directory)
    ? OutputConfig.directory
    : resolve(process.cwd(), OutputConfig.directory)
}

export async function saveInfographicAsync(
  image: GeneratedImage,
  record: InfographicRecord,
  now: Date = new Date(),
): Promise<SavedInfographic> {
  const ImageConfig = getImageConfig()
  const OutputConfig = getOutputConfig()
  const directory = outputDirectory()
  await mkdir(directory, { recursive: true })

  const base = `${timestampFor(now)}-${slugify(record.brief.title)}`
  const imagePath = join(directory, `${base}.${extensionFor(image.mediaType)}`)
  const metadataPath = join(directory, `${base}.json`)

  const metadata = {
    generatedAt: now.toISOString(),
    question: record.question,
    language: OutputConfig.language,
    model: ImageConfig.model,
    aspectRatio: ImageConfig.aspectRatio,
    resolution: ImageConfig.resolution,
    costUsd: image.costUsd,
    researchTruncated: record.truncated,
    brief: record.brief,
    imagePrompt: record.imagePrompt,
    sources: record.sources,
    styleReferences: record.styleReferences ?? [],
  }

  await writeFile(imagePath, image.bytes)
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

  return { imagePath, metadataPath }
}
