import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  detectAnswerDepth,
  detectFreshness,
  detectImageIntent,
} from '../../src/ai/graph/intent.js'

describe('detectImageIntent', () => {
  it('detects explicit Portuguese image asks', () => {
    assert.equal(detectImageIntent('faz um infográfico da taxa Selic'), 'image')
    assert.equal(detectImageIntent('gera uma imagem sobre isso'), 'image')
    assert.equal(detectImageIntent('cria uma arte com os dados'), 'image')
    assert.equal(detectImageIntent('monta um poster das melhores séries'), 'image')
    assert.equal(detectImageIntent('desenha um mapa do metro'), 'image')
  })

  it('works without accents', () => {
    assert.equal(detectImageIntent('faz um infografico da inflacao'), 'image')
    assert.equal(detectImageIntent('quero um grafico disso'), 'image')
  })

  it('detects English image asks', () => {
    assert.equal(detectImageIntent('draw me a chart of inflation'), 'image')
    assert.equal(detectImageIntent('make an infographic about this'), 'image')
  })

  it('returns undefined for plain questions so the LLM decides', () => {
    assert.equal(detectImageIntent('qual a taxa Selic atual?'), undefined)
    assert.equal(detectImageIntent('quais as melhores séries de 2026?'), undefined)
    assert.equal(detectImageIntent('oi, tudo bem?'), undefined)
    assert.equal(detectImageIntent('traduz "hello world" pro portugues'), undefined)
  })

  it('returns undefined for empty input', () => {
    assert.equal(detectImageIntent(''), undefined)
    assert.equal(detectImageIntent('   '), undefined)
  })

  it('does not fire on substrings of unrelated words', () => {
    // "imagina" contains "imag" but is not an image request.
    assert.equal(detectImageIntent('imagina se a Selic cair'), undefined)
    // "descarte" contains "cart" but is not "cartaz".
    assert.equal(detectImageIntent('como funciona o descarte de lixo'), undefined)
  })
})

describe('detectAnswerDepth', () => {
  it('detects explicit asks for an explanation', () => {
    assert.equal(detectAnswerDepth('explica a alta do dolar'), 'detailed')
    assert.equal(detectAnswerDepth('me da os detalhes do acordo'), 'detailed')
    assert.equal(detectAnswerDepth('quero uma resposta detalhada'), 'detailed')
    assert.equal(detectAnswerDepth('aprofunda nesse assunto'), 'detailed')
    assert.equal(detectAnswerDepth('por que a Selic subiu?'), 'detailed')
    assert.equal(detectAnswerDepth('como funciona o novo Pix?'), 'detailed')
    assert.equal(detectAnswerDepth('explain the new tariffs'), 'detailed')
  })

  it('detects the qu- spelling of explicar', () => {
    // Portuguese swaps the c for qu in the forms people actually type. A plain `explic`
    // stem answered "me explique …" with the default topic list.
    assert.equal(
      detectAnswerDepth('me explique como a policia recuperou as mensagens'),
      'detailed',
    )
    assert.equal(detectAnswerDepth('explique isso melhor'), 'detailed')
    assert.equal(detectAnswerDepth('expliquem esse caso'), 'detailed')
    assert.equal(detectAnswerDepth('me da uma explicacao disso'), 'detailed')
    assert.equal(detectAnswerDepth('esclareca essa duvida'), 'detailed')
  })

  it('detects "como" questions with the subject in between', () => {
    assert.equal(
      detectAnswerDepth('como a policia conseguiu recuperar as mensagens'),
      'detailed',
    )
    assert.equal(detectAnswerDepth('como o vazamento aconteceu'), 'detailed')
    assert.equal(detectAnswerDepth('como os bancos fizeram isso'), 'detailed')
  })

  it('leaves ordinary questions on the default topics format', () => {
    assert.equal(detectAnswerDepth('quais as noticias mais importantes do Brasil hoje'), undefined)
    assert.equal(detectAnswerDepth('qual a taxa Selic atual?'), undefined)
    assert.equal(detectAnswerDepth('quais as melhores series de 2026?'), undefined)
    assert.equal(detectAnswerDepth('oi, tudo bem?'), undefined)
    // "como" alone is not a request to explain, only "como <verb>" is.
    assert.equal(detectAnswerDepth('como esta o dolar hoje'), undefined)
    assert.equal(detectAnswerDepth('como assim'), undefined)
  })

  it('returns undefined for empty input', () => {
    assert.equal(detectAnswerDepth('   '), undefined)
  })
})

describe('detectFreshness', () => {
  it('detects an explicit ask for today in English', () => {
    assert.equal(detectFreshness('what happened today'), 'day')
    assert.equal(detectFreshness('where is the dollar right now'), 'day')
    assert.equal(detectFreshness('what is the latest on the strike'), 'day')
    assert.equal(detectFreshness('any breaking news'), 'day')
    assert.equal(detectFreshness('what did I miss this morning'), 'day')
  })

  it('treats a news digest as a question about today', () => {
    // The wording that started this: no time word, but a ranking over the day's reporting.
    assert.equal(detectFreshness('what are the main headlines'), 'day')
    assert.equal(detectFreshness('give me the top stories'), 'day')
    assert.equal(detectFreshness('the biggest news please'), 'day')
    assert.equal(detectFreshness('the most important news'), 'day')
    assert.equal(detectFreshness('headlines of the day'), 'day')
  })

  it('works in Spanish and Portuguese', () => {
    assert.equal(detectFreshness('que paso hoy'), 'day')
    assert.equal(detectFreshness('quais as principais noticias'), 'day')
    assert.equal(detectFreshness('cuales son las principales noticias'), 'day')
    assert.equal(detectFreshness('me da as ultimas noticias'), 'day')
    assert.equal(detectFreshness('ultima hora por favor'), 'day')
    assert.equal(detectFreshness('como esta o dolar agora'), 'day')
  })

  it('reads an explicit calendar date as that day', () => {
    assert.equal(detectFreshness('what happened on September 11'), 'day')
    assert.equal(detectFreshness('o que rolou no dia 11 de setembro'), 'day')
  })

  it('does not mistake a stemmed month for a date', () => {
    // A bare `mar[a-z]*` or `dec[a-z]*` turned both of these into recency asks.
    assert.equal(detectFreshness('is the market 5 percent down'), undefined)
    assert.equal(detectFreshness('what is in decision 3 of the board'), undefined)
  })

  it('widens to a week when the question spans days', () => {
    assert.equal(detectFreshness('what happened this week'), 'week')
    assert.equal(detectFreshness('a summary of last week'), 'week')
    assert.equal(detectFreshness('anything in the past few days'), 'week')
    assert.equal(detectFreshness('what are the recent cases'), 'week')
    assert.equal(detectFreshness('resumo da semana passada'), 'week')
    assert.equal(detectFreshness('resumen de la semana pasada'), 'week')
  })

  it('prefers the day when a question carries both signals', () => {
    assert.equal(detectFreshness('the most important recent news today'), 'day')
  })

  it('leaves a timeless question unconstrained', () => {
    assert.equal(detectFreshness('what are the best series of 2026?'), undefined)
    assert.equal(detectFreshness('what is the capital of Australia'), undefined)
    assert.equal(detectFreshness('translate "hello world" into Portuguese'), undefined)
    // An importance word not attached to news is about a document, not about the day.
    assert.equal(detectFreshness('the most important points in this contract'), undefined)
    assert.equal(detectFreshness('hi, how are you?'), undefined)
  })

  it('returns undefined for empty input', () => {
    assert.equal(detectFreshness('   '), undefined)
  })
})
