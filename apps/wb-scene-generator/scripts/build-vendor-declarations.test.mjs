import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('build-vendor emits scene declarations used by the backend', async () => {
  await execFileAsync(process.execPath, [join(appRoot, 'scripts/build-vendor.mjs')], { cwd: appRoot })

  const projectionDeclaration = await readFile(
    join(appRoot, 'vendor/dist/shared/types/scene/projection.d.ts'),
    'utf8',
  )
  const cellDeclaration = await readFile(
    join(appRoot, 'vendor/dist/shared/types/scene/types.d.ts'),
    'utf8',
  )

  assert.match(cellDeclaration, /token: string/)
  assert.match(projectionDeclaration, /alias\?: string/)
})
