import assert from 'node:assert/strict'
import { fork, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { exerciseScene } from '../extensions/scene-generator/test/business.mjs'

const [cliInput] = process.argv.slice(2)
if (!cliInput) throw new Error('Usage: node scripts/accept-installed-extension.mjs <installed-game-cli>')
const cli = resolve(cliInput)
assert(cli.includes('/node_modules/@forgeax/game/dist/'))
const repo = resolve(import.meta.dirname, '..')
const scratch = resolve(repo, '.scratch-repro/installed-extension')
await mkdir(scratch, { recursive: true })
const root = await mkdtemp(resolve(scratch, 'consumer-'))
const env = { ...process.env, FORGEAX_USER_STATE_DIR: resolve(root, 'user-state'), TMPDIR: process.env.TMPDIR ?? root }
const server = fork(resolve(repo, 'extensions/scene-generator/test/server.mts'), [], {
  cwd: repo,
  execArgv: ['--conditions=source', '--import', createRequire(resolve(repo, 'apps/composition/backend/package.json')).resolve('tsx')],
  env: { ...env, FORGEAX_PROJECT_ROOT: resolve(root, 'service'), FORGEAX_GAMES_ROOT: resolve(root, 'games') },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
let logs = ''
server.stdout.on('data', data => { logs += data })
server.stderr.on('data', data => { logs += data })
const game = resolve(root, 'game')
await mkdir(game)
function invoke(args, success = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: game, env, encoding: 'utf8', timeout: 300_000 })
  assert.equal(result.status === 0, success, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
async function call(args) {
  const result = spawnSync(process.execPath, [cli, 'scene-generator', ...args, '--json'], { cwd: game, env, encoding: 'utf8', timeout: 300_000 })
  const envelope = JSON.parse(result.stdout)
  if (!envelope.ok) throw new Error(envelope.error.message)
  assert.equal(result.status, 0)
  return envelope.value
}
function engine(args) {
  const result = spawnSync(process.execPath, [resolve(game, 'node_modules/@forgeax/engine/dist/bin/forgeax.mjs'), ...args, '--json'], {
    cwd: game, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.ok, true, JSON.stringify(envelope))
  return envelope.value
}
async function useSceneGuid(sceneGuid) {
  const input = resolve(root, 'scene-owner.json')
  await writeFile(input, JSON.stringify({
    path: 'assets/generated-scene-owner.pack.json', module: './scene-owner.pack.ts', export: 'sceneOwner',
    config: { scene: { $asset: sceneGuid } },
  }))
  const owner = engine(['asset', 'plugin', 'create', '--input', input])
  engine(['project', 'root', 'set', '--realm', 'engine', '--guid', owner.guid])
  assert.equal(JSON.parse(await readFile(resolve(game, 'forge.json'), 'utf8')).roots.engine, owner.guid)
  engine(['project', 'build'])
  const checked = spawnSync(process.execPath, [resolve(game, 'node_modules/typescript/bin/tsc'), '--noEmit'], {
    cwd: game, env, encoding: 'utf8', timeout: 60_000,
  })
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`)
  const live = engine(['dev', 'start', '--headless'])
  try {
    assert.equal(live.phase, 'ready')
    assert.equal(live.bridgeConnected, true)
    const found = engine(['dev', 'find', '--revision', live.revision, '--name', 'CLI acceptance building'])
    assert.equal(found.matches.length, 1)
    assert.equal(found.matches[0].name, 'CLI acceptance building')
    return { pluginGuid: owner.guid, sceneGuid, phase: live.phase, revision: found.revision, frameId: found.frameId, entities: found.matches }
  } finally {
    engine(['dev', 'stop'])
  }
}
try {
  const [{ address }] = await Promise.race([
    once(server, 'message'),
    once(server, 'exit').then(([code]) => { throw new Error(`Service exited ${code}: ${logs}`) }),
  ])
  invoke(['init'])
  // Trae's configuration is project-scoped; the user's Agent settings are untouched.
  invoke(['install', '--ide', 'trae', '--local'])
  const skill = resolve(game, '.trae/skills/scene-generator-authoring/SKILL.md')
  await assert.rejects(access(skill))
  await assert.rejects(access(resolve(game, '.forgeax/extensions/scene-generator/install.json')))
  await assert.rejects(call(['doctor']), /extension_not_enabled/)
  invoke(['scene-generator', 'enable', '--ide', 'trae', '--local', '--base-url', 'http://127.0.0.1:1', '--json'], false)
  await assert.rejects(access(skill))
  const enable = ['scene-generator', 'enable', '--ide', 'trae', '--local', '--base-url', address, '--json']
  invoke(enable)
  invoke(enable)
  const text = await readFile(skill, 'utf8')
  assert(text.includes(cli))
  assert(!text.includes('{{CLI}}'))
  const exported = await exerciseScene(call, game)
  const invalidOptions = resolve(root, 'invalid-schema.json')
  await writeFile(invalidOptions, JSON.stringify({ schemaVersion: '1.0.0' }))
  await assert.rejects(call(['publish', '--project', exported.projectId, '--out', 'assets/rejected', '--options', invalidOptions]), /scene_engine_schema/)
  await assert.rejects(access(resolve(game, 'assets/rejected')))
  const published = await call(['publish', '--project', exported.projectId, '--out', 'assets/scene-generator/acceptance'])
  assert.equal(published.engine.version, '0.2.1')
  assert.equal(published.engine.authority, 'engine-build-catalog')
  assert.equal(published.sceneGuid, exported.sceneGuid)
  assert(published.engine.assets.some(asset => asset.kind === 'mesh'))
  assert(published.engine.assets.some(asset => asset.kind === 'texture'))
  const republished = await call(['publish', '--project', exported.projectId, '--out', 'assets/scene-generator/acceptance'])
  assert.equal(republished.sceneGuid, published.sceneGuid)
  const runtime = await useSceneGuid(published.sceneGuid)
  const pack = resolve(exported.path, exported.packFile)
  const bytes = await readFile(pack)
  await writeFile(skill, `${text}\nUser annotation\n`)
  const disabled = JSON.parse(invoke(['scene-generator', 'disable', '--json']))
  assert.equal(disabled.value.backups.length, 1)
  await assert.rejects(access(skill))
  assert((await readFile(disabled.value.backups[0], 'utf8')).includes('User annotation'))
  await assert.rejects(call(['doctor']), /extension_not_enabled/)
  invoke(['scene-generator', 'disable', '--json'])
  invoke(enable)
  invoke(['uninstall', '--ide', 'trae'])
  await assert.rejects(access(skill))
  await assert.rejects(access(resolve(game, '.forgeax/extensions/scene-generator')))
  assert.deepEqual(await readFile(pack), bytes)
  const evidence = { ok: true, cli, game, pack, meshCount: exported.meshCount, engine: published.engine, runtime, lifecycle: 'default disabled, enable, repeat, business, Engine publish, stable GUID, native scene loading, edited-skill backup, disable, repeat, re-enable, uninstall' }
  await writeFile(resolve(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} finally {
  if (server.connected) {
    const exited = once(server, 'exit')
    server.send('close')
    await exited
  }
}
