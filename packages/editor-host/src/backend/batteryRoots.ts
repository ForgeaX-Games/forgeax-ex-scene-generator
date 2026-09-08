// Decides which directories an app backend should scan for battery (op) folders.

import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

// Locates the shared common-battery directory: it ships bundled inside the @forgeax/batteries-common workspace package, with a fallback to the pre-monorepo sibling/submodule layout for older checkouts.
function resolveSharedBatteriesDir(repoRoot: string): string | null {
  try {
    const req = createRequire(import.meta.url)
    const pkgJson = req.resolve('@forgeax/batteries-common/package.json')
    const dir = resolve(dirname(pkgJson), 'batteries')
    if (existsSync(dir)) return dir
  } catch {
    // fall through to legacy probes (pre-monorepo layout)
  }
  const candidates = [
    // A standalone release keeps common batteries beside the app batteries
    // rather than recreating the development workspace's node_modules links.
    resolve(repoRoot, 'shared-batteries'),
    resolve(repoRoot, 'external', 'forgeax-wb-node-core', 'packages', 'batteries-common', 'batteries'),
    resolve(repoRoot, '..', 'forgeax-wb-node-core', 'packages', 'batteries-common', 'batteries'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

// Public API: the ordered list of roots a backend scans — the shared common batteries (when present) followed by the app's own repo-local batteries.
export function resolveBatteryScanRoots(repoRoot: string): string[] {
  const roots: string[] = []
  const shared = resolveSharedBatteriesDir(repoRoot)
  if (shared) roots.push(shared)
  roots.push(resolve(repoRoot, 'batteries'))
  return roots
}
