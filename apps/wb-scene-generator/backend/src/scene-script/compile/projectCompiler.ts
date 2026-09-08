import { posix } from 'node:path'

import {
  compileSceneProject,
  compileSceneGroupDefinition,
  createSceneDiagnostic,
  parseSceneModule,
  stableHash,
  type CompiledSceneModule,
  type ContractRegistry,
  type NodeFunctionContract,
  type ParseSceneModuleResult,
  type SceneDiagnostic,
  type SceneGroupDefinition,
  type SceneIncrementalCompileInfo,
  type SceneModuleAst,
} from '@forgeax/scene-authoring'

import { readSceneModule } from '../persist/store.js'
import { collectGeneratorImports, compileProjectGenerators } from './generatorCompiler.js'
import { getProjectOpOverlay } from '../../runtime.js'

interface ProjectCompilerCache {
  parsedByFile: Map<string, { revision: string; result: ParseSceneModuleResult }>
  semanticHashes: Record<string, string>
}

interface LoadedSceneGraph {
  modules: Record<string, SceneModuleAst>
  diagnostics: SceneDiagnostic[]
  fileToModuleId: Map<string, string>
  sourceByFile: Map<string, string>
  generatorFiles: Set<string>
  reparsedModuleIds: string[]
}

const compilerCaches = new Map<string, ProjectCompilerCache>()

export function resolveSceneImport(fromModuleId: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  return posix.normalize(posix.join(posix.dirname(fromModuleId), specifier))
}

function projectCache(projectDir: string): ProjectCompilerCache {
  const cache = compilerCaches.get(projectDir) ?? {
    parsedByFile: new Map(),
    semanticHashes: {},
  }
  compilerCaches.set(projectDir, cache)
  return cache
}

/** Load `.scene.ts` / `.material.ts`. `.generator.ts` imports are collected, not parsed as scene modules. */
async function loadStoredSceneGraph(
  projectDir: string,
  options: {
    entryFile: string
    entrySource: string
    sourceOverrides?: Record<string, string>
    registry: ContractRegistry
  },
  cache: ProjectCompilerCache,
): Promise<LoadedSceneGraph> {
  const modules: Record<string, SceneModuleAst> = {}
  const diagnostics: SceneDiagnostic[] = []
  const visitingFiles = new Set<string>()
  const loadedFiles = new Set<string>()
  const fileToModuleId = new Map<string, string>()
  const sourceByFile = new Map<string, string>()
  const reparsedModuleIds: string[] = []
  const generatorFiles = new Set<string>()

  const visit = async (file: string, sourceOverride?: string): Promise<void> => {
    if (loadedFiles.has(file) || visitingFiles.has(file)) return
    if (file.endsWith('.generator.ts')) {
      generatorFiles.add(file)
      visitingFiles.delete(file)
      return
    }
    visitingFiles.add(file)
    const override = sourceOverride ?? options.sourceOverrides?.[file]
    const stored = override === undefined ? await readSceneModule(projectDir, file) : undefined
    if (stored && !stored.exists) {
      visitingFiles.delete(file)
      return
    }
    const source = override ?? stored?.source ?? ''
    sourceByFile.set(file, source)
    const revision = stableHash(source)
    const cached = cache.parsedByFile.get(file)
    const parsed = cached?.revision === revision
      ? cached.result
      : parseSceneModule(source, { file, registry: options.registry })
    if (!cached || cached.revision !== revision) {
      cache.parsedByFile.set(file, { revision, result: parsed })
      reparsedModuleIds.push(parsed.module.moduleId)
    }
    const existing = modules[parsed.module.moduleId]
    if (existing && existing.file !== file) {
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_MODULE_ID',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module id '${parsed.module.moduleId}' is declared by both '${existing.file}' and '${file}'.`,
        source: parsed.module.statements[0]?.source ?? parsed.module.definitions[0]?.source,
        expected: 'A unique stable @scene-module-id per module.',
        actual: parsed.module.moduleId,
      }))
      visitingFiles.delete(file)
      return
    }
    modules[parsed.module.moduleId] = parsed.module
    fileToModuleId.set(file, parsed.module.moduleId)
    loadedFiles.add(file)
    diagnostics.push(...parsed.diagnostics)
    for (const item of collectGeneratorImports(file, parsed.module.imports)) generatorFiles.add(item)
    for (const item of parsed.module.imports) {
      if (!item.from.startsWith('.')) continue
      const dependency = resolveSceneImport(file, item.from)
      if (dependency.endsWith('.generator.ts')) continue
      if (dependency.endsWith('.material.ts') || dependency.endsWith('.scene.ts')) {
        await visit(dependency)
        continue
      }
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_IMPORT_EXTENSION',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module import '${item.from}' must resolve to a .scene.ts, .material.ts or .generator.ts file.`,
        source: item.source,
        expected: '.scene.ts | .material.ts | .generator.ts',
        actual: item.from,
      }))
    }
    visitingFiles.delete(file)
  }

  await visit(options.entryFile, options.entrySource)
  return { modules, diagnostics, fileToModuleId, sourceByFile, generatorFiles, reparsedModuleIds }
}

