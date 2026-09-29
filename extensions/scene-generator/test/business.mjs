import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function exerciseScene(call, root) {
  assert.equal((await call(['doctor'])).health.status, 'ok')
  assert(Array.isArray(await call(['projects'])))
  const created = await call(['create', '--name', 'Extension acceptance'])
  const project = ['--project', created.id]
  const info = await call(['info', ...project])
  const original = await call(['read', ...project])
  assert.equal(typeof original.source, 'string')
  const contracts = await call(['contracts', ...project, '--functions', 'box,sceneNode,sceneOutput'])
  assert(JSON.stringify(contracts).includes('sceneOutput'))
  const source = await readFile(new URL('fixture.scene.ts', import.meta.url), 'utf8')
  const inputDir = resolve(root, '.forgeax/extensions/scene-generator/data')
  await mkdir(inputDir, { recursive: true })
  const sourceFile = resolve(inputDir, 'proposal.scene.ts')
  const inputFile = resolve(inputDir, 'commit.json')
  await writeFile(sourceFile, source)
  const validated = await call(['validate', ...project, '--source', sourceFile])
  assert.equal(validated.valid, true)
  await writeFile(inputFile, JSON.stringify({
    files: [{ file: 'main.scene.ts', source }], entryFile: 'main.scene.ts',
    expectedProjectRevision: info.projectRevision,
  }))
  const committed = await call(['commit', ...project, '--input', inputFile])
  assert.equal(committed.ok, true)
  await assert.rejects(call(['commit', ...project, '--input', inputFile]), /scene_http_409/)
  const executed = await call(['execute', ...project])
  assert.equal(executed.verification.ok, true)
  await assert.rejects(call(['export', ...project, '--out', '../outside']), /scene_output_invalid/)
  const exported = await call(['export', ...project, '--out', 'assets/scene-generator/acceptance'])
  assert.equal(exported.ok, true)
  assert.equal(exported.meshCount, 1)
  const receipt = JSON.parse(await readFile(resolve(exported.path, 'scene-entry.json'), 'utf8'))
  assert.equal(receipt.packSchemaVersion, '2.0.0')
  assert(receipt.files.includes(exported.packFile))
  await writeFile(sourceFile, 'invalid TypeScript ?')
  await assert.rejects(call(['validate', ...project, '--source', sourceFile]), /scene_operation_failed/)
  await assert.rejects(call(['info', '--project', 'missing-project']), /scene_http_404/)
  return exported
}
