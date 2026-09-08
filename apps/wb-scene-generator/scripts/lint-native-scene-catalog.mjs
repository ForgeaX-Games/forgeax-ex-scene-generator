#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  resolve(appRoot, 'batteries', 'groups'),
  resolve(appRoot, 'batteries', 'templates'),
]
const violations = []
let nativeDefinitions = 0

async function visit(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      await visit(path)
      continue
    }
    if (entry.name.endsWith('.json') && !entry.name.endsWith('.generated.json')) {
      violations.push(`${relative(appRoot, path)}: production Group/Template JSON must be a generated cache`)
    }
    if (!entry.name.endsWith('.scene.ts')) continue
    if (path.includes('/groups/test_terrain/')) continue
    nativeDefinitions += 1
    const source = await readFile(path, 'utf8')
    if (!/\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*defineGroup\s*\(/.test(source)) {
      violations.push(`${relative(appRoot, path)}: catalog entry must export defineGroup(...)`)
    }
  }
}

for (const root of roots) await visit(root)
if (nativeDefinitions !== 52) {
  violations.push(`native production catalog has ${nativeDefinitions} Definitions; expected 52`)
}
if (violations.length) {
  for (const violation of violations) console.error(`[scene-native-catalog] ${violation}`)
  process.exit(1)
}
console.log(`[scene-native-catalog] OK — ${nativeDefinitions} native .scene.ts Definitions; no handwritten JSON`)
