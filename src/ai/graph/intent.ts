/**
 * Hybrid intent detection: free keyword check first, LLM only when ambiguous.
 *
 * Returns:
 * - 'image'  — the user clearly asked for an infographic / poster / drawing
 * - 'text'   — the user clearly asked for a plain answer (rare; most text is "ambiguous")
 * - undefined — ambiguous; the classify node should call the LLM
 */

function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Clear asks for a generated visual. */
const IMAGE_PATTERNS: RegExp[] = [
  /\binfografico\b/,
  /\binfographic\b/,
  /\bimagem\b/,
  /\bimage\b/,
  /\bfigura\b/,
  /\bposter\b/,
  /\bcartaz\b/,
  /\bdesenh(a|e|ar|ando)?\b/,
  /\bdraw(ing)?\b/,
  /\bilustra(r|cao|cao)?\b/,
  /\billustrat(e|ion)?\b/,
  /\bvisual\b/,
  /\bcard\b/,
  /\bpicture\b/,
  /\barte\b/,
  /\bgrafico\b/,
  /\bchart\b/,
  /\bgera(r)?\s+(uma?\s+)?(imagem|arte|infografico|figura|poster|cartaz)\b/,
  /\bmont(a|e|ar)\s+(uma?\s+)?(imagem|arte|infografico|figura|poster|cartaz)\b/,
  /\bfaz(er)?\s+(uma?\s+)?(imagem|arte|infografico|figura|poster|cartaz)\b/,
  /\bcria(r)?\s+(uma?\s+)?(imagem|arte|infografico|figura|poster|cartaz)\b/,
]

/**
 * Detects whether the question wants an image/infographic.
 * Prefer keyword hits; return undefined so the LLM classifier can decide when unsure.
 */
export function detectImageIntent(question: string): 'image' | 'text' | undefined {
  const q = stripAccents(question.trim())
  if (!q) return undefined

  for (const pattern of IMAGE_PATTERNS) {
    if (pattern.test(q)) return 'image'
  }

  return undefined
}

/** Explicit asks for prose instead of the default scannable topic list. */
const DETAILED_PATTERNS: RegExp[] = [
  /\bdetalh(a|e|es|ado|ada|adamente|ar)\b/,
  /\bdetail(s|ed)?\b/,
  /*
  Two stems, because Portuguese swaps the c for qu in exactly the forms people type when
  they ask: "me explique", "expliquem". A single `explic` stem answered "me explique …"
  with the default topic list, which is the opposite of what the reader asked for.
  */
  /\bexplic(a|ar|acao|ando|ado|ada)\b/,
  /\bexpliqu(e|ei|em)\b/,
  /\bexplain\b/,
  /\baprofund(a|e|ar|ado)\b/,
  /\besclarec(a|e|er|em)\b/,
  /\bcontext(o|ualiza|ualize)\b/,
  /\bcompleto\b/,
  /\banalis(a|e|ar)\b/,
  /\banalysis\b/,
  /\bpor\s?que\b/,
  /*
  The subject normally sits between "como" and the verb — "como a polícia conseguiu",
  "como o vazamento aconteceu" — so allow a few words in between. The verb list stays
  closed on purpose: "como está o dólar" is a plain question, not a request to explain.
  */
  /\bcomo\s+(?:\S+\s+){0,3}(funciona(m|ram|va)?|funcionou|acontec(e|em|eu)|foi|fez|fizeram|conseguiu|conseguiram|surgiu|comecou|virou)\b/,
  /\bme\s+conta\s+mais\b/,
  /\bmais\s+detalhes\b/,
]

/**
 * Detects whether the reader asked for a full explanation.
 *
 * `undefined` means no explicit signal, so the classifier's own read is used and the
 * default (a scannable topic list) applies.
 */
export function detectAnswerDepth(question: string): 'detailed' | undefined {
  const q = stripAccents(question.trim())
  if (!q) return undefined

  for (const pattern of DETAILED_PATTERNS) {
    if (pattern.test(q)) return 'detailed'
  }

  return undefined
}
