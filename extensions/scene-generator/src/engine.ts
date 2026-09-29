import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, isAbsolute, sep } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const ENGINE_VERSION = '0.2.1'

export async function engineRelease(projectRoot: string) {
  const manifestPath = resolve(projectRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.dependencies?.['@forgeax/engine'] !== ENGINE_VERSION) {
    throw new Error(`scene_engine_version: game must declare @forgeax/engine ${ENGINE_VERSION}`)
  }
  const installedPath = createRequire(manifestPath).resolve('@forgeax/engine/package.json')
  const installed = JSON.parse(await readFile(installedPath, 'utf8'))
  if (installed.version !== ENGINE_VERSION) throw new Error(`scene_engine_version: installed Engine must be ${ENGINE_VERSION}`)
  return { version: ENGINE_VERSION, cli: resolve(dirname(installedPath), installed.bin.forgeax) }
}

interface CatalogRow { guid: string; kind: string; sourcePath: string; sourceKey: string; packageUrl: string; name?: string }
interface BuildArtifact { path: string; bytes: number; sha256: string }

/** Engine's verified build catalog supplies the runtime identities returned to the Agent. */
export async function buildEnginePack(projectRoot: string, sourcePath: string, sceneGuid: string) {
  const engine = await engineRelease(projectRoot)
  const { stdout } = await execute(process.execPath, [engine.cli, 'project', 'build', '--json'], {
    cwd: projectRoot, timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
  })
  const envelope = JSON.parse(stdout)
  if (!envelope.ok) throw new Error(`scene_engine_build: ${JSON.stringify(envelope.error)}`)
  const build = envelope.value
  const dist = resolve(projectRoot, 'dist')
  async function artifact(path: string) {
    const local = relative(dist, resolve(dist, path))
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('scene_engine_artifact: path is outside dist')
    const record = (build.artifacts as BuildArtifact[]).find(item => item.path === path)
    if (!record) throw new Error(`scene_engine_artifact: build did not record ${path}`)
    const bytes = await readFile(resolve(dist, path))
    if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
      throw new Error(`scene_engine_artifact: build digest differs for ${path}`)
    }
    return JSON.parse(bytes.toString('utf8'))
  }
  const index: CatalogRow[] = await artifact(build.runtime.packIndexUrl)
  const assets = index.filter(row => row.sourcePath === sourcePath)
  const scene = assets.find(row => row.kind === 'scene' && row.guid === sceneGuid)
  if (!scene) throw new Error('scene_engine_scene_missing: Engine build did not publish the exported scene GUID')
  for (const url of new Set(assets.map(row => row.packageUrl))) {
    const pack = await artifact(url.replace(/^\//, ''))
    for (const row of assets.filter(row => row.packageUrl === url)) {
      if (!pack.assets.some((asset: { guid: string; kind: string }) => asset.guid === row.guid && asset.kind === row.kind)) {
        throw new Error(`scene_engine_guid_missing: ${row.guid}`)
      }
    }
  }
  return { version: engine.version, authority: 'engine-build-catalog', sceneGuid: scene.guid,
    assets: assets.map(({ guid, kind, sourcePath, sourceKey, packageUrl, name }) => ({ guid, kind, sourcePath, sourceKey, packageUrl, ...(name ? { name } : {}) })) }
}
