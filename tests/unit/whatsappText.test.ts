import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toWhatsAppText } from '../../src/ai/lib/whatsappText.js'

describe('toWhatsAppText', () => {
  it('leaves a clean WhatsApp answer untouched', () => {
    const clean = '*Selic mantida em 14%*\nO Copom manteve a taxa em agosto.\n\n*Dólar a R$ 5,18*\nAlta de 2% no mês.'

    assert.equal(toWhatsAppText(clean), clean)
  })

  it('converts markdown bold to WhatsApp bold', () => {
    assert.equal(toWhatsAppText('A **Selic** subiu'), 'A *Selic* subiu')
    assert.equal(toWhatsAppText('A __Selic__ subiu'), 'A *Selic* subiu')
  })

  it('turns headings into bold lines', () => {
    assert.equal(toWhatsAppText('## Taxa Selic\nManteve-se em 14%.'), '*Taxa Selic*\nManteve-se em 14%.')
    assert.equal(toWhatsAppText('# **Resumo** #'), '*Resumo*')
  })

  it('converts bullets to a character WhatsApp renders', () => {
    const listed = toWhatsAppText('- primeiro item\n* segundo item\n+ terceiro item')

    assert.equal(listed, '• primeiro item\n• segundo item\n• terceiro item')
  })

  it('never mistakes a bold headline for a bullet', () => {
    assert.equal(toWhatsAppText('*Manchete*\nUm fato.'), '*Manchete*\nUm fato.')
  })

  it('unwraps markdown links into a readable URL', () => {
    assert.equal(
      toWhatsAppText('Veja [a matéria do g1](https://g1.globo.com/materia) hoje'),
      'Veja a matéria do g1: https://g1.globo.com/materia hoje',
    )
  })

  it('strips code fences and inline backticks', () => {
    assert.equal(toWhatsAppText('```\nCNPJ: 35.486.142/0001-95\n```'), 'CNPJ: 35.486.142/0001-95')
    assert.equal(toWhatsAppText('o campo `valor` é obrigatório'), 'o campo valor é obrigatório')
  })

  it('flattens a markdown table into lines', () => {
    const table = '| Item | Valor |\n| --- | --- |\n| Selic | 14% |\n| Dólar | R$ 5,18 |'

    assert.equal(toWhatsAppText(table), 'Item — Valor\nSelic — 14%\nDólar — R$ 5,18')
  })

  it('rejoins a sentence broken mid-line', () => {
    // Exactly how a copied address arrives: one sentence, wrapped at the source.
    const wrapped = 'Escritórios em 1999 South Bascom Avenue Suite 700,\nCampbell, California, 95008, USA'

    assert.equal(
      toWhatsAppText(wrapped),
      'Escritórios em 1999 South Bascom Avenue Suite 700, Campbell, California, 95008, USA',
    )
  })

  it('keeps a comma before a blank line, a bullet or a list number', () => {
    assert.equal(toWhatsAppText('primeira linha,\n\nsegunda linha'), 'primeira linha,\n\nsegunda linha')
    assert.equal(toWhatsAppText('itens,\n• um\n• dois'), 'itens,\n• um\n• dois')
    assert.equal(toWhatsAppText('ranking,\n1. primeiro'), 'ranking,\n1. primeiro')
  })

  it('drops markdown escapes and trailing spaces', () => {
    assert.equal(toWhatsAppText('custa 5 \\* 3   \nreais'), 'custa 5 * 3\nreais')
  })

  it('collapses the oversized gaps models leave between blocks', () => {
    assert.equal(toWhatsAppText('*Um*\nfato\n\n\n\n*Dois*\nfato'), '*Um*\nfato\n\n*Dois*\nfato')
  })

  it('converts strikethrough', () => {
    assert.equal(toWhatsAppText('era ~~14,25%~~ agora 14%'), 'era ~14,25%~ agora 14%')
  })
})