async function attachImportedGenerators(
  projectDir: string,
  projectId: string,
  generatorFiles: readonly string[],
  sourceOverrides: Record<string, string>,
): Promise<{ contracts: Map<string, NodeFunctionContract>; diagnostics: SceneDiagnostic[] }> {
  let overlay: import('@forgeax/node-runtime').OverlayOpRegistry | undefined
  try {
    overlay = getProjectOpOverlay(projectId)
  } catch {
    overlay = undefined
  }
  const compiled = await compileProjectGenerators(projectDir, generatorFiles, sourceOverrides, overlay)
  return {
    contracts: new Map(compiled.contracts.map((contract) => [contract.functionName, contract])),
    diagnostics: compiled.diagnostics,
  }
}

function aliasImportedGeneratorNames(
  modules: Record<string, SceneModuleAst>,
  generatorContracts: Map<string, NodeFunctionContract>,
): void {
  for (const module of Object.values(modules)) {
    for (const item of module.imports) {
      if (!item.from.endsWith('.generator.ts')) continue
      for (const specifier of item.specifiers ?? []) {
        const contract = generatorContracts.get(specifier.imported)
        if (contract && specifier.local !== specifier.imported) {
          generatorContracts.set(specifier.local, { ...contract, functionName: specifier.local })
        }
      }
    }
  }
}

