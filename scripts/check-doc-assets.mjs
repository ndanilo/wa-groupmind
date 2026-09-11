/**
 * Documentation asset guard.
 *
 * Fails when an asset the docs reference is missing, when an asset on disk is
 * referenced by nothing, or when one README gains an asset and the others do not.
 * Offline and deterministic, so CI can depend on it.
 *
 * Run from the repo root:  node scripts/check-doc-assets.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const READMES = ['README.md', 'README.pt-BR.md', 'README.es.md']
const DOCS = [...READMES, 'docs/assets/README.md']
const REF = /(?:src="|]\()(docs\/assets\/[^")]+)/g

/**
 * Assets that are legitimately not linked from markdown. GitHub serves the social
 * preview from repository settings, not from the tree, so nothing can reference it.
 */
const NOT_LINKED = new Set(['social-preview.jpg'])

const counts = new Map()
const referenced = new Set()
let missing = 0

for (const doc of DOCS) {
  const refs = [...readFileSync(doc, 'utf8').matchAll(REF)].map((m) => m[1])
  counts.set(doc, refs.length)
  for (const ref of refs) {
    referenced.add(ref.replace('docs/assets/', ''))
    if (!existsSync(ref)) {
      console.log(`MISSING   ${doc} references ${ref}, which does not exist`)
      missing += 1
    }
  }
  console.log(`${doc.padEnd(24)} ${refs.length} refs`)
}

const orphans = readdirSync('docs/assets')
  .filter((f) => /\.(png|jpe?g|gif|svg|mp4|webm)$/i.test(f))
  .filter((f) => !referenced.has(f) && !NOT_LINKED.has(f))

for (const f of orphans) {
  console.log(`ORPHAN    docs/assets/${f} is referenced by nothing. Use it or delete it.`)
}

const [en, pt, es] = READMES.map((d) => counts.get(d))
const synced = en === pt && pt === es

console.log(`\norphans        : ${orphans.length}`)
console.log(`missing        : ${missing}`)
console.log(`READMEs in sync: ${synced ? 'yes' : `NO (en=${en} pt=${pt} es=${es})`}`)

if (missing > 0 || orphans.length > 0 || !synced) process.exit(1)
