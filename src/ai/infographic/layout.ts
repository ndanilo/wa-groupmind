/**
 * Heuristic: questions that want a named ranked list rather than aggregate stats panels.
 * Used to steer the brief stage so "lista de séries" stops becoming empty chart posters.
 */
export function prefersRankingLayout(question: string): boolean {
  const q = question
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  return (
    /\b(lista|list|ranking|top\s*\d+|melhores|pior(es)?|recomend|recomendacoes|vale a pena|valem a pena|valem a maratona|quais (sao|foram)|best of|maratona|destaques)\b/.test(
      q,
    ) || /\bo que (vale|valem)\b/.test(q)
  )
}
