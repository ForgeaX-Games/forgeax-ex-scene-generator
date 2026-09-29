// Battery UI-category projection.
//
// The kernel deliberately keeps UI metadata (category / displayGroup / type)
// OUT of OpSpec — `listOps` only returns id/name/inputs/outputs. But the
// faithful editor groups its palette by category, and in this plugin the
// category is encoded in the on-disk battery layout:
//
//   batteries/{bigTag}/{smallTag}/{batteryId}/scene.contract.ts   →  category "bigTag/smallTag"
//
// This module scans that tree once (cached) and maps each registered op id to
// its `bigTag/smallTag` category, so the `/api/v1/ops` route can re-attach the
// UI hint the editor needs. Mirrors the legacy battery.service category rule.

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'
import { resolveSceneBatteryScanRoots } from '../scene-script/firstBatchBatteries.js'
import {
  AcceptanceCoverageMatrix,
  parseAtomicContractSource,
  type AcceptanceGateId,
  type ContractRegistry,
  type SceneScriptStatus,
} from '@forgeax/scene-authoring'
import { getSceneContractRegistry } from '../scene-script/contracts/contracts.js'

// This module lives in backend/src/routes, so the scene-generator repo root is
// three levels up (routes → src → backend → repo).
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const batteryScanRoots = resolveSceneBatteryScanRoots()
const acceptanceEvidenceFile = resolve(repoRoot, 'acceptance', 'promoted.json')

export interface BatteryUiMeta {
  /** "bigTag/smallTag" — drives BatteryBar rail (big) + accordion (small). */
  category: string
  /** Pass-through of contract.canvas display grouping, when present. */
  displayGroup?: string
  /** Top-level folder, e.g. 'special' | 'ai' | 'scene30' — the battery type bucket. */
  type?: string
  /** Pass-through of contract.canvas.nodeType — the editor's ReactFlow node component. */
  nodeType?: string
  /** Pass-through of contract.canvas.hideOutputs — sink-shaped batteries hide the output handle. */
  hideOutputs?: boolean
  /** Inline SVG loaded from icon.svg beside scene.contract.ts, when present. */
  iconSvg?: string
  /** Repository-relative directory; safe for display but never an open-file path. */
  sourcePath?: string
  /** Safe, shallow directory projection for Node Info. */
  sourceFiles?: string[]
  /** Derived authoring capability; never hand-maintained in the battery contract. */
  sceneScriptStatus?: SceneScriptStatus
  sceneScriptFunctionName?: string
  sceneScriptPassedGates?: string[]
  sceneScriptMissingGates?: string[]
}

let cache: Map<string, BatteryUiMeta> | null = null

export function invalidateBatteryCategories(): void {
  cache = null
}

async function refreshCachedIcons(map: Map<string, BatteryUiMeta>): Promise<void> {
  for (const [id, meta] of map) {
    if (!meta.sourcePath) continue
    let iconSvg: string | undefined
    for (const root of batteryScanRoots) {
      iconSvg = await readFile(resolve(root, meta.sourcePath, 'icon.svg'), 'utf8').catch(() => undefined)
      if (iconSvg !== undefined) break
    }
    if (iconSvg !== meta.iconSvg) map.set(id, { ...meta, iconSvg })
  }
}

/** Recursively collect every scene.contract.ts path under the batteries root. */
async function findContractFiles(dir: string, acc: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      await findContractFiles(full, acc)
    } else if (entry.isFile() && entry.name === 'scene.contract.ts') {
      acc.push(full)
    }
  }
}

/**
 * Build the id → UI-meta map by scanning battery trees. The op
 * id is the parsed contract `opId` when present, else the battery directory
 * name (the same fallback the kernel loader uses), so the map keys line up
 * with `listOps`.
 */
export async function scanBatteryCategories(roots: readonly string[]): Promise<Map<string, BatteryUiMeta>> {
  const map = new Map<string, BatteryUiMeta>()

  for (const root of roots) {
    const contractFiles: string[] = []
    await findContractFiles(root, contractFiles)

    for (const file of contractFiles) {
      const batteryDir = dirname(file)
      const rel = file.startsWith(`${root}/`) || file.startsWith(`${root}\\`)
        ? file.slice(root.length + 1)
        : `${basename(batteryDir)}/scene.contract.ts`
      const segments = rel.split(/[\\/]/)
      const fromRoot = batteryDir === root
      const bigTag = fromRoot ? basename(dirname(dirname(root))) : segments[0]
      const smallTag = fromRoot
        ? basename(dirname(root))
        : (segments.length >= 4 ? segments[1] : '')
      if (!bigTag) continue
      const category = smallTag ? `${bigTag}/${smallTag}` : bigTag
      const typeBucket = bigTag

      const source = await readFile(file, 'utf8').catch(() => '')
      const parsed = source ? parseAtomicContractSource(source, file) : { contracts: [], diagnostics: [] }
      const contract = parsed.contracts[0]
      const dirName = basename(dirname(file))
      const id = contract?.opId?.trim() ? contract.opId : dirName
      const nodeType =
        typeof contract?.canvas?.nodeType === 'string' && contract.canvas.nodeType.trim()
          ? contract.canvas.nodeType
          : undefined
      const hideOutputs =
        typeof contract?.canvas?.hideOutputs === 'boolean' ? contract.canvas.hideOutputs : undefined
      const iconSvg = await readFile(resolve(dirname(file), 'icon.svg'), 'utf8').catch(() => undefined)
      const sourceFiles = (await readdir(dirname(file), { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`)
        .sort()
      map.set(id, {
        category,
        displayGroup: undefined,
        type: typeBucket,
        nodeType,
        hideOutputs,
        iconSvg,
        sourcePath: rel.split(/[\\/]/).slice(0, -1).join('/'),
        sourceFiles,
      })
    }
  }

  return map
}

export function applyAcceptanceCoverage(
  map: Map<string, BatteryUiMeta>,
  registry: ContractRegistry,
  promoted: Readonly<Record<string, readonly AcceptanceGateId[]>>,
): void {
  const coverage = new AcceptanceCoverageMatrix(promoted).byOpId(registry)
  for (const [opId, record] of coverage) {
    const current = map.get(opId)
    if (!current) continue
    map.set(opId, {
      ...current,
      sceneScriptStatus: record.status,
      sceneScriptFunctionName: record.functionName,
      sceneScriptPassedGates: record.passedGates,
      sceneScriptMissingGates: record.missingGates,
    })
  }
}

/**
 * Build (and cache) the id → UI-meta map by scanning the configured battery
 * roots. Each root's top-level folders become palette big tags.
 */
export async function getBatteryCategories(): Promise<Map<string, BatteryUiMeta>> {
  if (cache) {
    await refreshCachedIcons(cache)
    return cache
  }
  const map = await scanBatteryCategories(batteryScanRoots)
  const registry = await getSceneContractRegistry()
  const promoted = await readFile(acceptanceEvidenceFile, 'utf8')
    .then((source) => {
      const parsed = JSON.parse(source) as { coverage?: Record<string, AcceptanceGateId[]> }
      return parsed.coverage ?? {}
    })
    .catch(() => ({}))
  applyAcceptanceCoverage(map, registry, promoted)
  cache = map
  return cache
}
