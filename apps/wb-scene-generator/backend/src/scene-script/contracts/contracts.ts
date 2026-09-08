import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { appRoot } from '../../resources.js'

import {
  AcceptanceCoverageMatrix,
  compileSceneGroupDefinition,
  parseSceneModule,
  SceneContractRegistry,
  type AcceptanceGateId,
  type NodeFunctionContract,
} from '@forgeax/scene-authoring'
import { loadAtomicContracts } from './atomicContracts.js'
import { compileStoredSceneProject } from '../compile/projectCompiler.js'
import { readSceneModule } from '../persist/store.js'

const promotedAcceptanceFile = resolve(appRoot, 'acceptance', 'promoted.json')

async function loadAcceptanceCoverage(): Promise<Record<string, AcceptanceGateId[]>> {
  return readFile(promotedAcceptanceFile, 'utf8')
    .then((source) => {
      const parsed = JSON.parse(source) as { coverage?: Record<string, AcceptanceGateId[]> }
      return parsed.coverage ?? {}
    })
    .catch(() => ({}))
}

async function collectTemplateFiles(dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectTemplateFiles(path, output)
    else if (entry.isFile() && entry.name.endsWith('.scene.ts')) output.push(path)
  }
}

async function loadNativeDefinitionContracts(atomicContracts: NodeFunctionContract[]): Promise<NodeFunctionContract[]> {
  const files: string[] = []
  await Promise.all([
    collectTemplateFiles(resolve(appRoot, 'batteries', 'groups'), files),
    collectTemplateFiles(resolve(appRoot, 'batteries', 'templates'), files),
  ])
  const nativeFiles = files
    .filter((path) => path.endsWith('.scene.ts') && !path.includes(`${resolve(appRoot, 'batteries', 'groups', 'test_terrain')}/`))
    .sort()
  const base = new SceneContractRegistry(atomicContracts)
  const definitions = []
  for (const path of nativeFiles) {
    const source = await readFile(path, 'utf8')
    const parsed = parseSceneModule(source, { file: path, moduleId: path, registry: base })
    if (parsed.diagnostics.some((item) => item.severity === 'error' && item.code !== 'SCENE_RESOLVE_FUNCTION')) {
      throw new Error(`native Scene Definition parse failed: ${path}: ${parsed.diagnostics.map((item) => item.message).join('; ')}`)
    }
    definitions.push(...parsed.module.definitions)
  }
  const contracts = new Map<string, NodeFunctionContract>()
  const failures = new Map<string, string>()
  while (definitions.length) {
    let progressed = false
    for (let index = definitions.length - 1; index >= 0; index -= 1) {
      const definition = definitions[index]
      const registry = {
        get: (name: string) => contracts.get(name) ?? base.get(name),
        list: () => [...base.list(), ...contracts.values()],
      }
      const result = compileSceneGroupDefinition(definition, registry)
      failures.set(definition.exportName, result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; '))
      if (!result.contract && result.diagnostics.some((item) => item.code === 'SCENE_DEFINE_CONTRACT') && definitions.length > 1) continue
      if (!result.contract) throw new Error(`native Scene Definition compile failed: ${definition.exportName}: ${result.diagnostics.map((item) => item.message).join('; ')}`)
      if (contracts.has(result.contract.functionName)) throw new Error(`duplicate native Scene Definition: ${result.contract.functionName}`)
      contracts.set(result.contract.functionName, result.contract)
      definitions.splice(index, 1)
      progressed = true
    }
    if (!progressed) {
      throw new Error(`unresolved native Scene Definition dependencies: ${definitions
        .map((item) => `${item.exportName} [${failures.get(item.exportName) ?? 'unknown'}]`)
        .join(', ')}`)
    }
  }
  return [...contracts.values()]
}

let registryPromise: Promise<SceneContractRegistry> | undefined

/** World Pack Scene Script contracts. Geometry / image stubs must not share this promise. */
export function getSceneContractRegistry(): Promise<SceneContractRegistry> {
  registryPromise ??= loadAtomicContracts(resolveBatteryScanRoots(appRoot)).then(async (atomicContracts) => {
    const native = await loadNativeDefinitionContracts(atomicContracts)
    const matrix = new AcceptanceCoverageMatrix(await loadAcceptanceCoverage())
    const contracts = [...atomicContracts, ...native].map((contract) => ({
      ...contract,
      sceneScriptStatus: matrix.record(contract, contract.functionName).status,
    }))
    return new SceneContractRegistry(contracts)
  })
  return registryPromise
}

export async function getProjectSceneContractRegistry(projectDir: string): Promise<SceneContractRegistry> {
  const base = await getSceneContractRegistry()
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim()) return base
  const project = await compileStoredSceneProject(projectDir, {
    entryFile: stored.file,
    entrySource: stored.source,
    projectId: projectDir,
    registry: base,
  })
  // The returned overlay is reconstructed from the .scene.ts import closure on
  // every reopen. authoring.json.localContracts is intentionally ignored.
  return new SceneContractRegistry(project.registry.list())
}
