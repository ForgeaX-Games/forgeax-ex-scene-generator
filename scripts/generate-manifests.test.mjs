import assert from 'node:assert/strict'
import { lstatSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { GENERATED, ROOT, findDrift, readSource, renderRootManifest } from './generate-manifests.mjs'

test('the root manifests are in sync with the app manifest', () => {
  assert.deepEqual(
    findDrift(),
    [],
    'root manifests drifted; run: node scripts/generate-manifests.mjs',
  )
})

test('apps/composition/forgeax-extension.json is a symlink to the hand-written source', () => {
  const link = join(ROOT, 'apps', 'composition', 'forgeax-extension.json')
  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(readlinkSync(link).replaceAll('\\', '/'), 'forgeax-plugin.json')
})

test('generation only re-roots paths and swaps the launch identity', () => {
  const source = readSource()
  const rendered = renderRootManifest(source)

  assert.equal(rendered.id, '@forgeax-extension/scene-generator')
  assert.equal(rendered.version, source.version)
  assert.equal(rendered.entry.backend, './apps/composition/backend/src/tool-handlers.ts')
  assert.equal(rendered.entry.frontend, './apps/composition/frontend/dist/index.html')
  assert.equal(rendered.entry.standalone.embeddedAlso, true)
  assert.equal(rendered.entry.standalone.start, 'bun run dev')
  assert.equal(
    rendered.contributes.agents[0].personaFile,
    './apps/composition/agents/sino/persona/zh.md',
  )

  // Contributions are the contract surface: generation must not touch them.
  assert.deepEqual(rendered.contributes.tools, source.contributes.tools)
  assert.deepEqual(rendered.contributes.skills, source.contributes.skills)
  assert.deepEqual(rendered.contributes.pages, source.contributes.pages)
})

test('the generated root pair is byte-identical', () => {
  assert.equal(GENERATED.length, 2)
  assert.deepEqual([...GENERATED].sort(), ['forgeax-extension.json', 'forgeax-plugin.json'])
})
