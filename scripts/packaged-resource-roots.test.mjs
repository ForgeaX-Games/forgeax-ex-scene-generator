import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

test('bundled first-batch roots use packaged resources and compiled entry files', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'scene-resource-roots-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const moduleRoot = join(root, 'modules/composition')
  const output = join(moduleRoot, 'dist/server/library.mjs')
  mkdirSync(join(moduleRoot, 'dist/server'), { recursive: true })
  execFileSync('bun', ['build', resolve('apps/composition/backend/src/scene-script/firstBatchBatteries.ts'), '--target=node', '--outfile', output])
  const lib = await import(pathToFileURL(output).href)
  const common = lib.FIRST_BATCH_COMMON_BATTERIES[0]
  const battery = lib.FIRST_BATCH_COMPOSITION_BATTERIES[0]
  mkdirSync(join(moduleRoot, 'shared-batteries', common), { recursive: true })
  mkdirSync(join(moduleRoot, 'batteries', battery), { recursive: true })
  writeFileSync(join(moduleRoot, 'batteries', battery, 'index.js'), 'export default {}')
  // Root selection occurs at module load, so import after the package exists.
  const ready = await import(pathToFileURL(output).href + '?ready')
  assert(ready.resolveSceneContractRoots().includes(join(moduleRoot, 'shared-batteries', common)))
  assert(ready.resolveSceneContractRoots().includes(join(moduleRoot, 'batteries', battery)))
  assert.equal(ready.resolveFirstBatchLibraryEntries()[0].file, join(moduleRoot, 'batteries', battery, 'index.js'))
})
