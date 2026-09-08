import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import type { SceneAtlases } from './atlas.js'
import type { CookedScene } from './types.js'

export interface AssembleSceneBundleInput {
  cooked: CookedScene
  atlases: SceneAtlases
}

export interface WriteSceneBundleInput extends AssembleSceneBundleInput {
  activeProjectDir: string
}

export interface SceneBundleOutput {
  bundleId: string
  zipPath: string
  unpackedDir: string
}

/**
 * Fixed visualization payload, copied verbatim from the canonical reference
 * bundle. These files are vendored under ./assets and embedded byte-for-byte;
 * they must never be regenerated or edited.
 */
const VERBATIM_ASSET_FILES = [
  'viewer.html',
  'viewer.js',
  'serve.py',
  'serve.sh',
  'serve.bat',
  'README.md',
  'area-tag-query.ts',
] as const

function assetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // Works whether running from src/ (tsx) or dist/ (compiled): assets are
  // copied alongside the module under scene-export/assets.
  const candidates = [join(here, 'assets'), join(here, '..', '..', 'src', 'scene-export', 'assets')]
  for (const dir of candidates) if (existsSync(join(dir, 'viewer.js'))) return dir
  return candidates[0]!
}

function readVerbatimAssets(): Record<string, Buffer> {
  const dir = assetsDir()
  const out: Record<string, Buffer> = {}
  for (const name of VERBATIM_ASSET_FILES) out[name] = readFileSync(join(dir, name))
  return out
}

export async function assembleSceneBundle(input: AssembleSceneBundleInput): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(bundleFiles(input))) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function writeSceneBundle(input: WriteSceneBundleInput): Promise<SceneBundleOutput> {
  const bundleDir = join(input.activeProjectDir, 'exports', 'scene', input.cooked.bundleId)
  const unpackedDir = join(bundleDir, 'unpacked')
  const zipPath = join(bundleDir, 'scene.zip')
  mkdirSync(bundleDir, { recursive: true })
  if (existsSync(unpackedDir)) rmSync(unpackedDir, { recursive: true, force: true })
  mkdirSync(unpackedDir, { recursive: true })
  for (const [name, content] of Object.entries(bundleFiles(input))) {
    writeFileSync(join(unpackedDir, name), content)
  }
  const zip = await assembleSceneBundle(input)
  const tmp = `${zipPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, zip)
  renameSync(tmp, zipPath)
  return {
    bundleId: input.cooked.bundleId,
    zipPath,
    unpackedDir,
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function bundleFiles(input: AssembleSceneBundleInput): Record<string, string | Buffer> {
  const { cooked, atlases } = input
  return {
    ...readVerbatimAssets(),
    'manifest.json': json(cooked.manifest),
    'terrain.json': json(cooked.terrain),
    'terrain-config.json': json(cooked.terrainConfig),
    'object-type-config.json': json(cooked.objectTypeConfig),
    'passability-config.json': json(cooked.passabilityConfig),
    'terrain_atlas.png': atlases.terrain.png,
    'terrain_atlas.tsj': json(atlases.terrain.tsj),
    'object_atlas.png': atlases.object.png,
    'object_atlas.tsj': json(atlases.object.tsj),
  }
}
