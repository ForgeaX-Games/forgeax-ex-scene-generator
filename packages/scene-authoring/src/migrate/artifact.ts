import { stableHash } from '../model/identity.js'
import type {
  ResultLineage,
  SceneDiagnostic,
  SceneModuleAst,
  SceneProjectAst,
  SourceMapEntry,
} from '../model/types.js'

export const SCENE_MODEL_ARTIFACT_VERSION = 1

export interface SceneModelArtifact {
  schemaVersion: 1
  projectId: string
  entryModuleId: string
  modules: Array<{
    moduleId: string
    file: string
    sourceHash: string
    ast: SceneModuleAst
  }>
  stableIds: {
    moduleIds: string[]
    definitionIds: string[]
    statementIds: string[]
    entityIds: string[]
  }
  imports: Array<{
    moduleId: string
    from: string
    names: Array<{ imported: string; local: string }>
  }>
  layout: Record<string, { x: number; y: number }>
  sourceMap: SourceMapEntry[]
  versions: {
    sceneScript: string
    compiler: string
    contracts: Record<string, string>
  }
  execution: {
    seed?: number | string
    captures: string[]
    resultLineage: ResultLineage[]
  }
  hashes: {
    sources: string
    semanticModel: string
    runtimeSnapshot?: string
    preview?: string
    artifact: string
  }
}

export interface SceneArtifactBundle {
  model: SceneModelArtifact
  sources: Record<string, string>
  runtimeSnapshot?: unknown
  preview?: unknown
  reviewManifest: {
    schemaVersion: 1
    projectId: string
    artifactHash: string
    files: Array<{ path: string; hash: string; role: 'source' | 'model' | 'runtime-cache' | 'preview' }>
    diagnostics: SceneDiagnostic[]
    deterministicReplay: boolean
  }
}

export interface CreateSceneArtifactInput {
  projectId: string
  project: SceneProjectAst
  sources: Record<string, string>
  entityIds?: string[]
  layout?: Record<string, { x: number; y: number }>
  sourceMap?: SourceMapEntry[]
  compilerVersion: string
  sceneScriptVersion: string
  contractVersions?: Record<string, string>
  seed?: number | string
  captures?: string[]
  resultLineage?: ResultLineage[]
  runtimeSnapshot?: unknown
  preview?: unknown
  diagnostics?: SceneDiagnostic[]
}

export function stableArtifactStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableArtifactStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableArtifactStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function artifactHash(value: unknown): string {
  return stableHash(stableArtifactStringify(value))
}

function modelWithoutArtifactHash(model: SceneModelArtifact): Omit<SceneModelArtifact, 'hashes'> & {
  hashes: Omit<SceneModelArtifact['hashes'], 'artifact'>
} {
  const { artifact: _artifact, ...hashes } = model.hashes
  return { ...model, hashes }
}

