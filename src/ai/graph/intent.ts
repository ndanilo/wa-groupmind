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

/*
Asks that are about the last 24 hours, English first to match the OUTPUT_LANGUAGE default.

Several stems cover more than one language once stripAccents has run — "noticias" is
spelled the same in Spanish and Portuguese, and "recent" / "recente" / "recentemente"
share a prefix — so the list stays shorter than three separate ones would be.
*/
const DAY_PATTERNS: RegExp[] = [
  /\btoday\b/,
  /\bright\s+now\b/,
  /\bjust\s+now\b/,
  /\bthis\s+morning\b/,
  /\blatest\b/,
  /\bbreaking\b/,
  /*
  A news digest is about now even when nobody says "today" — "what are the main headlines"
  is the exact wording that came back once as an undated search over front pages. The
  importance word is bound to a news noun on purpose: "the most important points in this
  contract" is not a recency ask.
  */
  /\b(?:top|main|biggest)\s+(?:news|headlines|stories|events)\b/,
  /\bmost\s+(?:important|relevant|recent)\s+(?:news|headlines|stories|events)\b/,
  /\b(?:news|headlines|stories)\s+of\s+the\s+day\b/,
  // Spanish and Portuguese.
  /\b(?:hoy|hoje)\b/,
  /\bagora\b/,
  /\bahora\s+mismo\b/,
  /\bultima\s+hora\b/,
  /\bneste\s+momento\b/,
  /\bde\s+manha\b/,
  /\bresumo\s+do\s+dia\b/,
  /\bultim(?:a|as|o|os)\s+(?:noticia|noticias|hora|horas|novidade|novidades|acontecimento|acontecimentos)\b/,
  /\bprincipa(?:is|les)\s+(?:noticias|manchetes|titulares|acontecimentos|destaques)\b/,
  /\b(?:noticias|manchetes|titulares|acontecimentos|destaques)\s+(?:mais\s+)?(?:importantes|relevantes|recentes)\b/,
  /*
  An explicit calendar date, which people write when they mean that exact day. The month
  names are closed rather than stemmed: a bare `mar[a-z]*` turns "market 5" into a recency
  ask, and `dec[a-z]*` does the same to "decision 3".
  */
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/,
  /\b\d{1,2}\s+de\s+(?:janeiro|enero|fevereiro|febrero|marco|marzo|abril|maio|mayo|junho|junio|julho|julio|agosto|setembro|septiembre|outubro|octubre|novembro|noviembre|dezembro|diciembre)\b/,
]

/** Asks that span the last several days. */
const WEEK_PATTERNS: RegExp[] = [
  /\b(?:this|last|past)\s+week\b/,
  /\bpast\s+few\s+days\b/,
  // "recent", "recently", "recente(s)", "recentemente".
  /\brecent(?:e|es|ly|emente)?\b/,
  /\b(?:esta|nesta|ultima)\s+semana\b/,
  /\bsemana\s+(?:passada|pasada)\b/,
  /\bultimos\s+dias\b/,
]

/**
 * Detects how fresh the sources have to be.
 *
 * Deterministic for the same reason `detectAnswerDepth` is: this drives Tavily's `topic`
 * and `timeRange`, and those used to be part of the schema the research model filled in.
 * The same question then retrieved differently on every run — once an undated general
 * search over news front pages, once `topic=news, timeRange=day` over dated articles —
 * which was most of the quality gap between two answers to the same words.
 *
 * `undefined` means no recency constraint at all, which is right for "the best series of
 * 2026" and wrong for nothing.
 */
export function detectFreshness(question: string): 'day' | 'week' | undefined {
  const q = stripAccents(question.trim())
  if (!q) return undefined

  for (const pattern of DAY_PATTERNS) {
    if (pattern.test(q)) return 'day'
  }

  for (const pattern of WEEK_PATTERNS) {
    if (pattern.test(q)) return 'week'
  }

  return undefined
}
