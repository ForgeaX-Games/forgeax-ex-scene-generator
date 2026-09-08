import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export const GATES = Object.freeze([
  'contract',
  'roundTrip',
  'graphWriteBack',
  'execute',
  'sourceMap',
  'capability',
  'visual',
])

const IMPLEMENTED_GATES = new Set(['contract', 'roundTrip', 'graphWriteBack', 'execute', 'sourceMap', 'capability', 'visual'])

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function parseArgs(argv) {
  const options = {
    batches: [],
    cells: [],
    resume: false,
    retryFailed: false,
    json: false,
  }
  const valueFlags = new Map([
    ['--inventory', 'inventory'],
    ['--promoted', 'promoted'],
    ['--checkpoint', 'checkpoint'],
    ['--visual-evidence', 'visualEvidence'],
  ])
  const listFlags = new Map([
    ['--batch', 'batches'],
    ['--cell', 'cells'],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--resume') options.resume = true
    else if (argument === '--retry-failed') options.retryFailed = true
    else if (argument === '--json') options.json = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (valueFlags.has(argument) || listFlags.has(argument)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      index += 1
      if (valueFlags.has(argument)) options[valueFlags.get(argument)] = value
      else options[listFlags.get(argument)].push(...value.split(',').filter(Boolean))
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  if (options.retryFailed) options.resume = true
  return options
}

export function validateInventory(inventory) {
  if (inventory?.schemaVersion !== 1) throw new Error('inventory.schemaVersion must be 1')
  const cells = Array.isArray(inventory.cells)
    ? inventory.cells
    : Array.isArray(inventory.entries)
      ? inventory.entries.map((entry) => ({
        id: entry.cellId ?? entry.opId,
        batch: entry.kind,
        batchAliases: [
          entry.kind,
          entry.category,
          entry.category?.split('/')[0],
          ...(entry.kind === 'atomic' ? [entry.category?.split('/')[1]] : []),
        ].filter(Boolean),
        inventoryStatus: entry.status,
        source: entry.source ?? entry.metaPath,
        contract: {
          functionName: entry.functionNameSuggestion,
          functionNames: entry.functionNames,
          inventoryEntry: entry,
        },
      }))
      : undefined
  if (!cells?.length) throw new Error('inventory must contain a non-empty cells or entries array')
  const ids = new Set()
  for (const cell of cells) {
    if (!cell?.id || !cell?.batch || !cell?.contract?.functionName) {
      throw new Error('each inventory cell needs id, batch, and contract.functionName')
    }
    if (ids.has(cell.id)) throw new Error(`duplicate inventory cell: ${cell.id}`)
    ids.add(cell.id)
  }
  return { schemaVersion: inventory.schemaVersion, cells }
}

export function selectCells(inventory, options, previous) {
  const batchSet = new Set(options.batches)
  const cellSet = new Set(options.cells)
  const unknownCells = [...cellSet].filter((id) => !inventory.cells.some((cell) => cell.id === id))
  if (unknownCells.length) throw new Error(`unknown --cell: ${unknownCells.join(', ')}`)
  const knownBatches = new Set(inventory.cells.flatMap((cell) => cell.batchAliases ?? [cell.batch]))
  const unknownBatches = [...batchSet].filter((id) => !knownBatches.has(id))
  if (unknownBatches.length) throw new Error(`unknown --batch: ${unknownBatches.join(', ')}`)

  let selected = inventory.cells.filter((cell) =>
    (batchSet.size === 0 || (cell.batchAliases ?? [cell.batch]).some((batch) => batchSet.has(batch))) &&
    (cellSet.size === 0 || cellSet.has(cell.id)))

  if (options.retryFailed) {
    if (!previous) throw new Error('--retry-failed requires an existing checkpoint')
    selected = selected.filter((cell) => previous.cells?.[cell.id]?.status === 'failed')
  } else if (options.resume && previous) {
    selected = selected.filter((cell) => previous.cells?.[cell.id]?.status !== 'pass')
  }
  return selected
}

function contractProjection(contract) {
  const keys = [
    'functionName', 'kind', 'contractVersion', 'opId', 'description', 'inputs', 'outputs',
    'effects', 'deterministic', 'agentVisible', 'definitionScope', 'runtimeDefaults',
    'definitionId', 'definitionVersion',
  ]
  return Object.fromEntries(keys.filter((key) => contract[key] !== undefined).map((key) => [key, contract[key]]))
}

export function runContractGate(cell, contracts) {
  if (cell.inventoryStatus && cell.inventoryStatus !== 'ready') {
    return { status: 'failed', reason: `inventory entry is not contract-ready: ${cell.inventoryStatus}` }
  }
  const entry = cell.contract.inventoryEntry
  const matches = entry?.kind === 'atomic'
    ? contracts.filter((item) => item.kind === 'atomic' && item.opId === entry.opId)
    : contracts.filter((item) => item.functionName === cell.contract.functionName)
  if (matches.length === 0) {
    return { status: 'failed', reason: `contract not found: ${entry?.opId ?? cell.contract.functionName}` }
  }
  const actual = matches.length === 1 ? contractProjection(matches[0]) : matches.map(contractProjection)
  const expected = cell.contract.expected
  if (expected && canonicalJson(actual) !== canonicalJson(expected)) {
    return {
      status: 'failed',
      reason: 'live Contract Registry projection differs from inventory',
      evidence: { expected, actual },
      evidenceDigest: digest({ expected, actual }),
    }
  }
  const mismatches = entry
    ? [
      matches.some((contract) => contract.kind !== entry.kind) && `kind expected ${entry.kind}`,
      entry.kind === 'atomic' && matches.some((contract) => entry.opId !== contract.opId) && `opId expected ${entry.opId}`,
      entry.functionNames?.length && canonicalJson(matches.map((contract) => contract.functionName).sort()) !== canonicalJson([...entry.functionNames].sort())
        && `function variants differ from co-located Contract`
    ].filter(Boolean)
    : []
  if (mismatches.length) {
    return {
      status: 'failed',
      reason: `live contract disagrees with inventory: ${mismatches.join('; ')}`,
      evidence: { inventory: entry, actual },
      evidenceDigest: digest({ inventory: entry, actual }),
    }
  }
  return {
    status: 'pass',
    reason: expected
      ? 'inventory matches the live Contract Registry projection'
      : 'inventory identity matches a live Contract Registry entry',
    evidence: actual,
    evidenceDigest: digest(actual),
  }
}

export function runCell(cell, contracts, gateEvidence = {}) {
  if (cell.inventoryStatus === 'retired-test-oracle') {
    return {
      id: cell.id,
      batch: cell.batch,
      status: 'retired',
      gates: Object.fromEntries(GATES.map((gate) => [gate, {
        status: 'skipped',
        reason: 'Historical test-only JSON oracle is excluded from the production Registry.',
      }])),
    }
  }
  const gates = {}
  for (const gate of GATES) {
    if (gate === 'contract') gates[gate] = runContractGate(cell, contracts)
    else if (IMPLEMENTED_GATES.has(gate)) {
      const evidence = gateEvidence[cell.id]?.[gate]
      gates[gate] = evidence
        ? evidence.status
          ? {
            ...evidence,
            ...(evidence.evidence === undefined ? {} : { evidenceDigest: digest(evidence.evidence) }),
          }
          : {
            status: 'pass',
            reason: `${gate} evidence was reproduced from the canonical source`,
            evidence,
            evidenceDigest: digest(evidence),
          }
        : { status: 'failed', reason: `missing reproducible ${gate} evidence` }
    } else gates[gate] = { status: 'pending', reason: `${gate} gate is not implemented by this runner` }
  }
  const status = Object.values(gates).some((gate) => gate.status === 'failed')
    ? 'failed'
    : Object.values(gates).some((gate) => gate.status === 'pending')
      ? 'pending'
      : 'pass'
  return { id: cell.id, batch: cell.batch, status, gates }
}

export async function validatePromoted(promoted, inventory, promotedPath) {
  if (promoted?.schemaVersion !== 1 || !Array.isArray(promoted.promotions)) {
    return { status: 'failed', errors: ['promoted.json must have schemaVersion 1 and a promotions array'] }
  }
  const cells = new Set(inventory.cells.map((cell) => cell.id))
  const errors = []
  const seen = new Set()
  const expectedCoverage = {}
  const inventoryById = new Map(inventory.cells.map((cell) => [cell.id, cell]))
  for (const promotion of promoted.promotions) {
    if (!promotion?.cellId || !promotion?.checkpoint || !promotion?.evidenceDigest) {
      errors.push('each promotion needs cellId, checkpoint, and evidenceDigest')
      continue
    }
    if (seen.has(promotion.cellId)) errors.push(`duplicate promotion: ${promotion.cellId}`)
    seen.add(promotion.cellId)
    if (!cells.has(promotion.cellId)) errors.push(`promotion references unknown cell: ${promotion.cellId}`)
    const checkpointPath = isAbsolute(promotion.checkpoint)
      ? promotion.checkpoint
      : resolve(dirname(promotedPath), promotion.checkpoint)
    let checkpoint
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
    } catch (error) {
      errors.push(`cannot read promotion checkpoint for ${promotion.cellId}: ${error.message}`)
      continue
    }
    const result = checkpoint.cells?.[promotion.cellId]
    if (!result) {
      errors.push(`checkpoint has no result for promoted cell: ${promotion.cellId}`)
      continue
    }
    const gateStatuses = GATES.map((gate) => result.gates?.[gate]?.status)
    if (result.status !== 'pass' || gateStatuses.some((status) => status !== 'pass')) {
      errors.push(`promoted cell does not have seven passing gates: ${promotion.cellId}`)
    }
    for (const gate of GATES) {
      const evidence = result.gates?.[gate]
      if (evidence?.status === 'pass' && (
        evidence.evidence === undefined ||
        evidence.evidenceDigest !== digest(evidence.evidence)
      )) {
        errors.push(`promoted cell has missing or inconsistent ${gate} evidence: ${promotion.cellId}`)
      }
    }
    if (checkpoint.inventoryDigest !== digest(inventory)) {
      errors.push(`promotion inventory digest is stale: ${promotion.cellId}`)
    }
    if (promotion.evidenceDigest !== digest(result)) {
      errors.push(`promotion evidence digest mismatch: ${promotion.cellId}`)
    }
    const entry = inventoryById.get(promotion.cellId)?.contract?.inventoryEntry
    const identity = entry?.kind === 'atomic' ? entry.opId : entry?.functionNameSuggestion
    if (entry?.kind && identity) expectedCoverage[`${entry.kind}:${identity}`] = [...GATES]
  }
  if (canonicalJson(promoted.coverage ?? {}) !== canonicalJson(expectedCoverage)) {
    errors.push('coverage must exactly match the kind-qualified identities of promoted cells')
  }
  return errors.length ? { status: 'failed', errors } : { status: 'pass', checked: promoted.promotions.length }
}

export async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${error.message}`)
  }
}

export async function writeCheckpoint(path, checkpoint) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`)
  await rename(temporary, path)
}

export async function execute({ inventory, promoted, promotedPath, options, contracts, previous, gateEvidence = {} }) {
  const normalizedInventory = validateInventory(inventory)
  const promotionConsistency = await validatePromoted(promoted, normalizedInventory, promotedPath)
  const selected = selectCells(normalizedInventory, options, previous)
  const cells = { ...(previous?.cells ?? {}) }
  for (const cell of selected) cells[cell.id] = runCell(cell, contracts, gateEvidence)

  const statuses = Object.values(cells).map((cell) => cell.status)
  const status = promotionConsistency.status === 'failed' || statuses.includes('failed')
    ? 'failed'
    : statuses.includes('pending')
      ? 'pending'
      : 'pass'
  return {
    schemaVersion: 1,
    inventoryDigest: digest(normalizedInventory),
    generatedAt: new Date().toISOString(),
    status,
    selection: { batches: options.batches, cells: options.cells, resumed: options.resume, retryFailed: options.retryFailed },
    promotionConsistency,
    gates: GATES,
    cells,
  }
}