function compileLocalGroupDefinitions(
  modules: Record<string, SceneModuleAst>,
  fileToModuleId: Map<string, string>,
  platform: ContractRegistry,
  generatorContracts: Map<string, NodeFunctionContract>,
): { registry: ContractRegistry; diagnostics: SceneDiagnostic[] } {
  const diagnostics: SceneDiagnostic[] = []
  const localContracts = new Map<string, NodeFunctionContract>()
  const registry: ContractRegistry = {
    get(functionName) {
      return localContracts.get(functionName)
        ?? generatorContracts.get(functionName)
        ?? platform.get(functionName)
    },
    list() {
      return [...platform.list(), ...generatorContracts.values(), ...localContracts.values()]
    },
  }
  const resolveModuleImport = (fromModuleId: string, specifier: string): string => {
    const from = modules[fromModuleId]?.file ?? fromModuleId
    return fileToModuleId.get(resolveSceneImport(from, specifier)) ?? resolveSceneImport(from, specifier)
  }
  const definitionForExport = (
    moduleId: string,
    exportedName: string,
    resolving = new Set<string>(),
  ): { moduleId: string; definition: SceneGroupDefinition } | undefined => {
    const key = `${moduleId}::${exportedName}`
    if (resolving.has(key)) return undefined
    const module = modules[moduleId]
    const exported = module?.exports.find((item) => item.exported === exportedName)
    if (!module || !exported) return undefined
    const definition = module.definitions.find((item) => item.exportName === exported.local)
    if (definition) return { moduleId, definition }
    for (const item of module.imports) {
      const specifier = (item.specifiers ?? []).find((candidate) => candidate.local === exported.local)
      if (!specifier) continue
      return definitionForExport(
        resolveModuleImport(moduleId, item.from),
        specifier.imported,
        new Set(resolving).add(key),
      )
    }
    return undefined
  }
  const scopedRegistry = (module: SceneModuleAst): ContractRegistry => ({
    get(functionName) {
      const local = module.definitions.find((item) => item.exportName === functionName)
      if (local) return localContracts.get(`${module.moduleId}::${functionName}`)
      for (const item of module.imports) {
        const specifier = (item.specifiers ?? []).find((candidate) => candidate.local === functionName)
        if (!specifier) continue
        if (item.from.endsWith('.generator.ts')) return generatorContracts.get(specifier.imported)
        const target = definitionForExport(resolveModuleImport(module.moduleId, item.from), specifier.imported)
        if (target) return localContracts.get(`${target.moduleId}::${target.definition.exportName}`)
      }
      return registry.get(functionName)
    },
    list: () => registry.list(),
  })
  const pending = Object.values(modules).flatMap((module) =>
    module.definitions.map((definition) => ({ module, definition })),
  )
  while (pending.length) {
    let progressed = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const { module, definition } = pending[index]
      const result = compileSceneGroupDefinition(definition, scopedRegistry(module))
      const unresolved = result.diagnostics.some((item) => item.code === 'SCENE_DEFINE_CONTRACT')
      if (unresolved && pending.length > 1) continue
      for (const item of result.diagnostics) {
        diagnostics.push(createSceneDiagnostic({
          code: item.code,
          phase: 'compile',
          severity: 'error',
          message: item.message,
          source: definition.source,
        }))
      }
      pending.splice(index, 1)
      progressed = true
      if (!result.contract) continue
      const existingPlatform = platform.get(result.contract.functionName)
      if (existingPlatform) {
        diagnostics.push(createSceneDiagnostic({
          code: 'SCENE_DEFINE_CONFLICT',
          phase: 'resolve',
          severity: 'error',
          message: `Project definition '${result.contract.functionName}' conflicts with sealed platform Definition '${existingPlatform.definitionId ?? 'unknown'}'. Rename the project Definition; platform Definitions cannot be shadowed.`,
          source: definition.source,
          expected: 'A unique project Definition name that does not shadow sealed platform capabilities.',
          actual: result.contract.functionName,
        }))
        continue
      }
      localContracts.set(`${module.moduleId}::${result.contract.functionName}`, result.contract)
    }
    if (!progressed) break
  }
  return { registry, diagnostics }
}

