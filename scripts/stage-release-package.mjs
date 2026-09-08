#!/usr/bin/env node
/** Stage the generated standalone package at the repository root for npm pack. */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = join(root, 'release', 'scene-generator')

if (!existsSync(releaseRoot)) throw new Error(`missing generated release package: ${releaseRoot}`)
for (const entry of readdirSync(releaseRoot)) {
  if (entry === 'node_modules') continue
  cpSync(join(releaseRoot, entry), join(root, entry), { recursive: true, force: true })
}
console.log(`[release] staged ${releaseRoot} at repository root for npm pack`)
