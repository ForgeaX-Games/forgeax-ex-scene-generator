import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExecutionContext } from '@forgeax/node-runtime'

const here = dirname(fileURLToPath(import.meta.url))
const IPC_LIMIT = 16 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_OLD_SPACE = 256

export interface SandboxRunRequest {
  bundlePath: string
  exportName: string
  args: Record<string, unknown>
  seed?: number
  timeoutMs?: number
  maxOldSpaceSize?: number
  ctx?: ExecutionContext
}

export interface SandboxRunResult {
  ok: boolean
  value?: unknown
  error?: string
  stack?: string
}

function childEntry(): string {
  const nextToHost = resolve(here, 'child.mjs')
  if (existsSync(nextToHost)) return nextToHost
  return resolve(here, '../../src/sandbox/child.mjs')
}

function permissionFlags(bundlePath: string): string[] {
  const artifactDir = dirname(bundlePath)
  const child = childEntry()
  const flags = [
    `--allow-fs-read=${artifactDir}`,
    `--allow-fs-read=${child}`,
    `--max-old-space-size=${DEFAULT_MAX_OLD_SPACE}`,
  ]
  return process.version.startsWith('v20.')
    ? ['--experimental-permission', ...flags]
    : ['--permission', ...flags]
}

function mapStack(stack: string | undefined, sourceMap?: string): string | undefined {
  if (!stack) return undefined
  if (!sourceMap) return stack
  return stack.replace(/bundle\.js:(\d+):(\d+)/g, (full) => `${full} (mapped via generator source map)`)
}

export async function runGeneratorSandbox(request: SandboxRunRequest): Promise<SandboxRunResult> {
  const payload = {
    bundlePath: request.bundlePath,
    exportName: request.exportName,
    args: request.args,
    seed: request.seed ?? 1,
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > IPC_LIMIT) {
    return { ok: false, error: 'IPC payload exceeds sandbox size limit.' }
  }
  const execArgv = permissionFlags(request.bundlePath)
  let child: ChildProcess
  try {
    child = fork(childEntry(), [], {
      execArgv,
      env: {},
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  return await new Promise<SandboxRunResult>((resolveResult) => {
    let settled = false
    const finish = (result: SandboxRunResult) => {
      if (settled) return
      settled = true
      if (child.connected) child.disconnect()
      if (!child.killed) child.kill('SIGKILL')
      resolveResult(result)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: `Generator sandbox timed out after ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.` })
    }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.on('message', (message: { type?: string; value?: unknown; message?: string; stack?: string; level?: string }) => {
      if (message.type === 'log') {
        request.ctx?.log((message.level as 'info') ?? 'info', String(message.message ?? ''))
        return
      }
      clearTimeout(timer)
      if (message.type === 'ok') finish({ ok: true, value: message.value })
      else finish({ ok: false, error: message.message ?? 'Generator sandbox failed.', stack: mapStack(message.stack) })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: error.message })
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (settled) return
      finish({
        ok: false,
        error: signal
          ? `Generator sandbox killed (${signal}).`
          : `Generator sandbox exited with code ${code ?? 'unknown'}.`,
      })
    })
    child.send(payload)
  })
}
