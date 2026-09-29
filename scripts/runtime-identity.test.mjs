import assert from 'node:assert/strict'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = [
  {
    directory: 'composition',
    packageName: '@forgeax/scene-generator-composition',
    ids: ['scene-generator.content', 'scene-generator', 'scene-generator.launcher'],
  },
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('source modules use canonical non-authoring identities', () => {
  for (const expected of MODULES) {
    const appRoot = join(ROOT, 'apps', expected.directory)
    const packageJson = readJson(join(appRoot, 'package.json'))
    const manifest = readJson(join(appRoot, 'forgeax-extension.json'))
    const pluginManifest = readJson(join(appRoot, 'forgeax-plugin.json'))
    const ids = [
      ...manifest.contributes.panelTypes.map(({ id }) => id),
      ...manifest.contributes.pages.map(({ id }) => id),
      ...manifest.contributes.activities.map(({ id }) => id),
    ]
    const contributionIds = Object.values(manifest.contributes)
      .flatMap((entries) => Array.isArray(entries) ? entries : [])
      .map(({ id }) => id)
      .filter((id) => typeof id === 'string')

    assert.equal(packageJson.name, expected.packageName)
    assert.deepEqual(pluginManifest, manifest)
    assert.deepEqual(ids, expected.ids)
    const toolIds = manifest.contributes.tools.map(({ id }) => id)
    assert.equal(
      new Set(toolIds).size,
      toolIds.length,
      'tool ids must be unique in ' + expected.directory,
    )
    for (const id of contributionIds) {
      assert.match(id, /^[a-z]/, `contribution id must start with a lowercase letter: ${id}`)
    }
    assert.doesNotMatch(JSON.stringify(manifest), /wb-/)
    assert.doesNotMatch(JSON.stringify(manifest), /@forgeax-plugin\//)
  }
})

test('the root install identity stays canonical', () => {
  assert.equal(readJson(join(ROOT, 'package.json')).name, '@forgeax-extension/scene-generator')
  assert.doesNotMatch(JSON.stringify(readJson(join(ROOT, 'forgeax-extension.json'))), /wb-/)
  assert.doesNotMatch(
    readFileSync(join(ROOT, '.github/workflows/release-gate.yml'), 'utf8'),
    /wb-/,
  )
  for (const path of [
    '.gitignore',
  ]) {
    assert.doesNotMatch(readFileSync(join(ROOT, path), 'utf8'), /wb-/)
  }
})

test('root frontend entry symlink points at composition dist', () => {
  const dist = join(ROOT, 'dist')
  assert.equal(lstatSync(dist).isSymbolicLink(), true)
  assert.equal(
    readlinkSync(dist).replaceAll('\\', '/').replace(/\/$/u, ''),
    'apps/composition/frontend/dist',
  )
})

test('root authoring is host-embedded so stock Studio can open it', () => {
  for (const file of ['forgeax-extension.json', 'forgeax-plugin.json']) {
    const standalone = readJson(join(ROOT, file)).entry.standalone
    assert.equal(standalone.embeddedAlso, true, file)
    assert.equal(
      readJson(join(ROOT, file)).entry.frontend,
      './apps/composition/frontend/dist/index.html',
      file,
    )
  }
  const backend = readJson(join(ROOT, 'apps/composition/backend/package.json'))
  assert.equal(backend.scripts.start, 'tsx src/main.ts')
  assert.equal(readJson(join(ROOT, 'package.json')).scripts.build.includes('build:packages'), true)
})
