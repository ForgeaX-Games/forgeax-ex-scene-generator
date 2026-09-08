#!/usr/bin/env node
// Monorepo hygiene check: forbidden upstream terms + no ELF core dumps in the tree.
// Invoked from each app via `bun run hygiene` (see apps/*/package.json).

import { execSync } from 'node:child_process'
import { exit } from 'node:process'

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()

const FORBIDDEN_PATTERNS = [
  'g[r]asshopper',
  'd[e]vcloud',
  't[e]ncent',
]

const EXCLUDE_PATHSPECS = [
  ':!scripts/hygiene-check.mjs',
  ':!**/scripts/hygiene-check.mjs',
  ':!package.json',
  ':!**/package.json',
  ':!bun.lock',
  ':!**/bun.lock',
  ':!**/package-lock.json',
  ':!**/.npmrc',
  ':!.gitmodules',
  // Matches docs/superpowers/** at the repo root AND under every app
  // (apps/*/docs/superpowers/**) — these are human-historical planning/archive
  // docs that legitimately reference legacy upstream sources by name.
  ':(exclude,glob)**/docs/superpowers/**',
  ':!.git',
  ':!node_modules',
  ':!**/node_modules',
  ':!dist',
  ':!**/dist',
  ':!external',
  ':!external/**',
]

let totalHits = 0

for (const pattern of FORBIDDEN_PATTERNS) {
  try {
    const cmd = `git grep -inIE "${pattern}" -- ${EXCLUDE_PATHSPECS.map((p) => `'${p}'`).join(' ')}`
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT })
    if (out.trim()) {
      console.error(`\n[hygiene] Forbidden pattern hits for /${pattern}/:`)
      console.error(out)
      totalHits += out.split('\n').filter((l) => l).length
    }
  } catch (e) {
    if (e.status !== 1) {
      console.error(`[hygiene] git grep failed for ${pattern}:`, e.stderr?.toString() ?? e.message)
      exit(2)
    }
  }
}

// Crash core dumps (core.<pid>) pollute the working tree and can reach multi-GB.
// .gitignore already lists core.* — this guard catches them before they linger locally/CI.
try {
  const findCmd =
    "find . -regextype posix-extended -regex '.*/core\\.[0-9]+' -type f ! -path '*/node_modules/*' 2>/dev/null || true"
  const dumps = execSync(findCmd, { encoding: 'utf-8', cwd: REPO_ROOT })
    .trim()
    .split('\n')
    .filter(Boolean)
  if (dumps.length > 0) {
    console.error('\n[hygiene] ELF core dump(s) found — delete before committing:')
    for (const p of dumps) console.error(`  ${p}`)
    totalHits += dumps.length
  }
} catch (e) {
  console.error('[hygiene] core-dump scan failed:', e.message)
  exit(2)
}

if (totalHits > 0) {
  console.error(`\n[hygiene] FAILED — ${totalHits} issue(s). Fix before committing.`)
  exit(1)
}

console.log('[hygiene] OK — no forbidden terms, no core dumps.')
