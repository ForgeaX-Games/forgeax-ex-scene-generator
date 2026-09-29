import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, posix, resolve, sep } from 'node:path'

import {
  stableArtifactStringify,
  stableEntityId,
  stableHash,
  verifySceneArtifact,
  type ResultLineage,
  type SceneArtifactBundle,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'

export interface AuthoringState {
  schemaVersion: 1 | 2
  /** @deprecated Mirror of source-only `projectRevision`. */
  sourceRevision: string
  /** Source-only project hash. Layout must not enter this value. */
  projectRevision?: string
  /** Canonical compile entry. Prefer `main.scene.ts`; never infer from sorted `modules[0]`. */
  entryFile?: string
  moduleRevisions?: Record<string, { moduleId: string; revision: string }>
  /** Cache of the last compiled projection hash. Not an open/commit gate. */
  compiledGraphHash?: string
  updatedAt: string
  modules: string[]
  /** Compile cache for lineage / old-layout migration. Writes use the live compile map. */
  sourceMap: SourceMapEntry[]
  /** Last successful execution index. Cache, not authoring truth. */
  resultLineage?: ResultLineage[]
  /** Legacy inline layout. Read-only migration source; never write this back. */
  layout?: Record<string, { x: number; y: number }>
  /** Import-closure cache. Rebuild with `moduleClosure()`; not an OCC input. */
  dependencyGraph?: Record<string, {
    dependencies: string[]
    dependents: string[]
    publicSignatureHash: string
    semanticHash: string
  }>
}

export type AuthoringLayout = Record<string, { x: number; y: number }>

export interface StoredSceneModule {
  file: string
  source: string
  revision: string
  exists: boolean
  state: AuthoringState | null
  /** Live source-only project hash. Independent of authoring.json. */
  projectRevision: string
}

export type SceneProjectFileKind = 'module' | 'generator' | 'helper' | 'material' | 'state' | 'layout'

export interface SceneProjectFileInfo {
  path: string
  kind: SceneProjectFileKind
  bytes: number
  updatedAt: string
}

export function sourceFileKind(path: string): SceneProjectFileKind | undefined {
  if (path.endsWith('.generator-lib.ts')) return 'helper'
  if (path.endsWith('.generator.ts')) return 'generator'
  if (path.endsWith('.material.ts')) return 'material'
  if (path.endsWith('.scene.ts')) return 'module'
  if (path.endsWith('.ts')) return 'helper'
  return undefined
}

export function isAllowedSceneSourcePath(raw: string): boolean {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.split('/').includes('..')) return false
  return sourceFileKind(normalized) !== undefined
}

function safeModulePath(raw: string | undefined): string {
  const normalized = (raw ?? 'main.scene.ts').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!isAllowedSceneSourcePath(normalized)) {
    throw new Error(`invalid Scene Script module path: ${raw ?? ''}`)
  }
  return normalized
}

/** Resolve the compile entry. Sorted module closures put generators first. */
export function resolveCanonicalEntryFile(
  modules: readonly string[] | undefined,
  persisted?: string | null,
  requestedFile?: unknown,
): string {
  const files = Array.isArray(modules) ? modules : []
  const requested = typeof requestedFile === 'string'
    ? requestedFile.replace(/\\/g, '/').replace(/^\/+/, '')
    : ''
  if (typeof persisted === 'string' && persisted.trim()) {
    const entry = persisted.replace(/\\/g, '/').replace(/^\/+/, '')
    if (entry.endsWith('.scene.ts')) return entry
  }
  if (files.includes('main.scene.ts') || requested === 'main.scene.ts') return 'main.scene.ts'
  const sceneModules = files.filter((file) => file.endsWith('.scene.ts') && !file.startsWith('generators/'))
  if (requested.endsWith('.scene.ts') && !requested.startsWith('generators/')) return requested
  return sceneModules[0] ?? (requested || 'main.scene.ts')
}

export function sceneRoot(projectDir: string): string {
  return resolve(projectDir, 'scene')
}

function stateFile(projectDir: string): string {
  return resolve(projectDir, 'state', 'authoring.json')
}

