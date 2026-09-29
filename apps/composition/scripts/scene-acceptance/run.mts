#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getSceneContractRegistry } from '../../backend/src/scene-script/contracts/contracts.js'
import {
  compileSceneGroupDefinition,
  hasGroupCapability,
  parseAtomicContractSource,
  parseSceneModule,
  printSceneModule,
  resolveAtomicContract,
  sealGroupContract,
} from '../../../../packages/scene-authoring/src/index.ts'
import {
  execute,
  parseArgs,
  readJson,
  selectCells,
  validateInventory,
  writeCheckpoint,
} from './runner-core.mjs'
import { buildSourceMapEvidence } from './source-map-evidence.mts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..', '..')
const extensionRoot = resolve(appRoot, '..', '..')

function kebab(value: string): string {
  return value.normalize('NFKD').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().split(/\s+/)
    .filter(Boolean).map((part) => part.toLowerCase()).join('-') || 'group'
}

async function buildRoundTripEvidence(inventory: any, registry: any): Promise<Record<string, any>> {
  const evidence: Record<string, any> = {}
  for (const entry of inventory.entries ?? []) {
    const cellId = entry.cellId ?? entry.opId
    if (entry.status === 'retired-test-oracle') continue
    if (entry.kind === 'atomic') {
      const contractPath = resolve(extensionRoot, dirname(entry.metaPath), 'scene.contract.ts')
      const source = await readFile(contractPath, 'utf8')
      const first = parseAtomicContractSource(source, contractPath)
      const second = parseAtomicContractSource(source, contractPath)
      if (first.diagnostics.length || second.diagnostics.length ||
          JSON.stringify(first.contracts) !== JSON.stringify(second.contracts)) continue
      const reverseFunctions = first.contracts.map((item) =>
        resolveAtomicContract(registry, item.opId, item.runtimeDefaults ?? {})?.functionName)
      if (reverseFunctions.some((name, index) => name !== first.contracts[index].functionName)) continue
      evidence[cellId] = {
        roundTrip: {
          source: entry.metaPath.replace(/meta\.json$/, 'scene.contract.ts'),
          contractFunctions: first.contracts.map((item) => item.functionName),
          staticParseStable: true,
        },
        graphWriteBack: {
          opId: entry.opId,
          reverseFunctions,
          ambiguousFallbackAllowed: false,
        },
        capability: {
          facades: first.contracts.map((item) => ({
            functionName: item.functionName,
            agentVisible: item.agentVisible !== false,
            scope: item.definitionScope ?? 'top-level',
          })),
          enforcement: 'Contract visibility and definitionScope are compiler-enforced.',
        },
      }
      continue
    }
    const inventoryPath = resolve(extensionRoot, entry.source)
    // Native Definitions are now the inventory source of truth. Keep the
    // generated-JSON conversion only so older external inventories fail through
    // the normal parity checks instead of resolving a doubled `.scene.ts` name.
    const scenePath = entry.source.endsWith('.scene.ts')
      ? inventoryPath
      : resolve(dirname(inventoryPath), `${kebab(basename(inventoryPath, '.generated.json'))}.scene.ts`)
    const source = await readFile(scenePath, 'utf8')
    const first = parseSceneModule(source, { file: scenePath, registry })
    const printed = printSceneModule(first.module)
    const second = parseSceneModule(printed, { file: scenePath, registry })
    const compiled = first.module.definitions.map((definition) => compileSceneGroupDefinition(definition, registry))
    if (first.diagnostics.length || second.diagnostics.length ||
        compiled.some((result) => result.diagnostics.length || !result.contract) ||
        printSceneModule(second.module) !== printed) continue
    const sealedContracts = compiled.map((result) => sealGroupContract(result.contract!))
    const sealedPolicyValid = sealedContracts.every((contract) =>
      hasGroupCapability(contract, 'agent', 'configure') &&
      hasGroupCapability(contract, 'agent', 'observeSummary') &&
      !hasGroupCapability(contract, 'agent', 'inspectDefinition') &&
      !hasGroupCapability(contract, 'agent', 'editDefinition') &&
      !hasGroupCapability(contract, 'agent', 'connectInternalPort') &&
      hasGroupCapability(contract, 'user', 'inspectDefinition') &&
      hasGroupCapability(contract, 'template-maintainer', 'editDefinition'))
    if (!sealedPolicyValid) continue
    evidence[cellId] = {
      roundTrip: {
        source: entry.source.endsWith('.scene.ts')
          ? entry.source
          : entry.source.replace(/\.json$/, '.scene.ts'),
        definitionIds: first.module.definitions.map((item) => item.meta.id),
        canonicalPrintStable: true,
      },
      graphWriteBack: {
        publicInputs: sealedContracts.flatMap((contract) => contract.inputs.map((port) => ({
          name: port.name,
          runtimePort: port.runtimePort ?? port.name,
        }))),
        publicOutputs: sealedContracts.flatMap((contract) => contract.outputs.map((port) => ({
          name: port.name,
          runtimePort: port.runtimePort ?? port.name,
        }))),
        sealedInternalsRejected: true,
      },
      capability: {
        policy: 'sealed-definition',
        agent: ['configure', 'observeSummary'],
        deniedToAgent: ['inspectDefinition', 'editDefinition', 'connectInternalPort'],
        user: ['inspectDefinition'],
        templateMaintainer: ['editDefinition'],
      },
    }
  }
  return evidence
}

