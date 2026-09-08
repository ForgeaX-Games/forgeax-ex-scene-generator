#!/usr/bin/env node
/**
 * Consumer-side release acceptance. Every candidate is packed exactly as npm
 * will publish it, installed in a directory outside this repository, then
 * started with Bun and probed through its public health endpoint.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { probeSceneAuthoring, probeSceneGeneration } from './probe-scene-authoring.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const staging = mkdtempSync(join(tmpdir(), 'forgeax-standalone-release-'))

try {
  await verify('scene-generator', 19000)
  console.log('[release] clean consumer verification passed for @forgeax-extension/scene-generator')
} finally {
  rmSync(staging, { recursive: true, force: true })
}

async function verify(slug, port) {
  const releaseDir = join(ROOT, 'release', slug)
  const consumerDir = join(staging, slug)
  const packed = execFileSync('npm', ['pack', '--json', '--pack-destination', staging], {
    cwd: releaseDir,
    encoding: 'utf8',
  })
  const [result] = JSON.parse(packed)
  const tarball = join(staging, result.filename)
  execFileSync('tar', ['-xzf', tarball, '-C', staging], { stdio: 'inherit' })
  execFileSync('mv', [join(staging, 'package'), consumerDir], { stdio: 'inherit' })
  execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: consumerDir, stdio: 'inherit' })
  execFileSync('bun', ['run', 'check:release'], { cwd: consumerDir, stdio: 'inherit' })

  const server = spawn('bun', ['run', 'serve'], {
    cwd: consumerDir,
    env: { ...process.env, VITE_DEV_PORT: String(port), PORT: String(port + 1) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.on('data', (chunk) => { output += String(chunk) })
  server.stderr.on('data', (chunk) => { output += String(chunk) })
  try {
    await waitForHealth(port, slug, () => output)
  } finally {
    server.kill('SIGTERM')
  }
  const composition = spawn('bun', ['modules/composition/dist/server/main.js'], {
    cwd: consumerDir,
    env: { ...process.env, PORT: String(port + 1), FORGEAX_PROJECT_ROOT: join(staging, 'authoring-workspace') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let compositionOutput = ''
  composition.stdout.on('data', (chunk) => { compositionOutput += String(chunk) })
  composition.stderr.on('data', (chunk) => { compositionOutput += String(chunk) })
  try {
    await waitForHealth(port + 1, 'composition', () => compositionOutput)
    await probeSceneAuthoring(`http://127.0.0.1:${port + 1}`)
    await probeSceneGeneration(`http://127.0.0.1:${port + 1}`)
  } catch (error) {
    throw new Error(`Composition authoring verification failed: ${error}\n${compositionOutput}`, { cause: error })
  } finally {
    composition.kill('SIGTERM')
  }
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