function layoutFile(projectDir: string): string {
  return resolve(projectDir, 'scene', 'scene.layout.json')
}

function artifactRoot(projectDir: string): string {
  return resolve(projectDir, 'artifacts', 'scene')
}

export function layoutKey(moduleId: string, statementId: string): string {
  return `${moduleId}::${statementId}`
}

export function layoutPositionFor(
  entry: { moduleId: string; statementId: string; entityId: string; argument?: string } | undefined,
  layout: Record<string, { x: number; y: number }>,
  nodeId: string,
): { x: number; y: number } | undefined {
  if (entry?.argument) return layout[entry.entityId] ?? layout[nodeId]
  return (entry ? layout[layoutKey(entry.moduleId, entry.statementId)] : undefined) ?? layout[nodeId]
}

type LayoutMapEntry = {
  moduleId: string
  statementId: string
  entityId: string
  runtimeNodeIds?: readonly string[]
  argument?: string
}

/** Keys `applyStoredLayout` / `layoutPositionFor` will read for this canvas node. */
export function layoutKeysForNode(
  entry: LayoutMapEntry | undefined,
  nodeId: string,
  fallbackModuleId?: string,
): string[] {
  const keys = entry?.argument
    ? [entry.entityId, nodeId]
    : entry
      ? [layoutKey(entry.moduleId, entry.statementId), nodeId]
      : fallbackModuleId
        ? [layoutKey(fallbackModuleId, nodeId), nodeId]
        : [nodeId]
  return [...new Set(keys)]
}

export function keyedLayoutPatch(
  patch: Record<string, { x: number; y: number }>,
  sourceMap: readonly LayoutMapEntry[],
  fallbackModuleId: string,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  for (const [nodeId, position] of Object.entries(patch)) {
    const entry = sourceMap.find((item) =>
      item.entityId === nodeId
      || item.statementId === nodeId
      || (item.runtimeNodeIds ?? []).includes(nodeId),
    )
    for (const key of layoutKeysForNode(entry, nodeId, fallbackModuleId)) {
      out[key] = position
    }
  }
  return out
}

function moduleFile(projectDir: string, raw: string | undefined): { relative: string; absolute: string } {
  const relative = safeModulePath(raw)
  const root = sceneRoot(projectDir)
  const absolute = resolve(root, relative)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error('Scene Script path escapes project root')
  return { relative, absolute }
}

export async function readAuthoringState(projectDir: string): Promise<AuthoringState | null> {
  try {
    return JSON.parse(await readFile(stateFile(projectDir), 'utf8')) as AuthoringState
  } catch {
    return null
  }
}

export async function readAuthoringLayout(projectDir: string): Promise<AuthoringLayout> {
  try {
    return JSON.parse(await readFile(layoutFile(projectDir), 'utf8')) as AuthoringLayout
  } catch {
    const state = await readAuthoringState(projectDir)
    if (!state?.layout) return {}
    const migrated: AuthoringLayout = {}
    for (const [key, value] of Object.entries(state.layout)) {
      const mapped = state.sourceMap.find((entry) =>
        entry.entityId === key || entry.runtimeNodeIds.includes(key))
      migrated[mapped ? layoutKey(mapped.moduleId, mapped.statementId) : key] = value
    }
    return migrated
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, path)
}

export async function writeSceneArtifactBundle(
  projectDir: string,
  bundle: SceneArtifactBundle,
): Promise<void> {
  const verification = verifySceneArtifact(bundle)
  if (!verification.valid) throw new Error(`refusing invalid Scene artifact: ${verification.diagnostics.join('; ')}`)
  const root = artifactRoot(projectDir)
  await Promise.all([
    atomicWrite(resolve(root, 'scene-model.json'), `${stableArtifactStringify(bundle.model)}\n`),
    atomicWrite(resolve(root, 'review', 'manifest.json'), `${stableArtifactStringify(bundle.reviewManifest)}\n`),
    ...Object.entries(bundle.sources).map(([file, source]) =>
      atomicWrite(resolve(root, 'sources', safeModulePath(file)), source)),
    ...(bundle.runtimeSnapshot === undefined
      ? []
      : [atomicWrite(resolve(root, 'runtime', 'snapshot.json'), `${stableArtifactStringify(bundle.runtimeSnapshot)}\n`)]),
    ...(bundle.preview === undefined
      ? []
      : [atomicWrite(resolve(root, 'preview', 'preview.json'), `${stableArtifactStringify(bundle.preview)}\n`)]),
  ])
}

