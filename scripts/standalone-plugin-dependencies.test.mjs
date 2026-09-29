import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginApps = [
  'composition',
]
const forbiddenDependency = /^(?:file:|link:|workspace:|git\+)/u
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

test('app roots that Studio bun-installs have only registry dependency specs', async () => {
  for (const appName of pluginApps) {
    const manifest = JSON.parse(await readFile(join(repoRoot, 'apps', appName, 'package.json'), 'utf8'))
    assert.notEqual(manifest.packageManager, undefined, `${appName} must keep packageManager`)
    assert.match(String(manifest.packageManager), /^bun@/u, `${appName} must use Bun`)
    for (const section of dependencySections) {
      for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
        assert.equal(typeof specifier, 'string', `${appName} ${section}.${name} must be a string`)
        assert.equal(
          forbiddenDependency.test(specifier),
          false,
          `${appName} ${section}.${name}=${specifier} would break Studio bun install`,
        )
      }
    }
  }
})

test('backend and frontend keep in-repo @forgeax/* on workspace:*', async () => {
  for (const appName of pluginApps) {
    for (const leaf of ['backend', 'frontend']) {
      const manifest = JSON.parse(
        await readFile(join(repoRoot, 'apps', appName, leaf, 'package.json'), 'utf8'),
      )
      const forgeaxDeps = Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
        name.startsWith('@forgeax/'),
      )
      assert.ok(forgeaxDeps.length > 0, `${appName}/${leaf} must depend on @forgeax/*`)
      for (const [name, specifier] of forgeaxDeps) {
        assert.equal(
          specifier,
          'workspace:*',
          `${appName}/${leaf} ${name} must stay workspace:*`,
        )
      }
    }
  }
})
