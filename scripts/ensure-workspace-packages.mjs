#!/usr/bin/env node
/**
 * Cold-start helper: Studio / a fresh clone has no packages/<pkg>/dist.
 * @forgeax/i18n exports only ./dist (no source condition), so serve-dist
 * and dev must build workspace packages from the monorepo root — never from
 * the app directory, where Bun's workspace filter matches nothing.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const FILTER_ARGS = ['run', 'build:packages']

export function findMonorepoRoot(startDir) {
  let dir = resolve(startDir)
  for (let i = 0; i < 16; i += 1) {
    const packagePath = join(dir, 'package.json')
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
        if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0) return dir
      } catch {
        // Keep walking when a nested package manifest is incomplete.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`package.json workspace root not found walking up from ${startDir}`)
}

export function ensureWorkspacePackages(startDir, options = {}) {
  const spawn = options.spawnSync ?? spawnSync
  const monorepoRoot = findMonorepoRoot(startDir)
  console.log(`[ensure-workspace-packages] bun ${FILTER_ARGS.join(' ')} (cwd=${monorepoRoot})`)
  const result = spawn('bun', FILTER_ARGS, {
    cwd: monorepoRoot,
    stdio: options.stdio ?? 'inherit',
    shell: process.platform === 'win32',
  })
  if (result?.error) {
    if (options.exit === false) throw result.error
    console.error(`[ensure-workspace-packages] spawn failed: ${result.error.message}`)
    process.exit(1)
  }
  const status = result?.status ?? 1
  if (status !== 0) {
    const error = new Error(`workspace package build failed (${status})`)
    if (options.exit === false) throw error
    process.exit(status)
  }
  return monorepoRoot
}

export { FILTER_ARGS }
