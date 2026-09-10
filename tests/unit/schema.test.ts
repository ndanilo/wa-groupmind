import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BRIEF_LIMITS,
  MAX_RANKING_ITEMS,
  normaliseBrief,
  shorten,
  type InfographicBrief,
} from '../../src/ai/infographic/schema.js'
import { renderImagePrompt } from '../../src/ai/infographic/prompt.js'
import { captionFromBrief } from '../../src/whatsapp/reply.js'
import { prefersRankingLayout } from '../../src/ai/infographic/layout.js'

const sampleStatsBrief = (): InfographicBrief => ({
  layout: 'stats',
  art: {
    tone: 'editorial',
    palette: 'deep navy, gold, cream, charcoal',
    mood: 'precise, editorial, financial',
  },
  title: 'Taxa Selic em 2026',
  subtitle: 'O Copom manteve a taxa básica de juros em dois dígitos.',
  panels: [
    {
      label: 'Taxa atual',
      figure: '14,00% a.a.',
      note: 'Definida pelo Copom em agosto',
      icon: 'a bronze coin on descending stone steps',
      visual: 'photo',
    },
    {
      label: 'Inflação',
      figure: '4,5%',
      note: 'Acumulada em doze meses',
      icon: 'a rising thermometer beside a grocery basket',
      visual: 'photo',
    },
    {
      label: 'Expectativa',
      figure: '13,50%',
      note: 'Projeção de mercado para dezembro',
      icon: 'sleek neon line chart of Selic descending through 2026',
      visual: 'chart',
    },
  ],
  items: [],
  takeaway: 'Juros altos devem continuar enquanto a inflação não ceder.',
})

const sampleRankingBrief = (): InfographicBrief => ({
  layout: 'ranking',
  art: {
    tone: 'expressive',
    palette: 'charcoal, neon lime, off-white, deep teal',
    mood: 'premium, curated, streaming-guide',
  },
  title: 'Séries que valem a maratona',
  subtitle: 'O que a crítica mais elogiou — e onde assistir.',
  panels: [],
  items: [
    {
      name: 'O Urso',
      badge: 'Disney+',
      why: 'Temporada final com nota máxima',
    },
    {
      name: 'Hacks',
      badge: 'Max',
      why: 'Encerramento aclamado pela crítica',
    },
    {
      name: 'Pela Metade',
      badge: '2026',
      why: 'Criador de Baby Reindeer volta',
    },
    {
      name: 'Pluribus',
      badge: 'Apple TV+',
      why: 'Destaque nas listas de 2025',
    },
    {
      name: 'Dele & Dela',
      badge: '25,6 mi',
      why: 'Uma das mais vistas em 2026',
    },
  ],
  takeaway: 'Finais premiados e novidades fortes dominam as listas.',
})

describe('shorten', () => {
  it('returns short strings unchanged', () => {
    assert.equal(shorten('hello', 10), 'hello')
  })

  it('cuts on a clause boundary when possible', () => {
    const input = 'Primeira cláusula aqui. Segunda cláusula sobra demais'
    assert.equal(shorten(input, 30), 'Primeira cláusula aqui')
  })

  it('drops a stranded connector at the end', () => {
    const input = 'após 10 meses de crescimento forte'
    const result = shorten(input, 18)
    assert.ok(!result.endsWith(' de'))
    assert.ok(result.length <= 18)
  })
})