export async function readSceneArtifactBundle(projectDir: string): Promise<SceneArtifactBundle | null> {
  const root = artifactRoot(projectDir)
  try {
    const model = JSON.parse(await readFile(resolve(root, 'scene-model.json'), 'utf8')) as SceneArtifactBundle['model']
    const reviewManifest = JSON.parse(
      await readFile(resolve(root, 'review', 'manifest.json'), 'utf8'),
    ) as SceneArtifactBundle['reviewManifest']
    const sources = Object.fromEntries(await Promise.all(model.modules.map(async (module) => [
      module.file,
      await readFile(resolve(root, 'sources', safeModulePath(module.file)), 'utf8'),
    ])))
    const runtimeSnapshot = await readFile(resolve(root, 'runtime', 'snapshot.json'), 'utf8')
      .then((value) => JSON.parse(value) as unknown)
      .catch(() => undefined)
    const preview = await readFile(resolve(root, 'preview', 'preview.json'), 'utf8')
      .then((value) => JSON.parse(value) as unknown)
      .catch(() => undefined)
    return {
      model,
      sources,
      ...(runtimeSnapshot !== undefined ? { runtimeSnapshot } : {}),
      ...(preview !== undefined ? { preview } : {}),
      reviewManifest,
    }
  } catch {
    return null
  }
}

/** Enumerate the static relative-import closure persisted with an authoring revision. */
async function moduleClosure(projectDir: string, entry: string): Promise<string[]> {
  const visited = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return
    visited.add(file)
    const source = await readFile(moduleFile(projectDir, file).absolute, 'utf8').catch(() => '')
    const imports = source.matchAll(/from\s+["'](\.[^"']+\.(?:scene|generator|generator-lib|material)\.ts)["']/g)
    for (const match of imports) {
      const relative = posix.normalize(posix.join(posix.dirname(file), match[1]))
      if (relative.split('/').includes('..')) continue
      await visit(relative)
    }
  }
  await visit(entry)
  return [...visited].sort()
}

async function revisionState(
  projectDir: string,
  modules: readonly string[],
): Promise<{ projectRevision: string; moduleRevisions: Record<string, { moduleId: string; revision: string }> }> {
  const moduleRevisions: Record<string, { moduleId: string; revision: string }> = {}
  for (const file of [...modules].sort()) {
    const source = await readFile(moduleFile(projectDir, file).absolute, 'utf8').catch(() => '')
    const moduleId = source.match(/^\s*\/\/\s*@scene-module-id\s+([^\s]+)/m)?.[1] ?? file
    moduleRevisions[file] = { moduleId, revision: stableHash(source) }
  }
  const projectRevision = stableHash(
    Object.entries(moduleRevisions)
      .map(([file, item]) => `${file}\0${item.moduleId}\0${item.revision}`)
      .join('\n'),
  )
  return { projectRevision, moduleRevisions }
}

/** OCC and Agent revision: hash of every Scene source file. Layout is not included. */
export async function computeSourceProjectRevision(projectDir: string): Promise<string> {
  const files = await allSceneFiles(projectDir)
  const moduleSources = Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    stableHash(await readFile(moduleFile(projectDir, file).absolute, 'utf8')),
  ])))
  return stableHash(JSON.stringify({ moduleSources }))
}

export async function readSceneProjectRevision(
  projectDir: string,
  entry = 'main.scene.ts',
): Promise<{ projectRevision: string; moduleRevisions: Record<string, { moduleId: string; revision: string }> }> {
  const revisions = await revisionState(projectDir, await moduleClosure(projectDir, safeModulePath(entry)))
  return {
    ...revisions,
    projectRevision: await computeSourceProjectRevision(projectDir),
  }
}

