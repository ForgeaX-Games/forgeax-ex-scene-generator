import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('staging replaces repository symlinks with generated package directories', (t) => {
  const stageRoot = mkdtempSync(join(tmpdir(), 'forgeax-stage-release-'))
  t.after(() => rmSync(stageRoot, { recursive: true, force: true }))
  const frontendDist = join(stageRoot, 'apps/composition/frontend/dist')
  const releaseDist = join(stageRoot, 'release/scene-generator/dist')
  mkdirSync(frontendDist, { recursive: true })
  mkdirSync(releaseDist, { recursive: true })
  writeFileSync(join(frontendDist, 'old.js'), 'old\n')
  writeFileSync(join(releaseDist, 'server.js'), 'generated\n')
  symlinkSync('apps/composition/frontend/dist', join(stageRoot, 'dist'))

  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/stage-release-package.mjs')], {
    env: { ...process.env, FORGEAX_RELEASE_STAGE_ROOT: stageRoot },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(stageRoot, 'dist/server.js'), 'utf8'), 'generated\n')
  assert.equal(readFileSync(join(frontendDist, 'old.js'), 'utf8'), 'old\n')
})
