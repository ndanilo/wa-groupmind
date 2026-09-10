import { z } from 'zod/v3'

/*
The contract between the writing model and the image model.

Two layouts share the same art/title/subtitle/takeaway:

- stats    — 3–4 figure panels (interest rates, inflation, polls…)
- ranking  — 5–8 named items from search (best series, top investments…)

List questions used to be forced into stats panels and collapsed into meaningless
aggregates ("10 titles"). Ranking layout keeps the real names from research.
*/

export const BRIEF_LIMITS = {
  title: 60,
  subtitle: 100,
  label: 28,
  figure: 18,
  note: 80,
  takeaway: 110,
  icon: 80,
  palette: 140,
  mood: 70,
  itemName: 42,
  itemBadge: 22,
  itemWhy: 58,
} as const

export const MAX_PANELS = 4
export const MIN_RANKING_ITEMS = 5
/** Cap at 6 so a 9:16 poster stays readable and beautiful — 8 cramps into a text dump. */
export const MAX_RANKING_ITEMS = 6

export const infographicPanelSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe(
      `What this figure measures, in the requested output language, e.g. "Current rate". 1-4 words, at most ${BRIEF_LIMITS.label} characters, no trailing punctuation. Never the number itself.`,
    ),
  figure: z
    .string()
    .min(1)
    .describe(
      `The number this panel is about, with its unit attached, e.g. "14.00% p.a." or "$5.18". At most ${BRIEF_LIMITS.figure} characters. Never split the number from its unit, and never write a sentence here.`,
    ),
  note: z
    .string()
    .min(1)
    .describe(
      `One supporting line about this figure, in the requested output language, e.g. "Set by the central bank in August". A complete phrase that stands on its own, at most 10 words and ${BRIEF_LIMITS.note} characters. No source URLs.`,
    ),
  icon: z
    .string()
    .min(1)
    .describe(
      `In ENGLISH: the visual for this panel, 3-14 words, at most ${BRIEF_LIMITS.icon} characters. Prefer a concrete chart for trajectories/comparisons. Never cartoons, thick outlines, clip-art, trophies, lightbulbs, briefcases, clipboards, or identifiable real people / faces.`,
    ),
  visual: z
    .enum(['chart', 'photo', 'diagram'])
    .describe(
      'chart = line/bar/area/sparkline. photo = photorealistic detail. diagram = modern geometric illustration. Prefer chart when numbers move over time or compare.',
    ),
})

export const rankingItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      `Exact name of the item in the requested output language (series title, product, fund, place…). At most ${BRIEF_LIMITS.itemName} characters. Never invent a name that is not in the research notes.`,
    ),
  badge: z
    .string()
    .min(1)
    .describe(
      `Short enriching chip: score, platform, year, return, city… e.g. "IMDb 8.4", "Netflix", "CDI+". At most ${BRIEF_LIMITS.itemBadge} characters. Use "—" only if the notes truly have nothing.`,
    ),
  why: z
    .string()
    .min(1)
    .describe(
      `One concrete reason this item is on the list, from the notes, in the requested output language. At most ${BRIEF_LIMITS.itemWhy} characters. No URLs.`,
    ),
})

export const artDirectionSchema = z.object({
  tone: z
    .enum(['editorial', 'expressive'])
    .describe(
      'editorial = news, politics, economy, health, science, legal, current affairs. expressive = games, sports, entertainment, culture, lifestyle. Default to editorial when unsure.',
    ),
  palette: z
    .string()
    .min(1)
    .describe(
      `In ENGLISH: four or five modern, high-contrast colours for THIS subject (names or hex). Editorial: deep charcoal/midnight + one electric accent + clean off-white. Expressive: vivid and subject-specific. At most ${BRIEF_LIMITS.palette} characters.`,
    ),
  mood: z
    .string()
    .min(1)
    .describe(
      `In ENGLISH: two to four words. Editorial: "sharp, cinematic, data-forward". Ranking/list posters: "lush, cinematic, magazine-cover". Expressive: "arcane, mystical, high fantasy". At most ${BRIEF_LIMITS.mood} characters.`,
    ),
})