export async function readSceneModule(projectDir: string, raw?: string): Promise<StoredSceneModule> {
  const file = moduleFile(projectDir, raw)
  let exists = true
  const source = await readFile(file.absolute, 'utf8').catch(() => {
    exists = false
    return ''
  })
  const projectRevision = await computeSourceProjectRevision(projectDir)
  const state = await readAuthoringState(projectDir)
  return {
    file: file.relative,
    source,
    revision: stableHash(source),
    exists,
    state: state
      ? { ...state, projectRevision, sourceRevision: projectRevision }
      : null,
    projectRevision,
  }
}

export function canonicalEmptySceneSource(projectId: string): string {
  return `// @scene-module-id ${stableEntityId('module', projectId)}\n`
}

/**
 * Empty Scene Projects start as a canonical `.scene.ts`, not a Runtime Graph.
 * Seed the module so the first BasePlane drop compiles into the in-memory graph.
 */
export async function ensureCanonicalSceneProject(
  projectDir: string,
  projectId: string,
): Promise<StoredSceneModule> {
  const stored = await readSceneModule(projectDir)
  if (stored.source.trim()) return stored
  return writeSceneModule(
    projectDir,
    stored.exists ? stored.file : 'main.scene.ts',
    canonicalEmptySceneSource(projectId),
    stored.state?.sourceMap ?? [],
  )
}

export async function writeSceneModule(
  projectDir: string,
  raw: string | undefined,
  source: string,
  sourceMap: SourceMapEntry[],
  compiledGraphHash?: string,
  layout?: Record<string, { x: number; y: number }>,
): Promise<StoredSceneModule> {
  const file = moduleFile(projectDir, raw)
  const previous = await readAuthoringState(projectDir)
  const revision = stableHash(source)
  await atomicWrite(file.absolute, source)
  const modules = await moduleClosure(projectDir, file.relative)
  const revisions = await revisionState(projectDir, modules)
  const nextLayout = layout ?? await readAuthoringLayout(projectDir)
  const projectRevision = await computeSourceProjectRevision(projectDir)
  const entryFile = resolveCanonicalEntryFile(modules, previous?.entryFile, file.relative)
  const state: AuthoringState = {
    schemaVersion: 2,
    sourceRevision: projectRevision,
    projectRevision,
    entryFile,
    moduleRevisions: revisions.moduleRevisions,
    ...(compiledGraphHash ? { compiledGraphHash } : {}),
    updatedAt: new Date().toISOString(),
    modules,
    sourceMap,
  }
  if (Object.keys(nextLayout).length) {
    await atomicWrite(layoutFile(projectDir), `${JSON.stringify(nextLayout, null, 2)}\n`)
  }
  await atomicWrite(stateFile(projectDir), `${JSON.stringify(state, null, 2)}\n`)
  return { file: file.relative, source, revision, exists: true, state, projectRevision }
}

export interface SceneModuleWrite {
  file: string
  source: string
}

