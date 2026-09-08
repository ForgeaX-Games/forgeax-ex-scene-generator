import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHECKLIST_FILENAME = 'scene-composition-checklist.json'
const RUN_PROJECT_FILENAME = 'run-project.json'
const CONTRACT_FILENAME = 'location-layout-contract.json'

function parseJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function namesFromRunDir(runDir: string): string[] {
  const checklist = parseJsonFile<{ narrativeLocationNames?: unknown }>(
    join(runDir, CHECKLIST_FILENAME),
  )
  if (Array.isArray(checklist?.narrativeLocationNames)) {
    return checklist.narrativeLocationNames.filter(
      (n): n is string => typeof n === 'string' && n.trim().length > 0,
    )
  }
  const contract = parseJsonFile<{ entries?: Array<{ id?: string; displayName?: string }> }>(
    join(runDir, CONTRACT_FILENAME),
  )
  if (contract?.entries?.length) {
    return contract.entries
      .map((e) => e.displayName || e.id)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
  }
  return []
}

function awSupportRunsDir(env: Record<string, string | undefined>): string | null {
  const explicit = env.AW_SUPPORT_RUNS_DIR?.trim()
  if (explicit) return explicit
  const root = env.FORGEAX_PROJECT_ROOT?.trim()
  if (root) return join(root, 'aw-support/runs')
  return null
}

function namesForProjectId(runsDir: string, projectId: string): string[] {
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const runDir = join(runsDir, entry.name)
    const meta = parseJsonFile<{ sceneProjectId?: string }>(join(runDir, RUN_PROJECT_FILENAME))
    if (meta?.sceneProjectId !== projectId) continue
    const names = namesFromRunDir(runDir)
    if (names.length > 0) return names
  }
  return []
}

/** Resolve narrativeLocationNames for AI execute — body args, else aw-support run dir by projectId. */
export function resolveNarrativeLocationNames(
  env: Record<string, string | undefined>,
  bodyNames: string[],
  projectId?: string,
): string[] {
  if (bodyNames.length > 0) return bodyNames
  if (!projectId?.trim()) return []
  const runsDir = awSupportRunsDir(env)
  if (!runsDir || !existsSync(runsDir)) return []
  return namesForProjectId(runsDir, projectId.trim())
}
