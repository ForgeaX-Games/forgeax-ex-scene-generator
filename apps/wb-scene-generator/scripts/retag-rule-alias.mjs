#!/usr/bin/env node
// Offline re-tag of an autotile rule name across the asset store + runtime scene.
//
// The rule name a tile asset binds to lives in alias field[7] (see
// backend/src/library/service.ts extractAliasTypeField). Renaming
// assets/rules/<kind>.json therefore orphans every asset still tagged with the
// old name: /library/serve/<old> 404s, getOrLoadRule returns null and the
// billboard falls back to blitting the whole atlas per cell (looks unstitched).
//
// Per AGENTS.md the backend is read-only against library.db, so this rewrite is
// an offline tool: run it, then commit the updated db. The asset store's own
// `history` table is append-only audit and is left untouched.
//
// Usage:
//   node scripts/retag-rule-alias.mjs <fromKind> <toKind> [--dry-run]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(appRoot, 'backend', 'package.json'))
const Database = require('better-sqlite3')

const DB_PATH = join(appRoot, 'materials', 'asset-store', 'library.db')
const RUNTIME_FILES = [
  join(appRoot, '.forgeax-runtime', 'baked-scene.json'),
  join(appRoot, '.forgeax-runtime', 'baked-scene-history.json'),
]

const [from, to, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
if (!from || !to) {
  console.error('usage: retag-rule-alias.mjs <fromKind> <toKind> [--dry-run]')
  process.exit(2)
}
if (!existsSync(join(appRoot, 'assets', 'rules', `${to}.json`))) {
  console.error(`refusing: assets/rules/${to}.json does not exist`)
  process.exit(1)
}

const FIELD_IDX = 7

/** Replace alias field[7] only when it equals `from`; other fields are untouched. */
function retagAlias(alias) {
  let field = -1
  return alias.replace(/\[([^\]]*)\]/g, (whole, inner) => {
    field += 1
    return field === FIELD_IDX && inner.trim() === from ? `[${to}]` : whole
  })
}

const db = new Database(DB_PATH)
const rows = db.prepare('select id, alias from assets').all()
const updates = []
for (const row of rows) {
  const next = retagAlias(row.alias)
  if (next !== row.alias) updates.push({ id: row.id, alias: next, before: row.alias })
}

console.log(`library.db: ${updates.length} asset alias(es) to re-tag ${from} → ${to}`)
for (const u of updates) console.log(`  ${u.before}\n→ ${u.alias}`)

if (!dryRun && updates.length > 0) {
  const stmt = db.prepare('update assets set alias = ? where id = ?')
  db.transaction(() => {
    for (const u of updates) stmt.run(u.alias, u.id)
  })()
  db.pragma('wal_checkpoint(TRUNCATE)')
}
db.close()

for (const file of RUNTIME_FILES) {
  if (!existsSync(file)) continue
  const raw = readFileSync(file, 'utf8')
  const next = raw.split(`[${from}]`).join(`[${to}]`)
  const hits = raw.split(`[${from}]`).length - 1
  console.log(`${file}: ${hits} reference(s)`)
  if (!dryRun && hits > 0) writeFileSync(file, next)
}

console.log(dryRun ? 'dry run — nothing written' : 'done')