/** Commit source modules and authoring metadata as one rollback-safe filesystem transaction. */
export async function writeSceneProjectTransaction(
  projectDir: string,
  entryFile: string,
  writes: readonly SceneModuleWrite[],
  sourceMap: SourceMapEntry[],
  compiledGraphHash?: string,
  dependencyGraph?: AuthoringState['dependencyGraph'],
  layout?: AuthoringLayout,
  deleteFiles: readonly string[] = [],
): Promise<AuthoringState> {
  const unique = new Map(writes.map((write) => [safeModulePath(write.file), write.source]))
  const backups = new Map<string, string | null>()
  const deletedBackups = new Map<string, string>()
  const previousState = await readFile(stateFile(projectDir), 'utf8').catch(() => null)
  const previousLayout = await readFile(layoutFile(projectDir), 'utf8').catch(() => null)
  try {
    for (const [file, source] of unique) {
      const target = moduleFile(projectDir, file)
      backups.set(file, await readFile(target.absolute, 'utf8').catch(() => null))
      await atomicWrite(target.absolute, source)
    }
    for (const raw of deleteFiles) {
      const file = safeModulePath(raw)
      if (unique.has(file)) continue
      const target = moduleFile(projectDir, file)
      const previous = await readFile(target.absolute, 'utf8').catch(() => null)
      if (previous === null) continue
      deletedBackups.set(file, previous)
      await rm(target.absolute, { force: true })
    }
    const modules = await moduleClosure(projectDir, safeModulePath(entryFile))
    const revisions = await revisionState(projectDir, modules)
    const projectRevision = await computeSourceProjectRevision(projectDir)
    const state: AuthoringState = {
      schemaVersion: 2,
      sourceRevision: projectRevision,
      projectRevision,
      entryFile: safeModulePath(entryFile),
      moduleRevisions: revisions.moduleRevisions,
      ...(compiledGraphHash ? { compiledGraphHash } : {}),
      updatedAt: new Date().toISOString(),
      modules,
      sourceMap,
      ...(dependencyGraph ? { dependencyGraph } : {}),
    }
    if (layout) {
      await atomicWrite(layoutFile(projectDir), `${JSON.stringify(layout, null, 2)}\n`)
    }
    await atomicWrite(stateFile(projectDir), `${JSON.stringify(state, null, 2)}\n`)
    return state
  } catch (error) {
    for (const [file, source] of [...backups].reverse()) {
      const target = moduleFile(projectDir, file).absolute
      try {
        if (source === null) await rm(target, { force: true })
        else await atomicWrite(target, source)
      } catch {
        // Continue restoring the remaining modules; preserve the original failure.
      }
    }
    for (const [file, source] of deletedBackups) {
      try {
        await atomicWrite(moduleFile(projectDir, file).absolute, source)
      } catch {
        // Continue restoring the remaining modules; preserve the original failure.
      }
    }
    try {
      if (previousLayout === null) await rm(layoutFile(projectDir), { force: true })
      else await atomicWrite(layoutFile(projectDir), previousLayout)
      if (previousState === null) await rm(stateFile(projectDir), { force: true })
      else await atomicWrite(stateFile(projectDir), previousState)
    } catch {
      // Source restoration remains best-effort; preserve the original failure.
    }
    throw error
  }
}

export async function writeAuthoringLayout(
  projectDir: string,
  layout: Record<string, { x: number; y: number }>,
  compiledGraphHash?: string,
): Promise<AuthoringState | null> {
  const currentLayout = await readAuthoringLayout(projectDir)
  const mergedLayout = { ...currentLayout, ...layout }
  await atomicWrite(layoutFile(projectDir), `${JSON.stringify(mergedLayout, null, 2)}\n`)
  const current = await readAuthoringState(projectDir)
  if (!current) return null
  const { layout: _legacyLayout, ...withoutLegacyLayout } = current
  const state: AuthoringState = {
    ...withoutLegacyLayout,
    ...(compiledGraphHash ? { compiledGraphHash } : {}),
    updatedAt: new Date().toISOString(),
  }
  await atomicWrite(stateFile(projectDir), `${JSON.stringify(state, null, 2)}\n`)
  return state
}

export async function writeResultLineage(
  projectDir: string,
  resultLineage: readonly ResultLineage[],
): Promise<AuthoringState | null> {
  const current = await readAuthoringState(projectDir)
  if (!current) return null
  const state: AuthoringState = {
    ...current,
    updatedAt: new Date().toISOString(),
    resultLineage: [...resultLineage],
  }
  await atomicWrite(stateFile(projectDir), `${JSON.stringify(state, null, 2)}\n`)
  return state
}

export async function allSceneFiles(projectDir: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (dir: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(resolve(dir, entry.name), relative)
      else if (entry.isFile() && sourceFileKind(entry.name) !== undefined) files.push(relative)
    }
  }
  await visit(sceneRoot(projectDir))
  return files.sort()
}

export class SceneModuleInUseError extends Error {
  readonly code = 'SCENE_MODULE_IN_USE'
  constructor(
    readonly file: string,
    readonly importers: Array<{ file: string; specifier: string }>,
  ) {
    super(`Cannot delete '${file}'; it is imported by ${importers.map((item) => item.file).join(', ')}.`)
  }
}

