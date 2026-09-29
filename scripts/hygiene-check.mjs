#!/usr/bin/env node
// Monorepo hygiene check: forbidden upstream terms, no ELF core dumps in the tree,
// browser requests routed through pluginHttp, and the file line-count ratchet.
// Invoked from each app via `bun run hygiene` (see apps/*/package.json).

import { execFileSync, execSync } from 'node:child_process'
import { exit } from 'node:process'

import { checkLineBudget } from './line-budget.mjs'

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
  // Append-only changelogs record historical names; do not rewrite them.
  ':!CHANGELOG.md',
  ':!**/CHANGELOG.md',
  ':!docs/changelog-archive/**',
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

// Browser-side requests must go through frontend/src/api/pluginHttp.ts. A bare
// `/api/v1/...` or `/ws` literal works in local dev (Vite proxies it) and breaks
// under Studio's /__fx-plugin/<slug>/ proxy, so it is a bug you only see after
// packaging. Studio's own host API (`/api/tools/call`) is intentionally bare and
// carries no /v1, so keying on `/api/v1` separates the two without an allowlist.
try {
  const pattern = "(fetch|EventSource|WebSocket|loadAsync|\\.load)\\(([\"'`])/(api/v1|ws)|(src|href)=\\{?([\"'`])/api/v1"
  const out = execFileSync('git', ['grep', '-nE', pattern, '--', 'apps/*/frontend/src/**', ':!**/__tests__/**'], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT,
  })
  if (out.trim()) {
    console.error('\n[hygiene] Browser request bypasses pluginHttp.ts (use pluginFetch / pluginUrl / pluginWsUrl):')
    console.error(out)
    totalHits += out.split('\n').filter((l) => l).length
  }
} catch (e) {
  if (e.status !== 1) {
    console.error('[hygiene] pluginHttp scan failed:', e.stderr?.toString() ?? e.message)
    exit(2)
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

// File line-count ratchet (CLAUDE.md §8's 800-line cap); lives in line-budget.mjs
// so the rule's own logic does not bloat this file, but reports through this gate.
totalHits += checkLineBudget()

if (totalHits > 0) {
  console.error(`\n[hygiene] FAILED — ${totalHits} issue(s). Fix before committing.`)
  exit(1)
}

console.log('[hygiene] OK — no forbidden terms, no core dumps, line budget held.')