function usage(): string {
  return [
    'Usage: bunx tsx scripts/scene-acceptance/run.mts [options]',
    '',
    '  --inventory <path>     inventory JSON (default: acceptance/inventory/scene-script-battery-inventory.json)',
    '  --promoted <path>      promotion ledger (default: acceptance/promoted.json)',
    '  --checkpoint <path>    checkpoint output (default: acceptance/.checkpoints/latest.json)',
    '  --batch <id[,id]>      select inventory batches',
    '  --cell <id[,id]>       select inventory cells',
    '  --resume               keep passed cells from the checkpoint',
    '  --retry-failed         run only failed checkpoint cells (implies --resume)',
    '  --json                 print the complete checkpoint',
  ].join('\n')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const inventoryPath = resolve(
    process.cwd(),
    options.inventory ?? resolve(appRoot, 'acceptance', 'inventory', 'scene-script-battery-inventory.json'),
  )
  const promotedPath = resolve(process.cwd(), options.promoted ?? resolve(appRoot, 'acceptance', 'promoted.json'))
  const checkpointPath = resolve(process.cwd(), options.checkpoint ?? resolve(appRoot, 'acceptance', '.checkpoints', 'latest.json'))
  const [inventory, promoted, registry] = await Promise.all([
    readJson(inventoryPath, 'inventory'),
    readJson(promotedPath, 'promoted.json'),
    getSceneContractRegistry(),
  ])
  const previous = options.resume
    ? await readJson(checkpointPath, 'resume checkpoint').catch((error) => {
      if (options.retryFailed) throw error
      return undefined
    })
    : undefined
  const selectedCells = selectCells(validateInventory(inventory), options, previous)
  const selectedIds = new Set<string>(selectedCells.map((cell: any) => String(cell.id)))
  console.log(`scene acceptance: loading ${selectedIds.size} selected cell(s)`)
  const roundTripEvidence = await buildRoundTripEvidence(inventory, registry)
  console.log('scene acceptance: round-trip evidence ready')
  const sourceMapEvidence = await buildSourceMapEvidence(inventory, registry, extensionRoot)
  console.log('scene acceptance: source-map evidence ready')
  const gateEvidence = { ...roundTripEvidence }
  for (const [cellId, evidence] of Object.entries(sourceMapEvidence)) {
    gateEvidence[cellId] = { ...(gateEvidence[cellId] ?? {}), ...evidence }
  }

  const checkpoint = await execute({
    inventory,
    promoted,
    promotedPath,
    options,
    contracts: registry.list(),
    gateEvidence,
    previous,
  })
  await writeCheckpoint(checkpointPath, checkpoint)

  if (options.json) console.log(JSON.stringify(checkpoint, null, 2))
  else {
    const counts = Object.values(checkpoint.cells).reduce<Record<string, number>>((result, cell: any) => {
      result[cell.status] = (result[cell.status] ?? 0) + 1
      return result
    }, {})
    console.log(`scene acceptance: ${checkpoint.status}`)
    console.log(`cells: pass=${counts.pass ?? 0} pending=${counts.pending ?? 0} failed=${counts.failed ?? 0}`)
    console.log(`promoted evidence: ${checkpoint.promotionConsistency.status}`)
    console.log(`checkpoint: ${checkpointPath}`)
  }

  if (checkpoint.status === 'failed') process.exitCode = 1
  else if (checkpoint.status === 'pending') process.exitCode = 2
}

main().catch((error) => {
  console.error(`scene acceptance runner failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
