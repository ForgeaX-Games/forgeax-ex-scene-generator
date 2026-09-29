import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import type { PackProjection } from './engineBridge.js'
import { fingerprintProjection } from './fingerprint.js'

/**
 * Verifies portable generation and projection (not native cook/render): a fresh process with no
 * `globalThis.__forgeaxSceneHost`, no scene-generator runtime, and nothing
 * cached from the export that produced it. Everything it touches inside the
 * pack comes from the pack — `platform/**` and `scene/**`, no bare imports.
 *
 * Prints one JSON line: `{ durationMs, fingerprint }`.
 */

const [destDir, entryFile] = process.argv.slice(2) as [string, string]
const packUrl = (...parts: string[]) => pathToFileURL(join(destDir, ...parts)).href

const bridge = (await import(packUrl('platform', 'engineBridge.ts'))) as {
  projectScene: (tree: unknown) => PackProjection
}
const receipt = JSON.parse(readFileSync(join(destDir, 'scene-entry.json'), 'utf8'))
const program = (await import(packUrl(receipt.packSchemaVersion === '1.0.0' ? 'build-scene.ts' : 'build-scene.mjs'))) as { generateScene: () => Promise<unknown> }

const started = Date.now()
const fingerprint = fingerprintProjection(bridge.projectScene(await program.generateScene()))
const durationMs = Date.now() - started

process.stdout.write(
  'SCENE_PACK_VERIFIED:' + JSON.stringify({ durationMs, fingerprint }),
)
