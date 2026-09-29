import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { probeStandaloneUi } from './probe-standalone-ui.mjs'
import { exerciseScene } from '../extensions/scene-generator/test/business.mjs'

const execute = promisify(execFile)

export async function probeCodexPlugin(packageRoot, staging) {
  const workspace = join(staging, 'codex-workspace')
  const env = { ...process.env, FORGEAX_SCENE_CODEX_DATA: join(staging, 'codex-data') }
  await mkdir(workspace, { recursive: true })
  async function cli(...args) {
    const { stdout } = await execute(process.execPath, [join(packageRoot, 'codex/cli.mjs'), ...args, '--json'], { cwd: workspace, env, timeout: 120_000 })
    const result = JSON.parse(stdout)
    assert.equal(result.ok, true)
    return result.value
  }
  assert.equal((await cli('status')).running, false)
  let socket
  try {
    const started = await Promise.all([cli('start'), cli('start')])
    assert.equal(started[0].pid, started[1].pid, 'Concurrent calls must share one service')
    assert.deepEqual(started.map(service => service.reused).sort(), [false, true])
    const service = started[0]
    const doctor = await cli('doctor')
    assert.equal(doctor.uiUrl, service.uiUrl)
    const exported = await exerciseScene(args => cli(...args), workspace)
    assert(exported.sceneGuid)
    await probeStandaloneUi(service.uiUrl.replace(/\/$/, ''))
    const projects = await cli('projects')
    const project = projects.find(item => item.name === 'Release acceptance')
    assert(project)
    const view = await cli('view', '--project', project.id)
    assert.equal(new URL(view.uiUrl).searchParams.get('projectId'), project.id)
    const before = await cli('info', '--project', project.id)
    const pending = await cli('completion', '--project', project.id)
    assert.equal(pending.ok, false)
    assert(pending.reasons.includes('renderer-no-visible-output'))
    assert.equal((await cli('info', '--project', project.id, `--workspace=${workspace}`)).projectRevision, before.projectRevision)
    socket = new WebSocket(service.uiUrl.replace('http:', 'ws:') + 'ws')
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(15_000) })
    assert.equal((await cli('stop')).running, false)
    await closed
    socket = null
    assert.equal((await cli('status')).running, false)
    const restarted = await cli('start')
    assert.notEqual(restarted.instanceId, service.instanceId)
    const after = await cli('info', '--project', project.id)
    assert.equal(after.projectRevision, before.projectRevision)
    const execution = await cli('execute', '--project', project.id)
    assert.equal(execution.status, 'completed')
    console.log('[release] Codex CLI concurrent startup, authoring, live connection shutdown, and persistent restart passed')
  } finally {
    socket?.close()
    await cli('stop')
  }
}
