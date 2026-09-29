#!/usr/bin/env node
/**
 * Live /health probes for source launchers. Uses unique ports so a running
 * Studio stack on 9555/9565/9575 is not disturbed.
 */
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = join(repoRoot, 'apps', 'composition')

test('bun serve proxies /health after workspace packages are ensured', { timeout: 90_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'forgeax-cold-serve-'))
  const frontendPort = 19151
  const backendPort = 19153
  const child = spawnLauncher(join(appRoot, 'scripts', 'serve-dist.mjs'), {
    cwd: appRoot,
    env: {
      ...process.env,
      VITE_DEV_PORT: String(frontendPort),
      PORT: String(backendPort),
      VITE_API_TARGET: `http://127.0.0.1:${backendPort}`,
      FORGEAX_PROJECT_ROOT: projectRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    await stopLauncher(child)
    rmSync(projectRoot, { recursive: true, force: true })
  })
  await waitForHttp(`http://127.0.0.1:${frontendPort}/health`, child)
  await verifyDiscovery(projectRoot, frontendPort, backendPort, child)
})

test('bun dev backend /health is up after workspace packages are ensured', { timeout: 90_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'forgeax-cold-dev-'))
  const frontendPort = 19161
  const backendPort = 19163
  const child = spawnLauncher(join(appRoot, 'scripts', 'dev.mjs'), {
    cwd: appRoot,
    env: {
      ...process.env,
      VITE_DEV_PORT: String(frontendPort),
      PORT: String(backendPort),
      VITE_API_TARGET: `http://127.0.0.1:${backendPort}`,
      FORGEAX_PROJECT_ROOT: projectRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    await stopLauncher(child)
    rmSync(projectRoot, { recursive: true, force: true })
  })
  await waitForHttp(`http://127.0.0.1:${backendPort}/health`, child)
  await verifyDiscovery(projectRoot, frontendPort, backendPort, child)
})

async function verifyDiscovery(projectRoot, frontendPort, backendPort, child) {
  const { check, run } = await import('../dist/extensions/scene-generator/cli.mjs')
  const context = { projectRoot, stateDir: join(projectRoot, '.forgeax/extensions/scene-generator'), packageVersion: '0.3.9' }
  const savedOrigin = process.env.FORGEAX_SCENE_BACKEND_URL
  process.env.FORGEAX_SCENE_BACKEND_URL = `http://127.0.0.1:${backendPort}`
  let config
  try {
    config = await check(context, [])
  } finally {
    if (savedOrigin === undefined) delete process.env.FORGEAX_SCENE_BACKEND_URL
    else process.env.FORGEAX_SCENE_BACKEND_URL = savedOrigin
  }
  mkdirSync(context.stateDir, { recursive: true })
  writeFileSync(join(context.stateDir, 'config.json'), JSON.stringify(config))
  const doctor = await run(context, ['doctor', '--json'])
  assert.equal(doctor.baseUrl, `http://127.0.0.1:${backendPort}`)
  assert.equal(doctor.uiUrl, `http://127.0.0.1:${frontendPort}/`)
  const page = await waitForHttp(doctor.uiUrl, child)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(await page.text(), /id="root"/)
}

async function waitForHttp(url, child) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const deadline = Date.now() + 80_000
  let lastError = ''
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`launcher exited ${child.exitCode} before /health\n${output}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  throw new Error(`${url} did not become healthy: ${lastError}\n${output}`)
}

function spawnLauncher(script, options) {
  return spawn('bun', [script], {
    ...options,
    detached: process.platform !== 'win32',
  })
}

async function stopLauncher(child) {
  if (child.pid == null) return

  const exited = child.exitCode != null || child.signalCode != null
    ? Promise.resolve()
    : once(child, 'exit')
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }

  const timeout = new Promise((resolveTimeout) => {
    const timer = setTimeout(resolveTimeout, 5_000)
    timer.unref()
  })
  await Promise.race([exited, timeout])
}