export async function createSceneModuleFile(
  projectDir: string,
  raw: string,
  source?: string,
): Promise<StoredSceneModule> {
  const file = moduleFile(projectDir, raw)
  if (await stat(file.absolute).catch(() => null)) throw new Error(`Scene Script module already exists: ${file.relative}`)
  const moduleId = `scene.module.${stableHash(`${Date.now()}:${file.relative}`).slice(0, 12)}`
  await atomicWrite(file.absolute, source ?? `// @scene-module-id ${moduleId}\n`)
  return readSceneModule(projectDir, file.relative)
}

export async function moveSceneModuleFile(
  projectDir: string,
  fromRaw: string,
  toRaw: string,
): Promise<StoredSceneModule> {
  const from = moduleFile(projectDir, fromRaw)
  const to = moduleFile(projectDir, toRaw)
  if (!await stat(from.absolute).catch(() => null)) throw new Error(`Scene Script module not found: ${from.relative}`)
  if (await stat(to.absolute).catch(() => null)) throw new Error(`Scene Script module already exists: ${to.relative}`)
  const edits: SceneModuleWrite[] = []
  for (const file of await allSceneFiles(projectDir)) {
    if (file === from.relative) continue
    const source = await readFile(moduleFile(projectDir, file).absolute, 'utf8')
    const rewritten = source.replace(/(from\s+["'])(\.[^"']+\.(?:scene|generator|generator-lib|material)\.ts)(["'])/g, (full, prefix, specifier, suffix) => {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier))
      if (target !== from.relative) return full
      let next = posix.relative(posix.dirname(file), to.relative)
      if (!next.startsWith('.')) next = `./${next}`
      return `${prefix}${next}${suffix}`
    })
    if (rewritten !== source) edits.push({ file, source: rewritten })
  }
  const source = await readFile(from.absolute, 'utf8')
  await mkdir(dirname(to.absolute), { recursive: true })
  await rename(from.absolute, to.absolute)
  try {
    for (const edit of edits) await atomicWrite(moduleFile(projectDir, edit.file).absolute, edit.source)
  } catch (error) {
    await rename(to.absolute, from.absolute)
    throw error
  }
  return readSceneModule(projectDir, to.relative)
}

export async function deleteSceneModuleFile(projectDir: string, raw: string): Promise<void> {
  const target = moduleFile(projectDir, raw)
  const importers: Array<{ file: string; specifier: string }> = []
  for (const file of await allSceneFiles(projectDir)) {
    if (file === target.relative) continue
    const source = await readFile(moduleFile(projectDir, file).absolute, 'utf8')
    for (const match of source.matchAll(/from\s+["'](\.[^"']+\.(?:scene|generator|generator-lib|material)\.ts)["']/g)) {
      if (posix.normalize(posix.join(posix.dirname(file), match[1])) === target.relative) {
        importers.push({ file, specifier: match[1] })
      }
    }
  }
  if (importers.length) throw new SceneModuleInUseError(target.relative, importers)
  await rm(target.absolute, { force: true })
}

/** A bounded, project-local file projection for UI inspection. */
export async function listSceneProjectFiles(projectDir: string): Promise<SceneProjectFileInfo[]> {
  const root = sceneRoot(projectDir)
  const result: SceneProjectFileInfo[] = []
  async function visit(dir: string, prefix = ''): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relative)
      } else if (entry.isFile()) {
        const kind = sourceFileKind(entry.name)
        if (!kind) continue
        const details = await stat(absolute)
        result.push({
          path: relative,
          kind,
          bytes: details.size,
          updatedAt: details.mtime.toISOString(),
        })
      }
    }
  }
  await visit(root)
  const authoring = await stat(stateFile(projectDir)).catch(() => null)
  if (authoring) {
    result.push({
      path: '../state/authoring.json',
      kind: 'state',
      bytes: authoring.size,
      updatedAt: authoring.mtime.toISOString(),
    })
  }
  const layout = await stat(layoutFile(projectDir)).catch(() => null)
  if (layout) {
    result.push({
      path: 'scene.layout.json',
      kind: 'layout',
      bytes: layout.size,
      updatedAt: layout.mtime.toISOString(),
    })
  }
  return result
}
