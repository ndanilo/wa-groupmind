import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { detectAnswerDepth, detectImageIntent } from '../../src/ai/graph/intent.js'

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
