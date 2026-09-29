#!/usr/bin/env node
// Manifest SSOT: `apps/composition/forgeax-plugin.json` is the only hand-written
// manifest. Everything else is derived here.
//
// Four manifest paths, three files:
//   apps/composition/forgeax-plugin.json     — the source (hand-written)
//   apps/composition/forgeax-extension.json  — a tracked SYMLINK to the source
//   forgeax-extension.json                   — generated (repo-root install identity)
//   forgeax-plugin.json                      — generated, byte-identical to the above
//
// The root pair is what a stock Studio flat scanner reads, so it carries the
// released package id, `./apps/composition/` path prefixes, and the embedded
// launch shape. Before this generator existed all of that was hand-copied and
// had drifted: root sat on version 0.4.0 while the app was 0.4.2, and the root
// skill description still taught the removed `composeHeightfield`.
//
//   node scripts/generate-manifests.mjs           # write the root pair
//   node scripts/generate-manifests.mjs --check    # exit 1 if out of sync
//
// `scripts/generate-manifests.test.mjs` (part of `bun run test:packaging`) runs
// the --check path, so drift fails CI instead of shipping.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE = join(ROOT, 'apps', 'composition', 'forgeax-plugin.json')
export const GENERATED = ['forgeax-extension.json', 'forgeax-plugin.json']

/** Manifest fields holding an app-relative path that must be re-rooted. */
const PATH_FIELDS = [
  ['entry', 'backend'],
  ['entry', 'frontend'],
  ['contributes', 'panelTypes', 0, 'entry'],
  ['contributes', 'agents', 0, 'personaFile'],
]

const APP_PREFIX = './apps/composition/'

function rerootPath(value) {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    throw new Error(`expected an app-relative "./" path, got ${JSON.stringify(value)}`)
  }
  return APP_PREFIX + value.slice(2)
}

function mutate(manifest, path, fn) {
  let node = manifest
  for (const key of path.slice(0, -1)) {
    node = node?.[key]
    if (node === undefined) throw new Error(`missing manifest path ${path.join('.')}`)
  }
  const last = path[path.length - 1]
  if (node?.[last] === undefined) throw new Error(`missing manifest path ${path.join('.')}`)
  node[last] = fn(node[last])
}

/**
 * Root manifest = app manifest with the released identity and re-rooted paths.
 * `embeddedAlso: true` + `start: bun run dev` is the host-embedded shape stock
 * Studio needs (asserted by `scripts/runtime-identity.test.mjs`); the app copy
 * stays standalone-only so `bun run serve` drives the built dist.
 */
export function renderRootManifest(source) {
  const manifest = structuredClone(source)
  manifest.id = '@forgeax-extension/scene-generator'
  for (const path of PATH_FIELDS) mutate(manifest, path, rerootPath)
  mutate(manifest, ['entry', 'standalone', 'start'], () => 'bun run dev')
  mutate(manifest, ['entry', 'standalone', 'embeddedAlso'], () => true)
  return manifest
}

function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function readSource() {
  return JSON.parse(readFileSync(SOURCE, 'utf8'))
}

/** @returns paths whose on-disk content differs from what we would generate. */
export function findDrift() {
  const expected = serialize(renderRootManifest(readSource()))
  return GENERATED.filter((name) => readFileSync(join(ROOT, name), 'utf8') !== expected)
}

export function writeGenerated() {
  const expected = serialize(renderRootManifest(readSource()))
  const written = []
  for (const name of GENERATED) {
    const path = join(ROOT, name)
    if (readFileSync(path, 'utf8') === expected) continue
    writeFileSync(path, expected)
    written.push(name)
  }
  return written
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--check')) {
    const drift = findDrift()
    if (drift.length > 0) {
      console.error(`[manifests] out of sync: ${drift.join(', ')}`)
      console.error('[manifests] run: node scripts/generate-manifests.mjs')
      process.exit(1)
    }
    console.log('[manifests] root manifests match apps/composition/forgeax-plugin.json')
  } else {
    const written = writeGenerated()
    console.log(written.length > 0
      ? `[manifests] wrote ${written.join(', ')}`
      : '[manifests] already up to date')
  }
}
