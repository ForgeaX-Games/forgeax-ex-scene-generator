import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionRoot = resolve(appRoot, '..', '..')
const outputPath = resolve(
  appRoot,
  'acceptance',
  'inventory',
  'scene-script-battery-inventory.json',
)
const checkOnly = process.argv.includes('--check')

const atomicRoots = [
  // Include transitive component/scene30 dependencies as well as the requested
  // migration categories. Native Group/Template Definitions may not fall back
  // to an uncontracted runtime op.
  { path: resolve(appRoot, 'batteries'), category: 'wb-scene-generator' },
  {
    path: resolve(extensionRoot, 'packages', 'batteries-common', 'batteries', 'common'),
    category: 'common',
  },
]

const groupRoots = [
  { path: resolve(appRoot, 'batteries', 'groups'), category: 'groups', kind: 'group' },
  { path: resolve(appRoot, 'batteries', 'templates'), category: 'templates', kind: 'template' },
]

function portablePath(path) {
  return relative(extensionRoot, path).split(sep).join('/')
}

function lowerCamel(value) {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (!words.length) return 'unnamedBattery'
  const [first, ...rest] = words
  return (
    first.slice(0, 1).toLowerCase() +
    first.slice(1) +
    rest.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join('')
  )
}

async function collectFiles(root, predicate, output = []) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) await collectFiles(path, predicate, output)
    else if (entry.isFile() && predicate(entry.name)) output.push(path)
  }
  return output
}

function categoryFor(root, file) {
  const segments = relative(root.path, dirname(file)).split(sep).filter(Boolean)
  segments.pop()
  return [root.category, ...segments].join('/')
}

function exportedFunctionName(source) {
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/,
    /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (match) return match[1]
  }
  return undefined
}

function collectNodeOpIds(group) {
  const dependencies = new Set()
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value.nodes)) {
      for (const node of value.nodes) {
        if (
          node &&
          typeof node === 'object' &&
          typeof node.opId === 'string' &&
          node.opId.trim() &&
          node.opId !== '__group__'
        ) {
          dependencies.add(node.opId)
        }
      }
    }
    if (Array.isArray(value._nestedGroups)) {
      for (const nested of value._nestedGroups) visit(nested)
    }
  }
  visit(group)
  return [...dependencies].sort()
}

const candidates = []
const diagnostics = []

