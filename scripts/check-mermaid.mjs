/**
 * Renders every mermaid block in the READMEs through mermaid.ink and reports any
 * that fail to parse. Diagram source is public README content, so nothing private
 * leaves the machine.
 *
 * Run from the repo root:  node scripts/check-mermaid.mjs
 */
import { readFileSync } from 'node:fs'

const DOCS = ['README.md', 'README.pt-BR.md', 'README.es.md']
const BLOCK = /```mermaid\n([\s\S]*?)```/g

let failed = 0

for (const doc of DOCS) {
  const blocks = [...readFileSync(doc, 'utf8').matchAll(BLOCK)].map((m) => m[1].trim())
  for (const [i, code] of blocks.entries()) {
    const encoded = Buffer.from(code, 'utf8').toString('base64url')
    const kind = code.split('\n')[0].trim().split(/\s+/)[0]
    let status
    try {
      const res = await fetch(`https://mermaid.ink/svg/${encoded}`)
      status = res.status
    } catch (error) {
      status = `network error: ${error.message}`
    }
    const ok = status === 200
    if (!ok) failed += 1
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${doc.padEnd(18)} block ${i + 1} (${kind}) -> ${status}`)
  }
}

console.log(failed === 0 ? '\nall diagrams parse' : `\n${failed} diagram(s) failed to parse`)
if (failed > 0) process.exit(1)
