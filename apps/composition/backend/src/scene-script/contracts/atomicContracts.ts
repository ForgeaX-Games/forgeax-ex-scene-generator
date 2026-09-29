import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  parseAtomicContractSource,
  type NodeFunctionContract,
} from '@forgeax/scene-authoring'

async function collectContractFiles(dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectContractFiles(path, output)
    else if (entry.isFile() && entry.name === 'scene.contract.ts') output.push(path)
  }
}

/** Load co-located static TS contracts. The files are parsed, never executed. */
export async function loadAtomicContracts(roots: string[]): Promise<NodeFunctionContract[]> {
  const files: string[] = []
  for (const root of roots) await collectContractFiles(root, files)
  const contracts: NodeFunctionContract[] = []
  const functionSources = new Map<string, string>()
  const opSources = new Map<string, string>()
  for (const path of files.sort()) {
    const source = await readFile(path, 'utf8')
    const parsed = parseAtomicContractSource(source, path)
    if (parsed.diagnostics.length) {
      throw new Error(parsed.diagnostics.map((item) => `${item.file}: ${item.code}: ${item.message}`).join('\n'))
    }
    for (const contract of parsed.contracts) {
      const functionSource = functionSources.get(contract.functionName)
      if (functionSource) throw new Error(`duplicate atomic functionName '${contract.functionName}': ${functionSource}, ${path}`)
      // Multiple typed contracts for one dynamic runtime op are allowed only
      // when each declares the inferred runtime specialization.
      const opSource = opSources.get(contract.opId)
      if (opSource && !contract.runtimeDefaults?.inferredType) {
        throw new Error(`duplicate atomic opId '${contract.opId}': ${opSource}, ${path}`)
      }
      functionSources.set(contract.functionName, path)
      opSources.set(contract.opId, path)
      contracts.push(contract)
    }
  }
  return contracts
}
