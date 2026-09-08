#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backendRoot = resolve(pluginRoot, 'backend')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR
  ?? resolve(pluginRoot, '.cache', 'acceptance', `sino-self-${stamp}`)
mkdirSync(evidenceDir, { recursive: true })

const tests = [
  'tests/tool-handlers.test.ts',
  'tests/readDedupe.test.ts',
  'tests/sceneCompletion.test.ts',
  'tests/sinoAgentContract.test.ts',
  'tests/sceneScriptScaffold.test.ts',
  'tests/sinoFreshProjectFlow.test.ts',
  'src/scene-script/contracts/agentContractCatalog.test.ts',
  'src/scene-script/persist/store.test.ts',
]

const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', ...tests],
  {
    cwd: backendRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
    },
  },
)

writeFileSync(resolve(evidenceDir, 'vitest-status.json'), `${JSON.stringify({
  ok: result.status === 0,
  status: result.status,
  tests,
  evidenceDir,
  at: new Date().toISOString(),
}, null, 2)}\n`)

if (result.status !== 0) {
  console.error(`[accept:sino-self] failed; evidence: ${evidenceDir}`)
  process.exit(result.status === null ? 1 : result.status)
}
console.log(`[accept:sino-self] OK; evidence: ${evidenceDir}`)
