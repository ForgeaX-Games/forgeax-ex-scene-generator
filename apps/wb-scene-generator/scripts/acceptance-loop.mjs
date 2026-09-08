// North-Star §8 (CLI flavour): drive the forgeax CLI headlessly over migrated
// batteries — create nodes, execute (NDJSON) — twice — and assert identical
// deterministic outputs across runs (determinism invariant).
//
// --batteries points at batteries/special (a clean migrated subset containing
// relu); the CLI's loadRuntime aborts on ANY scan error, and the full battery
// tree still has non-gated multi-file batteries pending the full-migration
// compile track, so we scope the CLI to a subset that loads cleanly.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Monorepo CLI bin: the kernel is now in-repo `workspace:*` packages (no
// `external/` submodule). scripts/ → app → apps → repo root, then packages/.
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const BIN = join(REPO_ROOT, 'packages', 'node-runtime-cli', 'dist', 'bin.js')
const BATTERIES = 'batteries/special'

function cli(projectRoot, args) {
  return execFileSync('node', [BIN, '--ndjson', '--project-root', projectRoot, '--batteries', BATTERIES, '--pipeline-id', 'accept', ...args], { encoding: 'utf-8' })
}

// Keep only the deterministic node outputs from the final result line.
function extractStable(ndjson) {
  for (const line of ndjson.split('\n').map((l) => l.trim()).filter(Boolean)) {
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    if (rec && rec.result && rec.result.outputs) {
      return JSON.stringify(rec.result.outputs)
    }
  }
  return ''
}

function buildAndExecute() {
  const root = mkdtempSync(join(tmpdir(), 'wb-scene-accept-'))
  cli(root, ['node', 'create', '--node-id', 'a', '--op', 'relu', '--params', '{"value":5}'])
  cli(root, ['node', 'create', '--node-id', 'b', '--op', 'relu', '--params', '{"value":-2}'])
  const out = cli(root, ['pipeline', 'execute'])
  rmSync(root, { recursive: true, force: true })
  return { stable: extractStable(out), raw: out }
}

const r1 = buildAndExecute()
const r2 = buildAndExecute()
if (!r1.stable) { console.error('extractStable captured nothing; raw output was:\n', r1.raw); process.exit(1) }
const h1 = createHash('sha256').update(r1.stable).digest('hex')
const h2 = createHash('sha256').update(r2.stable).digest('hex')
if (h1 !== h2) { console.error('NON-DETERMINISTIC:\n', r1.stable, '\n', r2.stable); process.exit(1) }
console.log('[acceptance-loop] OK — deterministic outputs', r1.stable, '| hash', h1.slice(0, 12))
