import type { InfographicBrief } from './schema.js'

/*
Composes the image prompt from a finished brief.

Plain string building — no extra model call — so figures and list names stay verbatim.
*/

export type ImagePromptOptions = {
  language: string
  aspectRatio: string
  paletteOverride?: string
  hasStyleReferences?: boolean
}

export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`
}

function rankingArtBlock(
  brief: InfographicBrief,
  palette: string,
  aspectRatio: string,
  hasStyleReferences: boolean,
): string[] {
  const expressive = brief.art.tone === 'expressive'
  const lines = [
    `A breathtaking, magazine-cover ranking poster in ${aspectRatio} portrait — the kind Letterboxd, Spotify Wrapped, Apple TV+, or a premium streaming guide would publish. Gorgeous, vivid, cinematic. NOT a plain text dump, NOT a spreadsheet, NOT a wireframe UI list.`,
    '',
    `Register: ${expressive ? 'entertainment / culture — bold and atmospheric' : 'premium curated guide — polished and data-forward'}. Visual mood: ${brief.art.mood}.`,
    `Colour palette (mandatory): ${palette}. Rich atmospheric background (gradient haze, soft grain, subtle light blooms) — never a flat solid black void. Luminous accent for ranks; crisp off-white type. Ban cream newspaper paper and toy-bright Brazilian-flag blocks.`,
    '',
    `COMPOSITION — exactly ${brief.items.length} entry cards stacked vertically under a bold hero header:`,
    '- Each entry is a frosted glass / soft-matte card with rounded corners, gentle depth, consistent left padding, and even vertical rhythm.',
    '- Left: oversized glowing rank (#1…#N) as a design object — huge, accent-coloured, soft outer glow.',
    '- Centre: the show/item title in bold display type (hero of the row). Directly under it, ONE quiet supporting line (the reason) in smaller weight — never cramped against the next card.',
    '- Right or as a compact chip near the title: ONE small pill badge (platform / score). Keep pills short; never a cluster of tags.',
    '- Optional per-row visual: a small abstract motif or soft colour wash that hints at the subject (silhouette, symbol, light streak) — decorative only, never competing with the text.',
    '',
    'HARD BANS — never print English schema words or UI chrome: RANK, NAME, WHY, BADGE, LABEL, TITLE, ITEM, PANEL. No column headers. No "why:" prefixes. No repeated field captions on every row. No thin hairline-only layouts with empty wasted space. No overlapping or floating orphan text fragments.',
    '',
    'Decoration: atmospheric depth, soft vignettes, accent light leaks, refined geometric accents. Banned: cartoons, thick black outlines, clip-art, stock metaphor photos, faces of real people, streamer logos as trademarks, watermarks, signatures.',
  ]
  if (hasStyleReferences) {
    lines.push(
      'Reference photos are attached for lighting/mood only. Do not copy them; do not reproduce faces.',
    )
  }
  lines.push(
    '',
    'Typography: sharp contemporary display / grotesque with dramatic scale. Rank numbers dominate; titles bold and fully legible; reasons quieter and always a single tidy line; badges tiny. Letter-perfect spelling. Perfect alignment across all rows — same grid for every entry.',
  )
  return lines
}

function statsArtBlock(
  brief: InfographicBrief,
  palette: string,
  aspectRatio: string,
  hasStyleReferences: boolean,
): string[] {
  const editorial = brief.art.tone !== 'expressive'
  const chartCount = brief.panels.filter((p) => p.visual === 'chart').length

  if (editorial) {
    const lines = [
      `A breathtaking modern digital data-visualisation poster in ${aspectRatio} portrait format — the kind that stops a scroll on Bloomberg, The Verge, or a premium fintech app. Cinematic, sharp, unforgettable.`,
      '',
      `Register: contemporary editorial / data-forward. Visual mood: ${brief.art.mood}.`,
      `Colour palette (mandatory): ${palette}. High contrast, luminous accents on deep backgrounds or crisp light fields. Ban cream newspaper paper and toy-bright Brazilian-flag blocks.`,
      '',
      chartCount > 0
        ? `Data graphics: ${chartCount} panel(s) must feature clear, beautiful charts (line, bar, area, sparklines) with readable axes implied by the figures — glassmorphism or clean geometric series, glowing accents.`
        : 'Data graphics: prefer bold typographic figures; when a trajectory or comparison is present, elevate it with a sleek chart.',
      '',
      "Illustration elsewhere: photorealistic details OR sleek modern diagrams. Banned: cartoons, thick black outlines, clip-art, childish mascots, lazy metaphor photos, watermarks, logos, and any identifiable real person's face.",
    ]
    if (hasStyleReferences) {
      lines.push(
        'Reference photos are attached for lighting and photographic quality only. Do not copy or recreate them; do not reproduce faces.',
      )
    }
    lines.push(
      '',
      'Typography: sharp contemporary display / grotesque with dramatic scale — enormous luminous figures, quiet labels.',
      '',
      'Composition: asymmetric, layered, cinematic — overlapping panels, bold colour fields, depth, subtle glow. Not a flat grid of identical beige cards.',
    )
    return lines
  }

  return [
    `A striking, modern editorial infographic poster in ${aspectRatio} portrait format. Vivid, beautiful and contemporary.`,
    '',
    `Visual mood: ${brief.art.mood}.`,
    `Colour palette (mandatory, unique to this subject): ${palette}.`,
    '',
    'Illustration: custom icons and spot illustrations for this subject. Charts welcome when numbers move over time. Never cartoons with thick black outlines.',
    '',
    'Typography: contemporary geometric sans-serif with dramatic scale contrast.',
    '',
    'Composition: editorial and asymmetric. Vary sections instead of identical stacked cards.',
  ]
}

export function renderImagePrompt(brief: InfographicBrief, options: ImagePromptOptions): string {
  const language = languageName(options.language)
  const palette = options.paletteOverride?.trim() || brief.art.palette
  const isRanking = brief.layout === 'ranking' && brief.items.length > 0

  const art = isRanking
    ? rankingArtBlock(brief, palette, options.aspectRatio, Boolean(options.hasStyleReferences))
    : statsArtBlock(brief, palette, options.aspectRatio, Boolean(options.hasStyleReferences))

  const body = isRanking
    ? [
        `Render exactly ${brief.items.length} entry cards (best first). Print ONLY the quoted strings — never the words rank/name/badge/why as labels:`,
        ...brief.items.map((item, index) => {
          const badge =
            item.badge && item.badge !== '—'
              ? ` pill ${quote(item.badge)}`
              : ' (no pill)'
          return `Card #${index + 1}: giant numeral ${index + 1}; title ${quote(item.name)};${badge}; supporting line ${quote(item.why)}.`
        }),
      ]
    : [
        `${brief.panels.length} panels:`,
        ...brief.panels.map((panel, index) => {
          const medium =
            panel.visual === 'chart'
              ? 'CHART'
              : panel.visual === 'diagram'
                ? 'DIAGRAM'
                : 'PHOTO'
          return `Panel ${index + 1} [${medium}] — label ${quote(panel.label)}, large figure ${quote(
            panel.figure,
          )}, caption ${quote(panel.note)}. Visual: ${panel.icon}.`
        }),
      ]

  return [
    ...art,
    '',
    '--- TEXT TO RENDER ---',
    `All text is in ${language}. Render every string below exactly as written, character for character, including accents and punctuation. Do not translate, rephrase, abbreviate or correct any of it.`,
    '',
    `Headline: ${quote(brief.title)}`,
    `Subheading: ${quote(brief.subtitle)}`,
    '',
    ...body,
    '',
    `Footer band across the bottom: ${quote(brief.takeaway)}`,
    '',
    isRanking
      ? 'Each quoted string appears exactly once. Do not invent extra titles or numbers. Do not add RANK/NAME/WHY labels, decorative lettering, placeholder text, lorem ipsum, watermark, signature, logo, or URLs. Keep every card on the same grid — no broken or overlapping rows.'
      : 'Each string above appears exactly once on the poster. Do not invent extra names or numbers. Do not add decorative lettering, placeholder text, lorem ipsum, watermark, signature, logo, or URLs.',
  ].join('\n')
}