for (const root of atomicRoots) {
  const metaFiles = await collectFiles(root.path, (name) => name === 'meta.json')
  for (const metaPath of metaFiles) {
    let meta
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'))
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_JSON',
        sources: [portablePath(metaPath)],
        message: `Cannot parse battery metadata: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    const opId =
      typeof meta.id === 'string' && meta.id.trim() ? meta.id.trim() : basename(dirname(metaPath))
    const indexPath = resolve(dirname(metaPath), 'index.ts')
    const indexSource = await readFile(indexPath, 'utf8').catch(() => undefined)
    const contractPath = resolve(dirname(metaPath), 'scene.contract.ts')
    const contractSource = await readFile(contractPath, 'utf8').catch(() => undefined)
    const contractFunctionNames = contractSource
      ? [...contractSource.matchAll(/["']?functionName["']?\s*:\s*["']([^"']+)["']/g)].map((match) => match[1])
      : []
    const suggestedName =
      contractFunctionNames[0] ||
      (indexSource && exportedFunctionName(indexSource)) ||
      lowerCamel(
        (typeof meta['name-en'] === 'string' && meta['name-en']) ||
          (typeof meta.nameEn === 'string' && meta.nameEn) ||
          opId,
      )

    candidates.push({
      category: categoryFor(root, metaPath),
      opId,
      functionNameSuggestion: suggestedName,
      functionNames: contractFunctionNames,
      kind: 'atomic',
      source: indexSource ? portablePath(indexPath) : null,
      metaPath: portablePath(metaPath),
      dependencies: [],
      status: indexSource ? 'ready' : 'missing-implementation',
    })
  }
}

for (const root of groupRoots) {
  const sceneFiles = await collectFiles(root.path, (name) => name.endsWith('.scene.ts'))
  for (const sourcePath of sceneFiles) {
    const source = await readFile(sourcePath, 'utf8')
    const functionName = source.match(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineGroup\s*\(/)?.[1]
    const opId = source.match(/\bid\s*:\s*["']([^"']+)["']/)?.[1]
    if (!functionName || !opId) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_SCENE_DEFINITION',
        sources: [portablePath(sourcePath)],
        message: 'Native catalog source must export defineGroup with a stable definition id.',
      })
      continue
    }

    candidates.push({
      category: categoryFor(root, sourcePath),
      opId,
      functionNameSuggestion: functionName,
      kind: root.kind,
      source: portablePath(sourcePath),
      metaPath: null,
      dependencies: [],
      status: portablePath(sourcePath).includes('/groups/test_terrain/')
        ? 'retired-test-oracle'
        : 'ready',
    })
  }

}

// Resolve the public Scene function namespace deterministically. Templates keep
// the concise semantic name when possible; mirrored Groups and wrappers that
// collide with an atomic function receive an explicit kind suffix.
const atomicFunctionNames = new Set(
  candidates.filter((item) => item.kind === 'atomic').flatMap((item) => item.functionNames?.length
    ? item.functionNames
    : [item.functionNameSuggestion]),
)
const compositionNames = new Map()
for (const candidate of candidates.filter((item) => item.kind !== 'atomic')) {
  const matches = compositionNames.get(candidate.functionNameSuggestion)
  if (matches) matches.push(candidate)
  else compositionNames.set(candidate.functionNameSuggestion, [candidate])
}
for (const [base, matches] of compositionNames) {
  const mirroredKinds = new Set(matches.map((item) => item.kind)).size > 1
  for (const candidate of matches) {
    if (atomicFunctionNames.has(base) || (mirroredKinds && candidate.kind === 'group')) {
      candidate.functionNameSuggestion = `${base}${candidate.kind === 'group' ? 'Group' : 'Template'}`
    }
  }
}

candidates.sort(
  (left, right) =>
    left.opId.localeCompare(right.opId) ||
    left.kind.localeCompare(right.kind) ||
    String(left.source).localeCompare(String(right.source)),
)

const entries = []
const atomicByOpId = new Map()
for (const candidate of candidates.filter((item) => item.kind === 'atomic')) {
  const duplicates = atomicByOpId.get(candidate.opId)
  if (duplicates) duplicates.push(candidate)
  else atomicByOpId.set(candidate.opId, [candidate])
}
for (const [opId, duplicateCandidates] of atomicByOpId) {
  entries.push({ ...duplicateCandidates[0], cellId: `atomic:${opId}` })
  if (duplicateCandidates.length > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'DUPLICATE_OP_ID',
      opId,
      sources: duplicateCandidates.map((entry) => entry.source ?? entry.metaPath).filter(Boolean),
      message: `Deduplicated ${duplicateCandidates.length} inventory candidates for opId '${opId}'.`,
    })
  }
}
for (const candidate of candidates.filter((item) => item.kind !== 'atomic')) {
  entries.push({
    ...candidate,
    cellId: `${candidate.kind}:${candidate.source}`,
  })
}

const knownOpIds = new Set(entries.filter((entry) => entry.kind === 'atomic').map((entry) => entry.opId))
for (const entry of entries) {
  if (entry.kind === 'atomic' || entry.status === 'retired-test-oracle') continue
  const ghosts = entry.dependencies.filter((dependency) => !knownOpIds.has(dependency))
  if (!ghosts.length) continue
  entry.status = 'blocked-by-ghost-dependency'
  for (const dependency of ghosts) {
    diagnostics.push({
      severity: 'error',
      code: 'GHOST_DEPENDENCY',
      opId: entry.opId,
      dependency,
      sources: [entry.source].filter(Boolean),
      message: `'${entry.opId}' references unknown node opId '${dependency}'.`,
    })
  }
}

const byFunctionName = new Map()
for (const entry of entries) {
  const matches = byFunctionName.get(entry.functionNameSuggestion)
  if (matches) matches.push(entry)
  else byFunctionName.set(entry.functionNameSuggestion, [entry])
}
for (const [functionName, matches] of byFunctionName) {
  if (matches.length < 2) continue
  diagnostics.push({
    severity: 'warning',
    code: 'DUPLICATE_FUNCTION_NAME',
    functionName,
    opIds: matches.map((entry) => entry.opId),
    sources: matches.map((entry) => entry.source ?? entry.metaPath).filter(Boolean),
    message: `Function-name suggestion '${functionName}' is shared by ${matches.length} inventory entries.`,
  })
}

diagnostics.sort(
  (left, right) =>
    left.code.localeCompare(right.code) ||
    String(left.opId ?? left.functionName ?? left.sources?.[0]).localeCompare(
      String(right.opId ?? right.functionName ?? right.sources?.[0]),
    ),
)

const inventory = {
  schemaVersion: 1,
  scanRoots: [
    ...atomicRoots.map((root) => portablePath(root.path)),
    ...groupRoots.map((root) => portablePath(root.path)),
  ],
  stats: {
    candidates: candidates.length,
    entries: entries.length,
    atomic: entries.filter((entry) => entry.kind === 'atomic').length,
    groups: entries.filter((entry) => entry.kind === 'group').length,
    templates: entries.filter((entry) => entry.kind === 'template').length,
    ready: entries.filter((entry) => entry.status === 'ready').length,
    retired: entries.filter((entry) => entry.status === 'retired-test-oracle').length,
    blocked: entries.filter((entry) => !['ready', 'retired-test-oracle'].includes(entry.status)).length,
    diagnostics: diagnostics.length,
    duplicateOpIds: diagnostics.filter((item) => item.code === 'DUPLICATE_OP_ID').length,
    duplicateFunctionNames: diagnostics.filter((item) => item.code === 'DUPLICATE_FUNCTION_NAME')
      .length,
    ghostDependencies: diagnostics.filter((item) => item.code === 'GHOST_DEPENDENCY').length,
  },
  entries,
  diagnostics,
}

const prettierConfig = (await resolveConfig(outputPath)) ?? {}
const generated = await format(JSON.stringify(inventory), {
  ...prettierConfig,
  filepath: outputPath,
})

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (current !== generated) {
    console.error(`Scene Script battery inventory is stale: ${portablePath(outputPath)}`)
    process.exitCode = 1
  } else {
    console.log(`Scene Script battery inventory is current: ${portablePath(outputPath)}`)
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, generated)
  console.log(
    JSON.stringify(
      {
        output: portablePath(outputPath),
        ...inventory.stats,
      },
      null,
      2,
    ),
  )
}