describe('normaliseBrief', () => {
  it('keeps a well-sized stats brief intact', () => {
    const brief = sampleStatsBrief()
    const normalised = normaliseBrief(brief)
    assert.equal(normalised.layout, 'stats')
    assert.equal(normalised.title, brief.title)
    assert.equal(normalised.panels.length, 3)
    assert.equal(normalised.items.length, 0)
  })

  it('trims overlong fields', () => {
    const brief = sampleStatsBrief()
    brief.title = 'A'.repeat(BRIEF_LIMITS.title + 40)
    brief.panels[0]!.note = 'palavra '.repeat(30)

    const normalised = normaliseBrief(brief)
    assert.ok(normalised.title.length <= BRIEF_LIMITS.title)
    assert.ok(normalised.panels[0]!.note.length <= BRIEF_LIMITS.note)
  })

  it('caps panels at MAX_PANELS', () => {
    const brief = sampleStatsBrief()
    brief.panels.push({
      label: 'Extra',
      figure: '1',
      note: 'Sobra',
      icon: 'a spare key on a ring',
      visual: 'photo',
    })
    brief.panels.push({
      label: 'Mais',
      figure: '2',
      note: 'Sobra demais',
      icon: 'a second spare key',
      visual: 'diagram',
    })

    assert.equal(normaliseBrief(brief).panels.length, 4)
  })

  it('keeps ranking items and clears panels', () => {
    const brief = sampleRankingBrief()
    brief.panels = [
      {
        label: 'noise',
        figure: '10',
        note: 'should go away',
        icon: 'noise icon',
        visual: 'chart',
      },
    ]
    const normalised = normaliseBrief(brief)
    assert.equal(normalised.layout, 'ranking')
    assert.equal(normalised.panels.length, 0)
    assert.equal(normalised.items.length, 5)
    assert.equal(normalised.items[0]!.name, 'O Urso')
  })

  it('promotes stats→ranking when enough items are present', () => {
    const brief = sampleStatsBrief()
    brief.layout = 'stats'
    brief.items = sampleRankingBrief().items
    brief.panels = brief.panels.slice(0, 2)

    const normalised = normaliseBrief(brief)
    assert.equal(normalised.layout, 'ranking')
    assert.equal(normalised.items.length, 5)
    assert.equal(normalised.panels.length, 0)
  })

  it('caps ranking items at MAX_RANKING_ITEMS', () => {
    const brief = sampleRankingBrief()
    while (brief.items.length < MAX_RANKING_ITEMS + 2) {
      brief.items.push({
        name: `Extra ${brief.items.length}`,
        badge: '—',
        why: 'preenchimento de teste',
      })
    }
    assert.equal(normaliseBrief(brief).items.length, MAX_RANKING_ITEMS)
  })
})

describe('prefersRankingLayout', () => {
  it('detects Portuguese list questions', () => {
    assert.equal(
      prefersRankingLayout('crie uma lista com as principais séries de 2026'),
      true,
    )
    assert.equal(prefersRankingLayout('séries que valem a maratona'), true)
    assert.equal(prefersRankingLayout('quais são as melhores séries?'), true)
  })

  it('leaves figure questions as stats', () => {
    assert.equal(prefersRankingLayout('qual a taxa Selic atual?'), false)
    assert.equal(prefersRankingLayout('como está a inflação no Brasil?'), false)
  })
})

describe('captionFromBrief', () => {
  it('uses title + subtitle for stats', () => {
    assert.equal(
      captionFromBrief(sampleStatsBrief()),
      '*Taxa Selic em 2026*\nO Copom manteve a taxa básica de juros em dois dígitos.',
    )
  })

  it('includes numbered ranking names', () => {
    const caption = captionFromBrief(sampleRankingBrief())
    assert.ok(caption.includes('*Séries que valem a maratona*'))
    assert.ok(caption.includes('1. *O Urso* _(Disney+)_'))
    assert.ok(caption.includes('5. *Dele & Dela*'))
  })
})

describe('renderImagePrompt', () => {
  it('asks for a vivid card ranking poster when layout is ranking', () => {
    const prompt = renderImagePrompt(sampleRankingBrief(), {
      language: 'pt-BR',
      aspectRatio: '9:16',
    })
    assert.ok(prompt.includes('magazine-cover ranking poster'))
    assert.ok(prompt.includes('Card #1: giant numeral 1; title "O Urso"'))
    assert.ok(prompt.includes('pill "Disney+"'))
    assert.ok(prompt.includes('never print English schema words'))
    assert.ok(!prompt.includes('Panel 1'))
  })

  it('keeps panel copy for stats layout', () => {
    const prompt = renderImagePrompt(sampleStatsBrief(), {
      language: 'pt-BR',
      aspectRatio: '9:16',
    })
    assert.ok(prompt.includes('Panel 1'))
    assert.ok(prompt.includes('14,00% a.a.'))
  })
})
