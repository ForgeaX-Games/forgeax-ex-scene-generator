#!/usr/bin/env node
/**
 * Consumer-side release acceptance. Every candidate is packed exactly as npm
 * will publish it, installed in an isolated consumer directory, then
 * started with Bun and exercised through its public UI, HTTP and WebSocket routes.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { probeStandaloneUi } from './probe-standalone-ui.mjs'
import { once } from 'node:events'
import { probeCodexPlugin } from './probe-codex-plugin.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const scratch = join(ROOT, '.scratch-repro', 'standalone-release')
mkdirSync(scratch, { recursive: true })
const staging = mkdtempSync(join(scratch, 'consumer-'))

try {
  await verify('scene-generator', 19000)
  console.log('[release] clean consumer verification passed for @forgeax-extension/scene-generator')
} finally {
  rmSync(staging, { recursive: true, force: true })
}

async function verify(slug, port) {
  const releaseDir = join(ROOT, 'release', slug)
  const consumerDir = join(staging, slug)
  mkdirSync(consumerDir)
  const packed = execFileSync('npm', ['pack', '--json', '--pack-destination', staging], {
    cwd: releaseDir,
    encoding: 'utf8',
  })
  const [result] = JSON.parse(packed)
  const tarball = join(staging, result.filename)
  execFileSync('npm', ['install', '--prefix', consumerDir, '--workspaces=false', '--no-audit', '--no-fund', tarball], { cwd: consumerDir, stdio: 'inherit' })
  const packageRoot = join(consumerDir, 'node_modules/@forgeax-extension/scene-generator')
  execFileSync('bun', ['run', 'check:release'], { cwd: packageRoot, stdio: 'inherit' })

  const server = spawn('bun', ['run', 'serve'], {
    cwd: packageRoot,
    env: { ...process.env, VITE_DEV_PORT: String(port), PORT: String(port + 1), FORGEAX_PROJECT_ROOT: join(staging, 'authoring-workspace') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += String(chunk) })
  server.stderr.on('data', (chunk) => { output += String(chunk) })
  try {
    await waitForHealth(port, slug, () => output)
    await probeStandaloneUi(`http://127.0.0.1:${port}`)
  } catch (error) {
    throw new Error(`Installed package verification failed: ${error}\n${output}`, { cause: error })
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit')
      server.kill('SIGTERM')
      await exited
    }
  }
  await probeCodexPlugin(packageRoot, staging)
}

async function waitForHealth(port, slug, output) {
  const deadline = Date.now() + 20_000
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error(`${slug} did not become healthy: ${lastError}\n${output()}`)
}
