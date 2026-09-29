import { resolvePackSchemaVersion, validatePackInputs } from './inputs.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { runSceneModule, compilePortableScene } from '@forgeax/scene'
import {
  rewriteModuleImports,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import { firstBatchImplementations } from '../scene-script/run/hostImplementations.js'
import { parseScenePort } from '../../../vendor/dist/shared/types/scene/port.js'
import { emitPackSource } from './emitPack.js'
import { bundleFiles } from './bundle.js'
import { deriveAssetGuid, derivePackageUuid, safeSlug } from './identity.js'
import { projectScene, type BridgeSceneTree } from './engineBridge.js'
import {
  buildPlatformClosure,
  collectSceneImports,
  PORTABLE_SDK_SPECIFIERS,
} from './vendorClosure.js'
import { fingerprintProjection, type PackFingerprint } from './fingerprint.js'
import { verifyEmittedPack, buildBudgetDiagnostics } from './verify.js'
import type { PackExportOptions, PackExportResult } from './service.js'

export interface ModulePackOptions extends PackExportOptions {
  sourceDir: string
  entryFile: string
  destination: string
  packageId: string
  projectName?: string
}

/**
 * `../platform/index.ts` seen from a copied scene file. `main.scene.ts` sits one
 * level under the pack root, `generators/x.generator.ts` two.
 */
function platformSpecifier(relPath: string): string {
  return `${'../'.repeat(relPath.split('/').length)}platform/index.ts`
}

/** Only the virtual `@forgeax/scene` moves; every other specifier already ends in `.ts`. */
function rewriteSceneSource(relPath: string, source: string): string {
  return rewriteModuleImports(source, (specifier) =>
    PORTABLE_SDK_SPECIFIERS.has(specifier)
      ? platformSpecifier(relPath)
      : undefined,
  )
}

function sceneTreeFromRun(
  trace: readonly { functionName: string; result: unknown }[],
  diagnostics: readonly SceneDiagnostic[],
): BridgeSceneTree {
  const candidates: BridgeSceneTree[] = []
  for (let i = 0; i < trace.length; i++) {
    const call = trace[i]!
    if (call.functionName !== 'sceneOutput') continue
    const port = parseScenePort(call.result)
    if (port) candidates.push(port as unknown as BridgeSceneTree)
  }
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1)
    throw new Error(
      'Multiple sceneOutput values: select an exported scene value or function with exportName.',
    )
  const errors = diagnostics.filter((item) => item.severity === 'error')
  throw new Error(
    errors.length > 0
      ? `Scene run produced no sceneOutput. ${errors.map((item) => `${item.code}: ${item.message}`).join(' | ')}`
      : 'Scene run produced no sceneOutput({ scene }) call, so there is nothing to pack.',
  )
}

/**
 * Write the pack in place rather than replacing the directory.
 *
 * The editor's pack plugin watches these directories recursively
 * (`packages/editor/packages/engine/packages/vite-plugin-pack/src/dev/watcher.ts`).
 * `rm -rf`-ing the tree on each export invalidates every watch under it, and the
 * DDC cook then stays silent until the whole Vite session restarts. Overwriting
 * keeps the inodes — and the watches — alive, so a re-export is picked up hot.
 *
 * `<slug>.pack.ts` is written last: it is the only file the watcher classifies as
 * a sidecar, so the cook it schedules must find the closure it imports already on
 * disk.
 */
