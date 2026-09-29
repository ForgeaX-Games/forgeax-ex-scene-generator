import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'
import { prepareRuntime } from './runtime.mjs'

export async function location(workspace) {
  const directory = await realpath(workspace)
  const key = createHash('sha256').update(directory).digest('hex').slice(0, 20)
  const dataRoot = resolve(process.env.FORGEAX_SCENE_CODEX_DATA ?? join(homedir(), '.forgeax', 'scene-generator', 'codex'))
  const stateDir = join(dataRoot, key)
  await mkdir(stateDir, { recursive: true })
  return { workspace: directory, stateDir }
}

async function record(stateDir) {
  try { return JSON.parse(await readFile(join(stateDir, 'service.json'), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function healthy(state) {
  if (!state) return false
  let response
  try { response = await fetch(`${state.baseUrl}/health`, { signal: AbortSignal.timeout(2000) }) } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false
    throw error
  }
  if (!response.ok) throw new Error(`Scene Generator health returned HTTP ${response.status}; inspect ${state.log}`)
  const health = await response.json()
  if (health.instanceId !== state.instanceId) throw new Error(`Scene Generator service identity changed at ${state.baseUrl}`)
  return true
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function availablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

export async function serviceStatus(workspace) {
  const context = await location(workspace)
  const state = await record(context.stateDir)
  return { ...context, ...state, running: await healthy(state) }
}

export async function startService(root, workspace) {
  const context = await location(workspace)
  await prepareRuntime(root)
  const release = await lockfile.lock(context.stateDir, { retries: { retries: 120, minTimeout: 250, maxTimeout: 1000 } })
  try {
    const previous = await record(context.stateDir)
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const plugin = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'))
    if (await healthy(previous)) {
      if (previous.buildId !== plugin.version) throw new Error('Stop the previous Scene Generator build with the stop command before starting this build')
      return { ...previous, running: true, reused: true }
    }
    if (previous && alive(previous.pid)) throw new Error(`Scene Generator process ${previous.pid} is unavailable; inspect ${previous.log}`)
    const uiPort = await availablePort()
    let apiPort = await availablePort()
    while (apiPort === uiPort) apiPort = await availablePort()
    const instanceId = randomUUID()
    const log = join(context.stateDir, 'service.log')
    const uiUrl = `http://127.0.0.1:${uiPort}/`
    const baseUrl = `http://127.0.0.1:${apiPort}`
    const output = await open(log, 'w')
    const child = spawn(process.execPath, [join(root, 'serve.mjs')], {
      cwd: root, detached: true,
      env: { ...process.env, VITE_DEV_PORT: String(uiPort), PORT: String(apiPort), FORGEAX_PROJECT_ROOT: join(context.stateDir, 'projects'), FORGEAX_SCENE_UI_URL: uiUrl, FORGEAX_PLUGIN_BOOT_ID: instanceId },
      stdio: ['ignore', output.fd, output.fd],
    })
    await once(child, 'spawn')
    await output.close()
    const state = { ...context, pid: child.pid, instanceId, version: pkg.version, buildId: plugin.version, uiUrl, baseUrl, log }
    await writeFile(join(context.stateDir, 'service.json'), JSON.stringify(state, null, 2) + '\n')
    await writeFile(join(context.stateDir, 'config.json'), JSON.stringify({ baseUrl }) + '\n')
    try {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Scene Generator exited during startup: ${await readFile(log, 'utf8')}`)
        if (await healthy(state)) {
          const ui = await fetch(uiUrl, { signal: AbortSignal.timeout(2000) })
          if (!ui.ok) throw new Error(`Scene Generator UI returned HTTP ${ui.status}`)
          await ui.body.cancel()
          child.unref()
          return { ...state, running: true, reused: false }
        }
        await delay(150)
      }
      throw new Error(`Scene Generator startup exceeded 30 seconds; inspect ${log}`)
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited
      }
      throw error
    }
  } finally {
    await release()
  }
}

export async function stopService(workspace) {
  const context = await location(workspace)
  const release = await lockfile.lock(context.stateDir)
  try {
    const state = await record(context.stateDir)
    if (await healthy(state)) {
      process.kill(state.pid, 'SIGTERM')
      const deadline = Date.now() + 10_000
      while (alive(state.pid) && Date.now() < deadline) await delay(100)
      if (alive(state.pid)) throw new Error(`Scene Generator did not stop; inspect ${state.log}`)
    } else if (state && alive(state.pid)) {
      throw new Error(`Cannot verify the running service owner; inspect ${state.log}`)
    }
    await rm(join(context.stateDir, 'service.json'), { force: true })
    return { ...context, running: false }
  } finally {
    await release()
  }
}