function incrementalCompileInfo(
  modules: Record<string, SceneModuleAst>,
  fileToModuleId: Map<string, string>,
  sourceByFile: Map<string, string>,
  reparsedModuleIds: string[],
  cache: ProjectCompilerCache,
): SceneIncrementalCompileInfo {
  const resolveModuleImport = (fromModuleId: string, specifier: string): string => {
    const from = modules[fromModuleId]?.file ?? fromModuleId
    const targetFile = resolveSceneImport(from, specifier)
    return fileToModuleId.get(targetFile) ?? targetFile
  }
  const dependenciesByModule: Record<string, string[]> = {}
  const dependentsByModule: Record<string, string[]> = {}
  for (const module of Object.values(modules)) {
    dependenciesByModule[module.moduleId] = module.imports
      .filter((item) => item.from.startsWith('.'))
      .map((item) => resolveModuleImport(module.moduleId, item.from))
      .filter((id) => Boolean(modules[id]))
    dependentsByModule[module.moduleId] ??= []
  }
  for (const [moduleId, dependencies] of Object.entries(dependenciesByModule)) {
    for (const dependency of dependencies) (dependentsByModule[dependency] ??= []).push(moduleId)
  }
  const semanticHashes = Object.fromEntries(Object.values(modules).map((module) => [
    module.moduleId,
    stableHash(sourceByFile.get(module.file) ?? ''),
  ]))
  const changed = new Set(Object.keys(semanticHashes).filter(
    (moduleId) => cache.semanticHashes[moduleId] !== semanticHashes[moduleId],
  ))
  const invalidated = new Set(changed)
  const queue = [...changed]
  while (queue.length) {
    const moduleId = queue.shift()!
    for (const dependent of dependentsByModule[moduleId] ?? []) {
      if (!invalidated.has(dependent)) {
        invalidated.add(dependent)
        queue.push(dependent)
      }
    }
  }
  const incrementalModules = Object.fromEntries(Object.values(modules).map((module) => {
    const publicShape = {
      exports: module.exports.map(({ local, exported }) => ({ local, exported })),
      definitions: module.definitions.map((definition) => ({
        exportName: definition.exportName,
        definitionId: definition.definitionId,
        version: definition.meta.version,
        inputs: definition.meta.inputs,
        outputs: definition.meta.outputs,
      })),
    }
    return [module.moduleId, {
      moduleId: module.moduleId,
      file: module.file,
      dependencies: dependenciesByModule[module.moduleId] ?? [],
      dependents: dependentsByModule[module.moduleId] ?? [],
      publicSignatureHash: stableHash(JSON.stringify(publicShape)),
      semanticHash: semanticHashes[module.moduleId],
    }]
  }))
  cache.semanticHashes = semanticHashes
  return {
    modules: incrementalModules,
    reparsedModuleIds,
    invalidatedModuleIds: [...invalidated].sort(),
  }
}

/**
 * Workbench door: load a stored Scene Project, attach imported Generators, lower to a Runtime Graph.
 * Language lowering stays in `@forgeax/scene-authoring`; sandbox compile stays in `@forgeax/project-generator`.
 */
export async function compileStoredSceneProject(
  projectDir: string,
  options: {
    entryFile: string
    entrySource: string
    sourceOverrides?: Record<string, string>
    projectId: string
    registry: ContractRegistry
  },
): Promise<{
  compiled: CompiledSceneModule
  diagnostics: SceneDiagnostic[]
  modules: Record<string, SceneModuleAst>
  registry: ContractRegistry
  incremental: SceneIncrementalCompileInfo
}> {
  const cache = projectCache(projectDir)
  const loaded = await loadStoredSceneGraph(projectDir, options, cache)
  const generators = await attachImportedGenerators(
    projectDir,
    options.projectId,
    [...loaded.generatorFiles],
    options.sourceOverrides ?? {},
  )
  const definitions = compileLocalGroupDefinitions(
    loaded.modules,
    loaded.fileToModuleId,
    options.registry,
    generators.contracts,
  )
  aliasImportedGeneratorNames(loaded.modules, generators.contracts)
  const compiled = compileSceneProject(
    {
      entryModuleId: loaded.fileToModuleId.get(options.entryFile) ?? options.entryFile,
      modules: loaded.modules,
    },
    definitions.registry,
    (fromModuleId, specifier) => {
      const from = loaded.modules[fromModuleId]?.file ?? fromModuleId
      const targetFile = resolveSceneImport(from, specifier)
      return loaded.fileToModuleId.get(targetFile) ?? targetFile
    },
  )
  const diagnostics = [
    ...loaded.diagnostics,
    ...generators.diagnostics,
    ...definitions.diagnostics,
  ].filter((item) => !(item.code === 'SCENE_RESOLVE_FUNCTION' && item.operation))
  return {
    compiled,
    diagnostics: [...diagnostics, ...compiled.diagnostics],
    modules: loaded.modules,
    registry: definitions.registry,
    incremental: incrementalCompileInfo(
      loaded.modules,
      loaded.fileToModuleId,
      loaded.sourceByFile,
      loaded.reparsedModuleIds,
      cache,
    ),
  }
}
