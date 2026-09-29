import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 9557
const START_TIMEOUT_MS = 60_000

let child: ChildProcess | undefined
let started: Promise<void> | undefined
let hostExitHooksInstalled = false

export function sceneBackendListenPort(): number {
  const parsed = Number(process.env.FORGEAX_SCENE_API_PORT ?? DEFAULT_PORT)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : DEFAULT_PORT
}

export function shouldSpawnSceneBackend(): boolean {
  return process.env.VITEST !== 'true'
    && process.env.VITEST_WORKER_ID === undefined
    && process.env.FORGEAX_SKIP_SCENE_BACKEND_SPAWN !== '1'
}

export function isTcpPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = createConnection({ host, port })
    const finish = (up: boolean) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(up)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(400, () => finish(false))
  })
}

export function stopSceneBackend(hard = false): void {
  const proc = child
  child = undefined
  started = undefined
  if (!proc?.pid || proc.exitCode != null) return
  try {
    proc.kill(hard ? 'SIGKILL' : 'SIGTERM')
  } catch {
    return
  }
  if (hard) return
  const pid = proc.pid
  const timer = setTimeout(() => {
    try {
      process.kill(pid, 0)
      proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, 2_000)
  timer.unref()
}

function installHostExitHooks(): void {
  if (hostExitHooksInstalled) return
  hostExitHooksInstalled = true
  process.on('exit', () => stopSceneBackend(true))
  process.on('SIGTERM', () => stopSceneBackend())
  process.on('SIGINT', () => stopSceneBackend())
}

/**
 * Stock Studio serves this authoring from `/extensions/scene-generator/` and
 * reverse-proxies `/api/v1/*` to :9557. `embeddedAlso: true` means `run.ts`
 * will not spawn `bun run dev`, so the host-loaded tool module starts the
 * composition HTTP server when it is missing.
 *
 * Spawn `bun run start` (tsx, no --watch). A file watcher would leak handles
 * for the life of Studio.
 */
export function ensureSceneBackend(port = sceneBackendListenPort()): Promise<void> {
  started ??= start(port)
  return started
}

function backendEnv(port: number): NodeJS.ProcessEnv {
  const inheritedNodeOptions = String(process.env.NODE_OPTIONS ?? '')
    .split(/\s+/)
    .filter((flag) => flag && !flag.startsWith('--max-old-space-size='))
    .join(' ')
  return {
    ...process.env,
    PORT: String(port),
    NODE_OPTIONS: [
      inheritedNodeOptions,
      '--conditions=source',
      '--max-old-space-size=24576',
    ].filter(Boolean).join(' '),
  }
}

async function start(port: number): Promise<void> {
  if (!shouldSpawnSceneBackend()) return
  if (await isTcpPortOpen(port)) return

  installHostExitHooks()
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  console.log(`[scene-generator] starting composition backend on :${port}`)
  const proc = spawn('bun', ['run', 'start'], {
    cwd,
    env: backendEnv(port),
    stdio: 'inherit',
  })
  child = proc
  proc.on('exit', (code, signal) => {
    if (code && code !== 0) {
      console.error(
        `[scene-generator] composition backend exited code=${code} signal=${signal ?? ''}`,
      )
    }
    if (child === proc) {
      child = undefined
      started = undefined
    }
  })

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isTcpPortOpen(port)) {
      console.log(`[scene-generator] composition backend ready on :${port}`)
      return
    }
    if (child?.exitCode != null) {
      started = undefined
      child = undefined
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  console.error(`[scene-generator] composition backend did not listen on :${port} within ${START_TIMEOUT_MS}ms`)
  stopSceneBackend()
}
