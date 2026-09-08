// One-shot: rewrite each migrated battery's `shared/types/index.js` import
// (legacy used varying ../ depth back to repo root) to the correct relative
// path to vendor/dist/shared/types/index.js for this repo's layout.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

const DIST = 'vendor/dist/shared/types/index.js'
let rewritten = 0

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (name !== 'index.ts' && name !== 'index.js') continue
    const src = readFileSync(p, 'utf-8')
    if (!/shared\/types\/index\.js/.test(src)) continue
    let rel = relative(dirname(p), DIST).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = './' + rel
    const out = src.replace(/(['"])(?:\.\.\/)+shared\/types\/index\.js\1/g, `'${rel}'`)
    if (out !== src) { writeFileSync(p, out); rewritten++ }
  }
}
walk('batteries')
console.log(`[copy-batteries] rewrote shared/types import in ${rewritten} files`)
