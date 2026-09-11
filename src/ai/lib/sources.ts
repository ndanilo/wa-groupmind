import { ToolMessage, type BaseMessage } from '@langchain/core/messages'

/*
Retrieved web sources, as records instead of raw JSON.

The research loop's tool results used to reach the writing stages as one opaque blob per
call — the Tavily response, stringified, clipped to a character budget. A single search
response carrying five results survived as roughly the first result and a half, with the
JSON keys and braces eating the budget, so titles, URLs and bodies arrived separated from
each other. A writer shown floating sentences with no owner reassembles them by
plausibility, which is exactly how an action ends up attributed to whoever was named
nearby rather than to whoever actually took it.

Parsing the payloads into records fixes that at the source: one block per source, its text
kept with its title and date, clipped on its own boundary, and addressable by a short tag
the answer can carry so every claim stays traceable to one origin.
*/

/** One retrieved source, ready to show a writing stage and to cite by tag. */
export type SourceRecord = {
  /** `S1`, `S2`, … Stable within a run; what binds a written claim to its origin. */
  tag: string
  title: string
  url: string
  /** Tavily only returns a publication date on the news topic. */
  publishedDate?: string
  /** Article body or search snippet, whichever is richer. */
  excerpt: string
  /** True once the page was read in full rather than only sampled by the search. */
  extracted: boolean
}

/** A source before it has been deduplicated and given its tag. */
type UntaggedSource = Omit<SourceRecord, 'tag'>

/**
 * Hosts that are never a citable source for a written answer.
 *
 * Tavily happily returns video and social permalinks, and printing "Sources:
 * youtube.com/watch?v=…" under a news summary reads as unsourced. Same idea as the host
 * filter in lib/styleRefs.ts, different reason.
 */
const UNCITABLE_HOST =
  /(?:youtube\.com|youtu\.be|instagram\.com|facebook\.com|fbcdn\.net|tiktok\.com|x\.com|twitter\.com|reddit\.com)/i

/** Ceiling on how many sources any one run carries forward. */
const MAX_SOURCES = 12

/** Per-source body cap applied while collecting, before any per-stage budget. */
const MAX_EXCERPT_CHARS = 2000

/**
 * Truncates text without splitting the last token.
 *
 * A hard slice lands inside a URL often enough to matter, and the writing stages copy what
 * they are shown: half a link in the notes becomes a dead link in the answer.
 */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value

  const cut = value.slice(0, max)
  // The last whitespace, i.e. the start of the token the slice broke.
  const boundary = cut.search(/\s\S*$/)

  return `${boundary > max * 0.8 ? cut.slice(0, boundary) : cut}…`
}

