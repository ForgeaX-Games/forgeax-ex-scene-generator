import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { digest, GATES, validateInventory, validatePromoted } from './runner-core.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..', '..')
const checkpointPath = resolve(process.cwd(), process.argv[2] ?? resolve(appRoot, 'acceptance', '.checkpoints', 'latest.json'))
const inventoryPath = resolve(appRoot, 'acceptance', 'inventory', 'scene-script-battery-inventory.json')
const promotedPath = resolve(appRoot, 'acceptance', 'promoted.json')
const currentPath = resolve(appRoot, 'acceptance', 'current.json')

const [checkpoint, inventory, current] = await Promise.all([
  readFile(checkpointPath, 'utf8').then(JSON.parse),
  readFile(inventoryPath, 'utf8').then(JSON.parse),
  readFile(promotedPath, 'utf8').then(JSON.parse),
])
const checkpointRef = relative(dirname(promotedPath), checkpointPath).replaceAll('\\', '/')
const normalizedInventory = validateInventory(inventory)
const entries = new Map((inventory.entries ?? []).map((entry) => [entry.cellId ?? entry.opId, entry]))
// Inventory identities can legitimately migrate (for example, composites moved
// from retired JSON oracle paths to canonical `.scene.ts` paths). Carrying those
// removed identities forward makes a full passing checkpoint impossible to
// promote, so retain only cells that still exist in the authoritative inventory.
const promotions = new Map(
  (current.promotions ?? [])
    .filter((item) => entries.has(item.cellId))
    .map((item) => [item.cellId, item]),
)
const coverage = {}
let promotedCount = 0

function acceptanceKey(entry) {
  if (!entry?.kind) return undefined
  const identity = entry.kind === 'atomic' ? entry.opId : entry.functionNameSuggestion
  return identity ? `${entry.kind}:${identity}` : undefined
}

for (const [cellId, cell] of Object.entries(checkpoint.cells ?? {})) {
  if (cell.status !== 'pass' || GATES.some((gate) => cell.gates?.[gate]?.status !== 'pass')) continue
  promotions.set(cellId, {
    cellId,
    checkpoint: checkpointRef,
    evidenceDigest: digest(cell),
  })
  promotedCount += 1
}

// Refresh unchanged promotions too. Evidence files are intentionally
// content-addressed, so a rerun of either shared checkpoint can change several
// result digests at once; updating only the currently selected batch would make
// the ledger impossible to advance without temporarily deleting valid entries.
const checkpointCache = new Map([[checkpointRef, checkpoint]])
for (const [cellId, promotion] of promotions) {
  let source = checkpointCache.get(promotion.checkpoint)
  if (!source) {
    source = JSON.parse(await readFile(resolve(dirname(promotedPath), promotion.checkpoint), 'utf8'))
    checkpointCache.set(promotion.checkpoint, source)
  }
  const cell = source.cells?.[cellId]
  if (cell?.status === 'pass' && GATES.every((gate) => cell.gates?.[gate]?.status === 'pass')) {
    promotions.set(cellId, { ...promotion, evidenceDigest: digest(cell) })
    const key = acceptanceKey(entries.get(cellId))
    if (key) coverage[key] = [...GATES]
  }
}

const generatedAt = new Date().toISOString()
const next = {
  schemaVersion: 1,
  generatedAt,
  promotions: [...promotions.values()].sort((left, right) => left.cellId.localeCompare(right.cellId)),
  coverage: Object.fromEntries(Object.entries(coverage).sort(([left], [right]) => left.localeCompare(right))),
}
const validation = await validatePromoted(next, normalizedInventory, promotedPath)
if (validation.status !== 'pass') {
  throw new Error(`promotion ledger is invalid: ${validation.errors.join('; ')}`)
}
const coverageKeys = Object.keys(next.coverage)
const currentEvidence = [...new Set(next.promotions.map((promotion) => promotion.checkpoint))].sort()
const historicalEvidence = []
const currentManifest = {
  schemaVersion: 1,
  generatedAt,
  authoritativeManifest: 'promoted.json',
  inventory: 'inventory/scene-script-battery-inventory.json',
  counts: {
    promotions: next.promotions.length,
    coverageKeys: coverageKeys.length,
    atomic: coverageKeys.filter((key) => key.startsWith('atomic:')).length,
    group: coverageKeys.filter((key) => key.startsWith('group:')).length,
    template: coverageKeys.filter((key) => key.startsWith('template:')).length,
  },
  currentEvidence,
  historicalEvidence,
}
await Promise.all([
  writeFile(promotedPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8'),
  writeFile(currentPath, `${JSON.stringify(currentManifest, null, 2)}\n`, 'utf8'),
])
console.log(`promoted ${promotedCount} passing cells from ${checkpointRef}`)
