import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import test from 'node:test'
import { exerciseScene } from './business.mjs'

const repo = resolve(import.meta.dirname, '../../..')

test('relocated standard extension operates against the real Scene Generator service', { timeout: 120_000 }, async (t) => {
  const scratch = resolve(repo, '.scratch-repro/extension')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(resolve(scratch, 'consumer-'))
  const relocated = resolve(root, 'extension')
  await cp(resolve(repo, 'dist/extensions/scene-generator'), relocated, { recursive: true })
  const { check, run } = await import(pathToFileURL(resolve(relocated, 'cli.mjs')).href)
  const stateDir = resolve(root, '.forgeax/extensions/scene-generator')
  const context = { projectRoot: root, stateDir, packageVersion: '0.3.10' }
  await assert.rejects(access(stateDir))
  await assert.rejects(check(context, ['--base-url', 'https://example.com', '--json']), /scene_config_invalid/)
  await assert.rejects(check(context, ['--base-url', 'invalid']), /scene_config_invalid/)
  await assert.rejects(check(context, ['--unexpected']), /scene_arguments_invalid/)
  await assert.rejects(run(context, ['absent']), /scene_command_unknown/)
  const server = fork(resolve(import.meta.dirname, 'server.mts'), [], {
    execArgv: ['--conditions=source', '--import', createRequire(resolve(repo, 'apps/composition/backend/package.json')).resolve('tsx')],
    cwd: repo,
    env: { ...process.env, FORGEAX_PROJECT_ROOT: resolve(root, 'service'), FORGEAX_GAMES_ROOT: resolve(root, 'games'), TMPDIR: root },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  server.stdout.on('data', data => { output += data })
  server.stderr.on('data', data => { output += data })
  t.after(async () => {
    if (server.connected) {
      const exited = once(server, 'exit')
      server.send('close')
      await exited
    }
  })
  const [{ address }] = await Promise.race([
    once(server, 'message'),
    once(server, 'exit').then(([code]) => { throw new Error(`Service exited ${code}: ${output}`) }),
  ])
  const config = await check(context, ['--base-url', address, '--json'])
  await assert.rejects(access(stateDir), 'check must not publish configuration')
  await mkdir(stateDir, { recursive: true })
  await writeFile(resolve(stateDir, 'config.json'), JSON.stringify(config))
  const result = await exerciseScene(args => run(context, [...args, '--json']), root)
  assert((await readFile(resolve(result.path, result.packFile), 'utf8')).includes('2.0.0'))
})
