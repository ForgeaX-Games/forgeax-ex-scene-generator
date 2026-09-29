import {
  existsSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compilePortableScene, evaluateSceneBundle } from '@forgeax/scene'
import { emitPackSource } from './emitPack.js'
import { bundleFiles } from './bundle.js'
import { projectScene, type BridgeSceneTree } from './engineBridge.js'
import { fingerprintProjection } from './fingerprint.js'
import { validatePackInputs } from './inputs.js'
import { writePackTree } from './moduleExport.js'
import { verifyEmittedPack, buildBudgetDiagnostics } from './verify.js'

/** Recompile the editable, vendored source closure without the originating project. */
export async function rebuildScenePack(
  directory: string,
): Promise<{
  ok: true
  packFile: string
  files: number
  verifyMs: number
  diagnostics: ReturnType<typeof buildBudgetDiagnostics>
}> {
  const root = resolve(directory),
    receipt = JSON.parse(readFileSync(join(root, 'scene-entry.json'), 'utf8'))
  if (
    receipt.schemaVersion !== 'scene-entry/1' ||
    !Array.isArray(receipt.files) ||
    !receipt.packFile
  )
    throw new Error(
      'Expected a scene-entry/1 receipt with owned files and packFile',
    )
  const validPath = (file: unknown): file is string =>
    typeof file === 'string' &&
    !!file &&
    !file.startsWith('/') &&
    !file.includes('\\') &&
    !file.split('/').includes('..')
  if (!validPath(receipt.entryFile) || !validPath(receipt.packFile))
    throw new Error('Invalid pack receipt entry path')
  buildBudgetDiagnostics(0, receipt.consumerBuildBudgetMs)
  validatePackInputs(
    receipt.args,
    receipt.parameters,
    receipt.parameterBindings,
  )
  const files = new Map<string, string>()
  for (const file of receipt.files) {
    if (!validPath(file))
      throw new Error('Invalid owned source path in pack receipt')
    if (existsSync(join(root, file)))
      files.set(file, readFileSync(join(root, file), 'utf8'))
  }
  const addSources = (relative: string): void => {
    for (const item of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      const file = `${relative}/${item.name}`
      if (item.isDirectory()) addSources(file)
      else if (/\.(?:ts|js|json)$/.test(file))
        files.set(file, readFileSync(join(root, file), 'utf8'))
    }
  }
  addSources('scene')
  addSources('platform')
  const code = await compilePortableScene(files, receipt.entryFile, {
    projectDir: root,
    exportName: receipt.exportName,
    args: receipt.args,
  })
  for (const name of ['build-scene.ts', 'build-scene.mjs', 'build-scene.d.mts']) files.delete(name)
  for (const [name, source] of bundleFiles(code, receipt.packSchemaVersion)) files.set(name, source)
  const generated = await evaluateSceneBundle(code)
  const projection = projectScene(
    await (generated.generateScene as () => Promise<BridgeSceneTree>)(),
  )
  files.set(
    receipt.packFile,
    emitPackSource({
      schemaVersion: receipt.packSchemaVersion,
      projection,
      packageUuid: receipt.packageId,
      packName: receipt.projectName ?? 'Scene module',
      sceneSlug: receipt.sourceKey.slice(6),
      sceneKey: receipt.sourceKey,
      args: receipt.args,
      parameters: receipt.parameters,
      parameterBindings: receipt.parameterBindings,
      includeDefaultLighting: receipt.includeDefaultLighting ?? false,
    }),
  )
  files.set(
    'scene-entry.json',
    JSON.stringify({ ...receipt, files: [...files.keys()] }, null, 2),
  )
  const staging = mkdtempSync(join(tmpdir(), 'scene-pack-rebuild-'))
  let verification
  try {
    writePackTree(staging, files, receipt.packFile)
    verification = await verifyEmittedPack(
      staging,
      receipt.entryFile,
      fingerprintProjection(projection),
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  writePackTree(root, files, receipt.packFile)
  return {
    ok: true,
    packFile: receipt.packFile,
    files: files.size,
    verifyMs: verification.durationMs,
    diagnostics: buildBudgetDiagnostics(
      verification.durationMs,
      receipt.consumerBuildBudgetMs,
    ),
  }
}
