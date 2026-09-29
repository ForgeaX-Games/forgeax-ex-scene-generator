import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAtomicContractSource } from '../../../packages/scene-authoring/src/index.ts'
import { getSceneContractRegistry } from '../backend/src/scene-script/contracts/contracts.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function collectNamedFiles(dir: string, name: string, result: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectNamedFiles(path, name, result)
    else if (entry.isFile() && entry.name === name) result.push(path)
  }
}

const registry = await getSceneContractRegistry()
const covered = new Set(registry.list().flatMap((contract) => contract.opId ? [contract.opId] : []))
const batteriesRoot = resolve(appRoot, 'batteries')
const leftoverMeta: string[] = []
await collectNamedFiles(batteriesRoot, 'meta.json', leftoverMeta)
if (leftoverMeta.length) {
  throw new Error(`first-batch batteries must not keep meta.json: ${leftoverMeta.map((path) => relative(appRoot, path)).join(', ')}`)
}

const contractFiles: string[] = []
await collectNamedFiles(batteriesRoot, 'scene.contract.ts', contractFiles)
const uncovered: string[] = []
for (const path of contractFiles) {
  const parsed = parseAtomicContractSource(await readFile(path, 'utf8'), path)
  if (parsed.diagnostics.length) {
    throw new Error(parsed.diagnostics.map((item) => `${item.file}: ${item.code}: ${item.message}`).join('\n'))
  }
  for (const contract of parsed.contracts) {
    if (!covered.has(contract.opId)) uncovered.push(contract.opId)
  }
}
if (uncovered.length) {
  throw new Error(`Palette battery lacks a loaded Scene Contract: ${uncovered.sort().join(', ')}.`)
}

console.log(JSON.stringify({
  coveredOpIds: [...covered].sort(),
  leftoverMeta: leftoverMeta.length,
  scannedFiles: contractFiles.length,
  root: relative(process.cwd(), appRoot),
}, null, 2))