export function createSceneArtifact(input: CreateSceneArtifactInput): SceneArtifactBundle {
  const modules = Object.values(input.project.modules)
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId))
    .map((ast) => ({
      moduleId: ast.moduleId,
      file: ast.file,
      sourceHash: artifactHash(input.sources[ast.file] ?? ''),
      ast,
    }))
  const sourceMap = [...(input.sourceMap ?? [])].sort(
    (left, right) => left.moduleId.localeCompare(right.moduleId) || left.statementId.localeCompare(right.statementId),
  )
  const semanticModel = {
    entryModuleId: input.project.entryModuleId,
    modules: modules.map((item) => item.ast),
    layout: input.layout ?? {},
    sourceMap,
    versions: {
      sceneScript: input.sceneScriptVersion,
      compiler: input.compilerVersion,
      contracts: input.contractVersions ?? {},
    },
    execution: {
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      captures: [...(input.captures ?? [])].sort(),
      resultLineage: input.resultLineage ?? [],
    },
  }
  const model = {
    schemaVersion: SCENE_MODEL_ARTIFACT_VERSION,
    projectId: input.projectId,
    entryModuleId: input.project.entryModuleId,
    modules,
    stableIds: {
      moduleIds: modules.map((item) => item.moduleId).sort(),
      definitionIds: modules.flatMap((item) => item.ast.definitions.map((definition) => definition.definitionId)).sort(),
      statementIds: modules.flatMap((item) => [
        ...item.ast.statements.map((statement) => statement.statementId),
        ...item.ast.definitions.flatMap((definition) => definition.body.map((statement) => statement.statementId)),
      ]).sort(),
      entityIds: [...(input.entityIds ?? sourceMap.map((item) => item.entityId))].sort(),
    },
    imports: modules.flatMap((item) => item.ast.imports.map((sceneImport) => ({
      moduleId: item.moduleId,
      from: sceneImport.from,
      names: [...sceneImport.specifiers].sort((left, right) =>
        left.local.localeCompare(right.local) || left.imported.localeCompare(right.imported)),
    }))).sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.from.localeCompare(right.from)),
    layout: input.layout ?? {},
    sourceMap,
    versions: semanticModel.versions,
    execution: semanticModel.execution,
    hashes: {
      sources: artifactHash(Object.fromEntries(Object.entries(input.sources).sort(([left], [right]) => left.localeCompare(right)))),
      semanticModel: artifactHash(semanticModel),
      ...(input.runtimeSnapshot !== undefined ? { runtimeSnapshot: artifactHash(input.runtimeSnapshot) } : {}),
      ...(input.preview !== undefined ? { preview: artifactHash(input.preview) } : {}),
      artifact: '',
    },
  } satisfies SceneModelArtifact
  model.hashes.artifact = artifactHash(modelWithoutArtifactHash(model))
  const files: SceneArtifactBundle['reviewManifest']['files'] = [
    ...Object.entries(input.sources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, source]) => ({ path: `sources/${path}`, hash: artifactHash(source), role: 'source' as const })),
    { path: 'scene-model.json', hash: model.hashes.artifact, role: 'model' as const },
    ...(input.runtimeSnapshot === undefined
      ? []
      : [{ path: 'runtime/snapshot.json', hash: artifactHash(input.runtimeSnapshot), role: 'runtime-cache' as const }]),
    ...(input.preview === undefined
      ? []
      : [{ path: 'preview/preview.json', hash: artifactHash(input.preview), role: 'preview' as const }]),
  ]
  return {
    model,
    sources: Object.fromEntries(Object.entries(input.sources).sort(([left], [right]) => left.localeCompare(right))),
    ...(input.runtimeSnapshot !== undefined ? { runtimeSnapshot: input.runtimeSnapshot } : {}),
    ...(input.preview !== undefined ? { preview: input.preview } : {}),
    reviewManifest: {
      schemaVersion: 1,
      projectId: input.projectId,
      artifactHash: model.hashes.artifact,
      files,
      diagnostics: input.diagnostics ?? [],
      deterministicReplay: true,
    },
  }
}

export function verifySceneArtifact(bundle: SceneArtifactBundle): {
  valid: boolean
  diagnostics: string[]
} {
  const diagnostics: string[] = []
  const expectedArtifactHash = artifactHash(modelWithoutArtifactHash(bundle.model))
  if (expectedArtifactHash !== bundle.model.hashes.artifact) diagnostics.push('scene-model artifact hash mismatch')
  if (artifactHash(bundle.sources) !== bundle.model.hashes.sources) diagnostics.push('sources hash mismatch')
  for (const module of bundle.model.modules) {
    const source = bundle.sources[module.file]
    if (source === undefined) diagnostics.push(`missing source: ${module.file}`)
    else if (artifactHash(source) !== module.sourceHash) diagnostics.push(`source hash mismatch: ${module.file}`)
  }
  if (bundle.runtimeSnapshot !== undefined
    && artifactHash(bundle.runtimeSnapshot) !== bundle.model.hashes.runtimeSnapshot) {
    diagnostics.push('runtime snapshot hash mismatch')
  }
  if (bundle.preview !== undefined && artifactHash(bundle.preview) !== bundle.model.hashes.preview) {
    diagnostics.push('preview hash mismatch')
  }
  return { valid: diagnostics.length === 0, diagnostics }
}

/** Replay is data-only: consumers compile the returned canonical AST, never the runtime snapshot. */
export function replaySceneArtifact(bundle: SceneArtifactBundle): SceneProjectAst {
  const verification = verifySceneArtifact(bundle)
  if (!verification.valid) throw new Error(`invalid Scene artifact: ${verification.diagnostics.join('; ')}`)
  return {
    entryModuleId: bundle.model.entryModuleId,
    modules: Object.fromEntries(bundle.model.modules.map((item) => [item.moduleId, item.ast])),
  }
}
