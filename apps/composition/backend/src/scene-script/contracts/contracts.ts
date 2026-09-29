import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { appRoot } from '../../resources.js'

import {
  AcceptanceCoverageMatrix,
  parseGeneratorContractSource,
  SceneContractRegistry,
  type AcceptanceGateId,
  type NodeFunctionContract,
} from '@forgeax/scene-authoring'
import { loadAtomicContracts } from './atomicContracts.js'
import { resolveSceneContractRoots } from '../firstBatchBatteries.js'
import { allSceneFiles, readSceneModule } from '../persist/store.js'

const promotedAcceptanceFile = resolve(appRoot, 'acceptance', 'promoted.json')

async function loadAcceptanceCoverage(): Promise<Record<string, AcceptanceGateId[]>> {
  return readFile(promotedAcceptanceFile, 'utf8')
    .then((source) => {
      const parsed = JSON.parse(source) as { coverage?: Record<string, AcceptanceGateId[]> }
      return parsed.coverage ?? {}
    })
    .catch(() => ({}))
}

let registryPromise: Promise<SceneContractRegistry> | undefined

/** First-batch and atomic battery contracts. Group compile from defineGroup is gone. */
export function getSceneContractRegistry(): Promise<SceneContractRegistry> {
  registryPromise ??= loadAtomicContracts(resolveSceneContractRoots()).then(async (atomicContracts) => {
    const matrix = new AcceptanceCoverageMatrix(await loadAcceptanceCoverage())
    const contracts = atomicContracts.map((contract) => ({
      ...contract,
      sceneScriptStatus: matrix.record(contract, contract.functionName).status,
    }))
    return new SceneContractRegistry(contracts)
  })
  return registryPromise
}

export async function getProjectSceneContractRegistry(projectDir: string): Promise<SceneContractRegistry> {
  const base = await getSceneContractRegistry()
  const extras: NodeFunctionContract[] = []
  for (const file of await allSceneFiles(projectDir)) {
    if (!file.endsWith('.generator.ts')) continue
    const source = (await readSceneModule(projectDir, file)).source
    if (!source.trim()) continue
    const parsed = parseGeneratorContractSource(source, file)
    extras.push(...parsed.exports.map((item) => item.contract))
  }
  if (extras.length === 0) return base
  return new SceneContractRegistry([...base.list(), ...extras])
}
