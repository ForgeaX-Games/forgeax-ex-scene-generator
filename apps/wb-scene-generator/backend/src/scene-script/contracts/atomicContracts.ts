import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  parseAtomicContractSource,
  type NodeFunctionContract,
  type PortContract,
} from '@forgeax/scene-authoring'

interface BatteryMetaPort {
  name?: string
  type?: string
  access?: 'item' | 'list' | 'tree'
}

interface BatteryMeta {
  id?: string
  inputs?: BatteryMetaPort[]
  outputs?: BatteryMetaPort[]
}

async function collectContractFiles(dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectContractFiles(path, output)
    else if (entry.isFile() && entry.name === 'scene.contract.ts') output.push(path)
  }
}

function portSignature(port: BatteryMetaPort | PortContract): string {
  return `${port.name ?? ''}:${port.type ?? 'any'}:${port.access ?? 'item'}`
}

function assertMetaParity(
  path: string,
  meta: BatteryMeta,
  contracts: NodeFunctionContract[],
): void {
  const opId = meta.id
  if (!opId) throw new Error(`${path}: sibling meta.json has no id`)
  for (const contract of contracts) {
    if (contract.opId !== opId) {
      throw new Error(`${path}: contract opId '${contract.opId}' does not match meta.json id '${opId}'`)
    }
    // Typed variants of dynamic ops intentionally specialize their public
    // contract; static batteries must remain exactly aligned with Runtime meta.
    if (contract.runtimeDefaults?.inferredType || contract.runtimeDefaults?.contractAdapter) continue
    const expectedInputs = (meta.inputs ?? []).map(portSignature)
    const actualInputs = contract.inputs.map(portSignature)
    const expectedOutputs = (meta.outputs ?? []).map(portSignature)
    const actualOutputs = contract.outputs.map(portSignature)
    if (JSON.stringify(actualInputs) !== JSON.stringify(expectedInputs)) {
      throw new Error(`${path}: input Contract drift for '${opId}': ${actualInputs.join(', ')} != ${expectedInputs.join(', ')}`)
    }
    if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) {
      throw new Error(`${path}: output Contract drift for '${opId}': ${actualOutputs.join(', ')} != ${expectedOutputs.join(', ')}`)
    }
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
    const metaPath = resolve(dirname(path), 'meta.json')
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as BatteryMeta
    assertMetaParity(path, meta, parsed.contracts)
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
