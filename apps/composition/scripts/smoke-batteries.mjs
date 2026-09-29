import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIRST_BATCH_OP_IDS, resolveSceneBatteryScanRoots } from '../backend/src/scene-script/firstBatchBatteries.ts'

const scanDirs = resolveSceneBatteryScanRoots()
const ids = []
for (const dir of scanDirs) {
  const contractPath = join(dir, 'scene.contract.ts')
  if (!existsSync(contractPath)) {
    console.error(`[smoke-batteries] missing scene.contract.ts: ${dir}`)
    process.exit(1)
  }
  if (existsSync(join(dir, 'meta.json'))) {
    console.error(`[smoke-batteries] leftover meta.json: ${dir}`)
    process.exit(1)
  }
  const source = readFileSync(contractPath, 'utf8')
  const id = source.match(/opId:\s*['"]([^'"]+)['"]/)?.[1]
  if (!id) {
    console.error(`[smoke-batteries] scene.contract.ts has no opId: ${dir}`)
    process.exit(1)
  }
  ids.push(id)
}
const missing = FIRST_BATCH_OP_IDS.filter((id) => !ids.includes(id))
const extra = ids.filter((id) => !FIRST_BATCH_OP_IDS.includes(id))
if (missing.length || extra.length || ids.length !== FIRST_BATCH_OP_IDS.length) {
  console.error('[smoke-batteries] first-batch mismatch', { ids, missing, extra })
  process.exit(1)
}
console.log('[smoke-batteries] OK — first-batch', ids.join(', '))
process.exit(0)