export const infographicBriefSchema = z.object({
  layout: z
    .enum(['stats', 'ranking'])
    .describe(
      'stats = the question is answered by a handful of figures (rates, %, dates, poll numbers). ranking = the question asks for a list, ranking, best-of, top N, recomendações, "quais são", "o que vale a pena" — named items from research. Prefer ranking whenever named entities answer the question better than aggregate stats.',
    ),
  art: artDirectionSchema.describe(
    'Visual direction for this poster. Not text: none of it is printed. Choose tone first, then palette/mood that match.',
  ),
  title: z
    .string()
    .min(1)
    .describe(
      `Headline in the requested output language answering the question directly. At most 8 words and ${BRIEF_LIMITS.title} characters.`,
    ),
  subtitle: z
    .string()
    .min(1)
    .describe(
      `One line of context under the headline, in the requested output language. A complete sentence, at most 14 words and ${BRIEF_LIMITS.subtitle} characters.`,
    ),
  panels: z
    .array(infographicPanelSchema)
    .max(MAX_PANELS)
    .describe(
      `For layout=stats only: three or four figures, most important first. For layout=ranking leave this as an empty array [].`,
    ),
  items: z
    .array(rankingItemSchema)
    .max(MAX_RANKING_ITEMS)
    .describe(
      `For layout=ranking only: ${MIN_RANKING_ITEMS}–${MAX_RANKING_ITEMS} named items, best first, each with a real name from the notes. For layout=stats leave this as an empty array []. Never collapse a list into "10 titles" — list the titles themselves.`,
    ),
  takeaway: z
    .string()
    .min(1)
    .describe(
      `Closing line at the foot of the poster, in the requested output language. A complete sentence that stands on its own, at most 16 words and ${BRIEF_LIMITS.takeaway} characters.`,
    ),
})

export type InfographicPanel = z.infer<typeof infographicPanelSchema>
export type RankingItem = z.infer<typeof rankingItemSchema>
export type ArtDirection = z.infer<typeof artDirectionSchema>
export type InfographicBrief = z.infer<typeof infographicBriefSchema>

const CLAUSE_SEPARATORS = ['. ', '; ', ': ', ', ', ' \u2014 ', ' \u2013 ', ' - ']
const STRANDED_WORD_LENGTH = 2
const MIN_CLAUSE_RATIO = 0.5

function trimTail(value: string): string {
  return value.replace(/[\s,;:.\u2013\u2014-]+$/, '')
}

export function shorten(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat

  const cut = flat.slice(0, max)

  const clause = Math.max(...CLAUSE_SEPARATORS.map((sep) => cut.lastIndexOf(sep)))
  if (clause >= max * MIN_CLAUSE_RATIO) return trimTail(cut.slice(0, clause))

  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace <= 0) return trimTail(cut)

  const words = cut.slice(0, lastSpace).split(' ')
  const lastWord = words.at(-1)
  if (words.length > 1 && lastWord !== undefined && lastWord.length <= STRANDED_WORD_LENGTH) {
    words.pop()
  }

  return trimTail(words.join(' '))
}

function normalisePanel(panel: InfographicPanel): InfographicPanel {
  return {
    label: shorten(panel.label, BRIEF_LIMITS.label),
    figure: shorten(panel.figure, BRIEF_LIMITS.figure),
    note: shorten(panel.note, BRIEF_LIMITS.note),
    icon: shorten(panel.icon, BRIEF_LIMITS.icon),
    visual: panel.visual === 'chart' || panel.visual === 'diagram' ? panel.visual : 'photo',
  }
}

function normaliseItem(item: RankingItem): RankingItem {
  return {
    name: shorten(item.name, BRIEF_LIMITS.itemName),
    badge: shorten(item.badge, BRIEF_LIMITS.itemBadge),
    why: shorten(item.why, BRIEF_LIMITS.itemWhy),
  }
}

/**
 * Brings a model's brief inside layout limits.
 * Also repairs layout mismatches (ranking with empty items → keep as ranking with what we have;
 * stats with empty panels stays stats).
 */
export function normaliseBrief(brief: InfographicBrief): InfographicBrief {
  const wantsRanking =
    brief.layout === 'ranking' ||
    ((brief.items?.length ?? 0) >= MIN_RANKING_ITEMS && (brief.panels?.length ?? 0) < 3)

  const art = {
    tone: brief.art.tone === 'expressive' ? ('expressive' as const) : ('editorial' as const),
    palette: shorten(brief.art.palette, BRIEF_LIMITS.palette),
    mood: shorten(brief.art.mood, BRIEF_LIMITS.mood),
  }

  const title = shorten(brief.title, BRIEF_LIMITS.title)
  const subtitle = shorten(brief.subtitle, BRIEF_LIMITS.subtitle)
  const takeaway = shorten(brief.takeaway, BRIEF_LIMITS.takeaway)

  if (wantsRanking) {
    const items = (brief.items ?? [])
      .map(normaliseItem)
      .filter((item) => item.name.length > 0)
      .slice(0, MAX_RANKING_ITEMS)

    return {
      layout: 'ranking',
      art,
      title,
      subtitle,
      panels: [],
      items,
      takeaway,
    }
  }

  return {
    layout: 'stats',
    art,
    title,
    subtitle,
    panels: (brief.panels ?? []).slice(0, MAX_PANELS).map(normalisePanel),
    items: [],
    takeaway,
  }
}
