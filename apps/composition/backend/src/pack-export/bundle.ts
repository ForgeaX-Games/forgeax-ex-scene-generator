import type { PackSchemaVersion } from './inputs.js'

/** Portable compilation emits JavaScript; declarations keep the native TS entry typed. */
export function bundleFiles(code: string, schemaVersion: PackSchemaVersion): ReadonlyMap<string, string> {
  if (schemaVersion === '1.0.0') return new Map([['build-scene.ts', code]])
  return new Map([
    ['build-scene.mjs', code],
    ['build-scene.d.mts', "import type { BridgeSceneTree } from './platform/engineBridge.ts'\nexport declare function generateScene(args?: readonly unknown[]): Promise<BridgeSceneTree>\n"],
  ])
}
