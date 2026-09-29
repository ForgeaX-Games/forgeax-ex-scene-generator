#!/usr/bin/env node
// Line-count ratchet: CLAUDE.md §8 caps a source file at 800 lines. A rule that
// only lives in a doc is not a rule, so this turns it into a gate — and because
// the repo already has files over the cap, it is a ratchet rather than a wall:
//
//   - not in the baseline and > limit  → red (a new file may not be born oversized)
//   - in the baseline and grown        → red, printing the baseline it broke
//   - in the baseline and shrunk       → OK, prints the tightened baseline to paste
//   - in the baseline and gone / under → OK, prints that the entry can be dropped
//
// So an oversized file can only ever get smaller. Run standalone for the report
// (`node scripts/line-budget.mjs`); hygiene-check.mjs imports checkLineBudget()
// so there stays exactly one gate entry point.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
const BASELINE_PATH = join(REPO_ROOT, '.line-budget.json')

const GLOBS = ["'*.ts'", "'*.tsx'", "'*.mts'", "'*.mjs'"]
const EXCLUDE_PATHSPECS = [
  ':!obsolete/**',
  ':!release/**',
  ':!**/vendor/dist/**',
  ':!**/dist/**',
  ':!**/node_modules/**',
  ':!external/**',
]

// Tracked (index-visible) source files and their line counts.
export function measure() {
  const pathspec = [...GLOBS, ...EXCLUDE_PATHSPECS.map((p) => `'${p}'`)].join(' ')
  const files = execSync(`git ls-files -- ${pathspec}`, { encoding: 'utf-8', cwd: REPO_ROOT })
    .split('\n')
    .filter(Boolean)
  const counts = new Map()
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf-8')
    // Trailing newline does not start a line.
    const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    counts.set(file, lines)
  }
  return counts
}

export function checkLineBudget() {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  const { limit } = baseline
  const allowed = baseline.files
  const counts = measure()

  const born = []
  const grown = []
  const shrunk = []
  const stale = []

  for (const [file, lines] of counts) {
    const budget = allowed[file]
    if (budget === undefined) {
      if (lines > limit) born.push({ file, lines })
      continue
    }
    if (lines > budget) grown.push({ file, lines, budget })
    else if (lines < budget) shrunk.push({ file, lines, budget })
  }
  for (const file of Object.keys(allowed)) {
    const lines = counts.get(file)
    if (lines === undefined) stale.push({ file, reason: 'deleted' })
    else if (lines <= limit) stale.push({ file, reason: `now ${lines} <= ${limit}` })
  }

  if (born.length > 0) {
    console.error(`\n[line-budget] New file(s) over the ${limit}-line cap — split by responsibility:`)
    for (const { file, lines } of born) console.error(`  ${file}: ${lines} lines`)
  }
  if (grown.length > 0) {
    console.error('\n[line-budget] File(s) grew past their baseline — the ratchet only turns down:')
    for (const { file, lines, budget } of grown) {
      console.error(`  ${file}: ${lines} lines (baseline ${budget}, +${lines - budget})`)
    }
  }
  if (shrunk.length > 0) {
    console.log('\n[line-budget] Baseline can be tightened — paste into .line-budget.json:')
    for (const { file, lines, budget } of shrunk) {
      console.log(`  "${file}": ${lines},   // was ${budget}`)
    }
  }
  if (stale.length > 0) {
    console.log('\n[line-budget] Baseline entries to drop:')
    for (const { file, reason } of stale) console.log(`  ${file} (${reason})`)
  }

  return born.length + grown.length
}

// Standalone: report and exit non-zero on a ratchet violation.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = checkLineBudget()
  if (hits > 0) {
    console.error(`\n[line-budget] FAILED — ${hits} violation(s).`)
    process.exit(1)
  }
  console.log('[line-budget] OK')
}
