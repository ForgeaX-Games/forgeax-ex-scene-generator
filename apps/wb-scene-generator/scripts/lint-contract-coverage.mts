import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getSceneContractRegistry } from '../backend/src/scene-script/contracts/contracts.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = resolve(appRoot, 'docs/architecture/scene-script-contract-baseline.json')

async function collectMetaFiles(dir: string, result: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectMetaFiles(path, result)
    else if (entry.isFile() && entry.name === 'meta.json') result.push(path)
  }
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
  legacyOpIds?: string[]
  maximumLegacyCount?: number
}
const registry = await getSceneContractRegistry()
const covered = new Set(registry.list().flatMap((contract) => contract.opId ? [contract.opId] : []))
const metaFiles: string[] = []
await collectMetaFiles(resolve(appRoot, 'batteries'), metaFiles)

const currentLegacy: string[] = []
for (const path of metaFiles) {
  const raw = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown }
  if (typeof raw.id === 'string' && raw.id && !covered.has(raw.id)) currentLegacy.push(raw.id)
}

const baselineLegacy = new Set(baseline.legacyOpIds ?? [])
const newUncovered = baselineLegacy.size
  ? currentLegacy.filter((id) => !baselineLegacy.has(id))
  : []
const exceedsReviewedCeiling =
  typeof baseline.maximumLegacyCount === 'number' && currentLegacy.length > baseline.maximumLegacyCount
if (newUncovered.length || exceedsReviewedCeiling) {
  throw new Error(
    `${newUncovered.length ? `New palette battery lacks a reversible Scene Contract: ${newUncovered.sort().join(', ')}.` : `Legacy palette coverage regressed: ${currentLegacy.length} exceeds reviewed ceiling ${baseline.maximumLegacyCount}.`} ` +
      'Add a Contract before exposing it, or explicitly update the reviewed baseline.',
  )
}

console.log(JSON.stringify({
  coveredOpIds: [...covered].sort(),
  legacyCount: currentLegacy.length,
  baselineLegacyCount: baselineLegacy.size,
  scannedFiles: metaFiles.length,
  root: relative(process.cwd(), appRoot),
}, null, 2))
