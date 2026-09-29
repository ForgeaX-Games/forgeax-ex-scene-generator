import { dirname, join, relative } from 'node:path'
import type { SceneDiagnostic, ScenePackParameter } from '@forgeax/scene-authoring'
import { getActiveProjectDir, getProjectDir, getProjectRegistry, resolveActiveGameSlug, resolveSharedGamesRoot } from '../runtime.js'
import { sceneRoot } from '../scene-script/persist/store.js'
import { derivePackageUuid, safeSlug } from './identity.js'
import { exportSceneModulePack } from './moduleExport.js'
import { resolvePackSchemaVersion, type PackSchemaVersion } from './inputs.js'

export interface PackExportOptions {
  /** Native consumer protocol; omitted targets the current v2 SDK. */
  schemaVersion?: PackSchemaVersion
  projectId?: string
  gameSlug?: string
  includeDefaultLighting?: boolean
  consumerBuildBudgetMs?: number
  entryFile?: string
  exportName?: string
  args?: readonly unknown[]
  destination?: string
  packageId?: string
  sourceKey?: string
  parameters?: readonly ScenePackParameter[]
  parameterBindings?: Readonly<Record<string, { argument: number; path: readonly string[] }>>
}

export interface PackExportResult {
  schemaVersion: PackSchemaVersion
  ok: boolean
  projectId: string
  projectName: string
  gameSlug: string
  /** Absolute directory the pack was written to. */
  path: string
  /** Path relative to the game root, for display. */
  relPath: string
  packFile: string
  /** Scene content GUID for an Engine scene-loading plugin's asset configuration. */
  sceneGuid: string
  packageId: string
  sceneKey: string
  entityCount: number
  meshCount: number
  vertexCount: number
  triangleCount: number
  /** Meshes whose uvs were projected here because the scene carried none. */
  uvsGeneratedCount: number
  /** Distinct `material/*` assets, deduped scene-wide. */
  materialCount: number
  /** Total draw ranges across every mesh; > materialCount when rules varied. */
  submeshCount: number
  fileCount: number
  bytes: number
  /** In-app scene run, milliseconds. */
  runMs: number
  /** Standalone generation and projection timing, excluding native asset assembly. */
  verifyMs: number
  diagnostics: SceneDiagnostic[]
  message: string
}

async function resolveTargetProject(projectId?: string): Promise<{
  projectId: string
  projectDir: string
  gameSlug: string | undefined
  projectName: string
}> {
  const registry = await getProjectRegistry()
  const trimmed = projectId?.trim()
  if (trimmed) {
    const record = registry.getProject(trimmed)
    if (!record) throw new Error(`Project not found: ${trimmed}`)
    const projectDir = await getProjectDir(trimmed)
    if (!projectDir) throw new Error(`Project directory not found: ${trimmed}`)
    return { projectId: trimmed, projectDir, gameSlug: record.manifest.gameSlug, projectName: record.manifest.name }
  }
  const viewingId = registry.getViewingProjectId()
  if (!viewingId) throw new Error('No projectId provided and no viewing project is currently open.')
  const record = registry.getProject(viewingId)
  if (!record) throw new Error(`Viewing project not found: ${viewingId}`)
  return {
    projectId: viewingId,
    projectDir: await getActiveProjectDir(),
    gameSlug: record.manifest.gameSlug,
    projectName: record.manifest.name,
  }
}

export async function exportProjectPack(options: PackExportOptions): Promise<PackExportResult> {
  const schemaVersion = resolvePackSchemaVersion(options.schemaVersion)
  const target = await resolveTargetProject(options.projectId)
  const gameSlug = (options.gameSlug?.trim() || target.gameSlug || resolveActiveGameSlug() || '').trim()
  if (!gameSlug && !options.destination) throw new Error('Provide destination to export independently of a game.')
  const entryFile = options.entryFile ?? 'main.scene.ts'
  const slug = safeSlug(options.entryFile ? `${entryFile.replace(/\.scene\.ts$/, '')}-${options.exportName ?? 'default'}` : target.projectName, 'scene')
  const gameRoot = options.destination ? dirname(options.destination) : join(resolveSharedGamesRoot(), gameSlug)
  const result = await exportSceneModulePack({
    ...options, schemaVersion, sourceDir: sceneRoot(target.projectDir), entryFile,
    projectId: target.projectId, projectName: target.projectName,
    includeDefaultLighting: options.includeDefaultLighting ?? !options.entryFile,
    destination: options.destination ?? join(gameRoot, 'assets', 'scene-generator', slug),
    packageId: options.packageId ?? derivePackageUuid(`${target.projectId}:${entryFile}:${options.exportName ?? 'script'}`),
  })
  return {...result, gameSlug, relPath:relative(gameRoot,result.path).replaceAll('\\','/')}
}
