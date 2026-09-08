#!/usr/bin/env node
/**
 * Live /health probes for source launchers. Uses unique ports so a running
 * Studio stack on 9555/9565/9575 is not disturbed.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = join(repoRoot, 'apps', 'wb-scene-generator')

test('bun serve proxies /health after workspace packages are ensured', { timeout: 90_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'forgeax-cold-serve-'))
  const frontendPort = 19151
  const backendPort = 19153
  const child = spawn(process.execPath, [join(appRoot, 'scripts', 'serve-dist.mjs')], {
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
  t.after(() => {
    child.kill('SIGTERM')
    rmSync(projectRoot, { recursive: true, force: true })
  })
  await waitForHealth(`http://127.0.0.1:${frontendPort}/health`, child)
})

test('bun dev backend /health is up after workspace packages are ensured', { timeout: 90_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'forgeax-cold-dev-'))
  const frontendPort = 19161
  const backendPort = 19163
  const child = spawn(process.execPath, [join(appRoot, 'scripts', 'dev.mjs')], {
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
  t.after(() => {
    child.kill('SIGTERM')
    rmSync(projectRoot, { recursive: true, force: true })
  })
  await waitForHealth(`http://127.0.0.1:${backendPort}/health`, child)
})

async function waitForHealth(url, child) {
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
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  throw new Error(`${url} did not become healthy: ${lastError}\n${output}`)
}