function asText(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Tavily returns `published_date`; the JS SDK sometimes camel-cases it. */
function publishedDate(result: Record<string, unknown>): string | undefined {
  const raw = text(result['published_date']) || text(result['publishedDate'])
  if (raw === '') return undefined

  // Normalised to a bare date: the writer only ever needs the day, and a full RFC 822
  // timestamp costs tokens in every source block.
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : (parsed.toISOString().split('T')[0] ?? raw)
}

function resultsOf(payload: unknown): Record<string, unknown>[] {
  if (payload === null || typeof payload !== 'object') return []
  const results = (payload as Record<string, unknown>)['results']
  if (!Array.isArray(results)) return []

  return results.filter(
    (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
  )
}

/**
 * Pulls sources out of one Tavily payload, search or extract.
 *
 * Shape-driven rather than name-driven so a renamed tool or a wrapped response still
 * yields records: `content` is a search snippet, `raw_content` is an extracted body.
 */
function fromPayload(payload: unknown): UntaggedSource[] {
  const sources: UntaggedSource[] = []

  for (const result of resultsOf(payload)) {
    const url = text(result['url'])
    if (url === '' || !/^https?:\/\//i.test(url)) continue

    const raw = text(result['raw_content']) || text(result['rawContent'])
    const body = raw || text(result['content'])
    if (body === '') continue

    const record: UntaggedSource = {
      title: text(result['title']) || hostOf(url),
      url,
      excerpt: clip(body, MAX_EXCERPT_CHARS),
      extracted: raw !== '',
    }

    const published = publishedDate(result)
    if (published !== undefined) record.publishedDate = published

    sources.push(record)
  }

  return sources
}

/** Parses a tool result body, which arrives as a JSON string on the ToolMessage. */
function parse(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/**
 * Merges a source into the map, keeping the richest version of each URL.
 *
 * A URL usually arrives twice: once as a search snippet, then again as an extracted body
 * once the loop decided to read it. The extract wins because it is the one that can
 * actually support an attribution, but its payload carries no title or date, so those are
 * kept from whichever hit had them.
 */
function merge(into: Map<string, UntaggedSource>, source: UntaggedSource): void {
  const existing = into.get(source.url)

  if (existing === undefined) {
    into.set(source.url, source)
    return
  }

  /*
  An extracted body wins over a snippet whatever their lengths: it is the only one that
  carries enough of the article to settle an attribution. Between two of a kind, the longer
  one wins.
  */
  const better =
    source.extracted === existing.extracted
      ? source.excerpt.length > existing.excerpt.length
      : source.extracted

  if (better) {
    existing.excerpt = source.excerpt
    existing.extracted = source.extracted
  }

  // A payload with no title of its own falls back to the host, which is a placeholder
  // rather than a title and must lose to a real one from either side.
  const placeholder = hostOf(source.url)
  if (existing.title === placeholder && source.title !== placeholder) {
    existing.title = source.title
  }

  existing.publishedDate ??= source.publishedDate
}

/** Every citable source a finished run retrieved, deduplicated and tagged in order. */
export function collectSources(messages: BaseMessage[]): SourceRecord[] {
  const byUrl = new Map<string, UntaggedSource>()

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) continue

    for (const source of fromPayload(parse(asText(message.content)))) {
      if (UNCITABLE_HOST.test(source.url)) continue
      merge(byUrl, source)
    }
  }

  return [...byUrl.values()].slice(0, MAX_SOURCES).map((source, index) => ({
    ...source,
    tag: `S${index + 1}`,
  }))
}

export type RenderOptions = {
  /** How much of each source body to show. */
  excerptChars: number
  /** How many sources to show at all, pages read in full first. */
  limit: number
  /**
   * Whether to print the URL.
   *
   * Off for the writing stages, which cite by tag and have the links appended for them —
   * a URL in front of a writer is a URL that ends up copied into the prose.
   */
  includeUrl: boolean
}

/**
 * Renders sources as one labelled block each.
 *
 * The host stays because it is how a reader judges a source, and the date stays because it
 * is how a writer knows a fact is from last night rather than from this morning.
 *
 * Pages that were read in full come first, because the limit can bite below the number of
 * sources a run collects and the one article the loop went and read is worth more than the
 * headlines it skipped. Tags do not move with them — a tag means the same source everywhere
 * it appears in a run, whatever order it is printed in.
 */
export function renderSourceBlocks(records: SourceRecord[], options: RenderOptions): string {
  return [...records]
    .sort((left, right) => Number(right.extracted) - Number(left.extracted))
    .slice(0, options.limit)
    .map((record) => {
      const meta = [hostOf(record.url)]
      if (record.publishedDate !== undefined) meta.push(`published ${record.publishedDate}`)

      const head = `[${record.tag}] ${record.title}\n(${meta.join(' — ')})`
      const link = options.includeUrl ? `\n${record.url}` : ''

      return `${head}${link}\n${clip(record.excerpt, options.excerptChars)}`
    })
    .join('\n\n')
}

/** A source tag as the writer leaves it in the text: `[S2]`, or `[S2][S5]` together. */
const SOURCE_TAG = /\[\s*[Ss](\d{1,2})\s*\]/g
/** The same, plus the space in front of it, which is where the writer put the tag. */
const TRAILING_SOURCE_TAG = /[ \t]*\[\s*[Ss]\d{1,2}\s*\]/g

export type BoundAnswer = {
  /** The answer with every tag removed. */
  body: string
  /** Only the sources the answer actually leaned on, in order of first use. */
  cited: SourceRecord[]
  /** Tags the writer invented, i.e. referring to a source that was never retrieved. */
  unknownTags: string[]
}

/**
 * Resolves the tags in a written answer into the sources behind them.
 *
 * This is what makes the trailing link list mean something. It used to be every URL the
 * run touched, which is a description of what was searched rather than of what the answer
 * rests on — ten links under a five-topic summary. Building it from the tags the writer
 * used instead ties each link to a claim, and an unresolvable tag is a free signal that a
 * claim has no source at all, with no extra model call to detect it.
 */
export function bindSources(answer: string, records: SourceRecord[]): BoundAnswer {
  const byTag = new Map(records.map((record) => [record.tag.toUpperCase(), record]))
  const cited: SourceRecord[] = []
  const unknownTags: string[] = []

  for (const match of answer.matchAll(SOURCE_TAG)) {
    // Through Number so a writer's "[S01]" resolves to the same source as "[S1]".
    const tag = `S${Number(match[1])}`
    const record = byTag.get(tag)

    if (record === undefined) {
      if (!unknownTags.includes(tag)) unknownTags.push(tag)
      continue
    }
    if (!cited.includes(record)) cited.push(record)
  }

  const body = answer
    .replace(TRAILING_SOURCE_TAG, '')
    // A tag mid-sentence leaves the following punctuation floating, and one on its own
    // line leaves the line itself behind.
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim()

  return { body, cited, unknownTags }
}