export function writePackTree(
  destDir: string,
  out: ReadonlyMap<string, string>,
  packFile: string,
): number {
  const receipt = join(destDir, 'scene-entry.json')
  const previousFiles: string[] = existsSync(receipt)
    ? (JSON.parse(readFileSync(receipt, 'utf8')).files ?? [])
    : []
  const stale = new Set(
    previousFiles.filter(
      (file) => !file.startsWith('/') && !file.split('/').includes('..'),
    ),
  )
  let bytes = 0
  const write = (name: string, text: string): void => {
    const file = join(destDir, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
    bytes += Buffer.byteLength(text, 'utf8')
    stale.delete(name)
  }
  for (const [name, text] of out) if (name !== packFile) write(name, text)
  write(packFile, out.get(packFile)!)
  for (const name of stale) rmSync(join(destDir, name), { force: true })
  return bytes
}

export async function exportSceneModulePack(
  options: ModulePackOptions,
): Promise<PackExportResult> {
  const schemaVersion = resolvePackSchemaVersion(options.schemaVersion)
  if (
    schemaVersion === '1.0.0' &&
    (options.parameters?.length ||
      Object.keys(options.parameterBindings ?? {}).length)
  )
    throw new Error(
      'schemaVersion 1.0.0 supports fixed args only; parameter bindings require 2.0.0',
    )
  if (
    options.includeDefaultLighting !== undefined &&
    typeof options.includeDefaultLighting !== 'boolean'
  ) {
    throw new Error('includeDefaultLighting must be a boolean')
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.packageId))
    throw new Error('packageId must be a stable UUID')
  buildBudgetDiagnostics(0, options.consumerBuildBudgetMs)
  validatePackInputs(
    options.args,
    options.parameters,
    options.parameterBindings,
  )
  const {
    sourceDir,
    destination,
    packageId,
    projectName = 'Scene module',
    projectId = packageId,
  } = options
  const projectDir = sourceDir,
    gameSlug = ''
  const stored = { file: options.entryFile }
  const runStarted = Date.now()
  const run = await runSceneModule({
    projectDir: projectDir,
    entryFile: stored.file,
    implementations: await firstBatchImplementations(),
    purpose: 'build',
    exportName: options.exportName,
    args: options.args,
  })
  const runMs = Date.now() - runStarted
  if (!run.ok)
    throw new Error(
      run.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.source?.file ?? stored.file}: ${d.code}: ${d.message}`)
        .join(' | '),
    )
  const tree =
    (parseScenePort(run.output) as unknown as BridgeSceneTree | null) ??
    sceneTreeFromRun(run.trace, run.diagnostics)
  const projection = projectScene(tree)
  const expected: PackFingerprint = fingerprintProjection(projection)

  const sceneFiles = new Map(Object.entries(run.files))
  const closure = buildPlatformClosure(collectSceneImports(sceneFiles))

  const slug = safeSlug(
    options.entryFile
      ? `${options.entryFile.replace(/\.scene\.ts$/, '')}-${options.exportName ?? 'default'}`
      : projectName,
    'scene',
  )
  const sceneKey = options.sourceKey ?? `scene/${slug}`
  if (
    !/^scene\/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(
      sceneKey,
    ) ||
    sceneKey.split('/').includes('..')
  )
    throw new Error('Scene sourceKey must be a stable scene/<key> path')
  const packageUuid =
    options.packageId ??
    derivePackageUuid(
      `${projectId}:${stored.file}:${options.exportName ?? 'script'}`,
    )
  const packFile = `${slug}.pack.ts`
  const packSource = emitPackSource({
    schemaVersion,
    projection,
    includeDefaultLighting:
      options.includeDefaultLighting ?? !options.entryFile,
    args: options.args,
    parameters: options.parameters,
    parameterBindings: options.parameterBindings,
    packageUuid,
    packName: projectName,
    sceneSlug: slug,
    sceneKey,
  })

  const out = new Map<string, string>([
    [packFile, packSource],
    ['platform/index.ts', closure.barrel],
  ])
  for (const [name, text] of closure.files) out.set(`platform/${name}`, text)
  for (const [relPath, source] of sceneFiles)
    out.set(`scene/${relPath}`, rewriteSceneSource(relPath, source))

  const bundle = await compilePortableScene(out, stored.file, {
    projectDir,
    exportName: options.exportName,
    args: options.args,
  })
  for (const [name, source] of bundleFiles(bundle, schemaVersion)) out.set(name, source)
  out.set(
    'scene-entry.json',
    JSON.stringify(
      {
        schemaVersion: 'scene-entry/1',
        packSchemaVersion: schemaVersion,
        entryFile: stored.file,
        exportName: options.exportName,
        args: options.args ?? [],
        packageId: packageUuid,
        sourceKey: sceneKey,
        packFile,
        projectName,
        includeDefaultLighting: options.includeDefaultLighting ?? false,
        parameters: options.parameters,
        parameterBindings: options.parameterBindings,
        consumerBuildBudgetMs: options.consumerBuildBudgetMs ?? 5000,
      },
      null,
      2,
    ),
  )
  const gameRoot = dirname(destination)
  const destDir = destination
  const staging = mkdtempSync(join(tmpdir(), 'scene-pack-verify-'))
  let verified
  try {
    writePackTree(staging, out, packFile)
    verified = await verifyEmittedPack(staging, stored.file, expected)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const receiptData = JSON.parse(out.get('scene-entry.json')!)
  out.set(
    'scene-entry.json',
    JSON.stringify({ ...receiptData, files: [...out.keys()] }, null, 2),
  )
  const bytes = writePackTree(destDir, out, packFile)

  return {
    schemaVersion,
    ok: true,
    projectId,
    projectName,
    gameSlug,
    path: destDir,
    relPath: relative(gameRoot, destDir).replaceAll('\\', '/'),
    packFile,
    sceneGuid: deriveAssetGuid(packageUuid, sceneKey),
    packageId: packageUuid,
    sceneKey,
    entityCount: projection.entities.length,
    meshCount: projection.meshCount,
    vertexCount: projection.vertexCount,
    triangleCount: projection.triangleCount,
    uvsGeneratedCount: projection.entities.filter(
      (entity) => entity.mesh?.uvsGenerated,
    ).length,
    materialCount: projection.materials.length,
    submeshCount: projection.entities.reduce(
      (sum, entity) => sum + (entity.mesh?.runs.length ?? 0),
      0,
    ),
    fileCount: out.size,
    bytes,
    runMs,
    verifyMs: verified.durationMs,
    diagnostics: [
      ...run.diagnostics,
      ...buildBudgetDiagnostics(
        verified.durationMs,
        options.consumerBuildBudgetMs,
      ),
    ],
    message: `Wrote ${out.size} files to ${relative(gameRoot, destDir)} — vertices reproduced identically outside scene-generator.`,
  }
}
