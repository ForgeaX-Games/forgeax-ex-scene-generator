// Flag → CliConfig mapping. Mostly pure; the only file I/O is reading a
// project's manifest.json when `--project-id` is given, so the atomic verbs can
// be aimed at a specific project's isolated graph in a multi-project workspace.

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { CliError } from './errors.js'

/** Kernel artefact layout for one target graph (forwarded to createRuntime). */
export interface CliLayout {
  graphFile: string
  historyFile?: string
  outputsDir?: string
}

export interface CliConfig {
  projectRoot: string
  pipelineId: string
  pluginId: string
  /** Absolute or cwd-relative dir of battery folders. '' when not provided. */
  batteriesDir: string
  /**
   * Explicit kernel layout when the target graph is NOT the implicit
   * `<projectRoot>/state/graph.json` — e.g. a specific project in a
   * multi-project workspace (`--project-id`) or a direct file (`--graph-file`).
   * Undefined keeps the legacy default layout.
   */
  layout?: CliLayout
}

/** Minimal slice of the project manifest the CLI needs to resolve storage. */
interface ProjectManifestSlice {
  storage?: {
    graphFile?: string
    historyFile?: string
    outputsDir?: string
  }
}

/**
 * Resolve the target graph layout from `--graph-file` / `--project-id`.
 *
 * - `--graph-file <path>`: aim every verb straight at that graph.json. Sibling
 *   history/outputs are placed next to it so a freestanding graph still records
 *   history + caches outputs.
 * - `--project-id <id>`: resolve the project's isolated storage from
 *   `<projectRoot>/projects/<id>/manifest.json` (the same paths the
 *   ProjectRegistry writes), so atomic `node *` / `pipeline apply|get|execute`
 *   operate on that project's graph without `project open` swapping the active
 *   pointer.
 *
 * Returns undefined when neither is given (legacy `<projectRoot>/state` layout).
 */
function resolveLayout(opts: Record<string, unknown>, projectRoot: string): CliLayout | undefined {
  const graphFileOpt = typeof opts.graphFile === 'string' && opts.graphFile ? opts.graphFile : ''
  if (graphFileOpt) {
    const graphFile = isAbsolute(graphFileOpt) ? graphFileOpt : join(process.cwd(), graphFileOpt)
    const dir = join(graphFile, '..')
    return {
      graphFile,
      historyFile: join(dir, 'history.jsonl'),
      outputsDir: join(dir, 'outputs'),
    }
  }

  const projectId = typeof opts.projectId === 'string' && opts.projectId ? opts.projectId : ''
  if (!projectId) return undefined

  const manifestPath = join(projectRoot, 'projects', projectId, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new CliError(
      `--project-id '${projectId}': manifest not found at ${manifestPath} (is --project-root correct?)`,
      2,
    )
  }
  let manifest: ProjectManifestSlice
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ProjectManifestSlice
  } catch (e) {
    throw new CliError(
      `--project-id '${projectId}': failed to read manifest: ${e instanceof Error ? e.message : String(e)}`,
      2,
    )
  }
  const storage = manifest.storage
  if (!storage || typeof storage.graphFile !== 'string') {
    throw new CliError(`--project-id '${projectId}': manifest has no storage.graphFile`, 2)
  }
  // Manifest storage paths are stored relative to the workspace root (projectRoot).
  const abs = (rel: string): string => (isAbsolute(rel) ? rel : join(projectRoot, rel))
  return {
    graphFile: abs(storage.graphFile),
    ...(typeof storage.historyFile === 'string' ? { historyFile: abs(storage.historyFile) } : {}),
    ...(typeof storage.outputsDir === 'string' ? { outputsDir: abs(storage.outputsDir) } : {}),
  }
}

export function resolveConfig(opts: Record<string, unknown>): CliConfig {
  const projectRoot = typeof opts.projectRoot === 'string' ? opts.projectRoot : process.cwd()
  const layout = resolveLayout(opts, projectRoot)

  // When a layout is pinned via --graph-file / --project-id, the pipeline id is
  // inferred (project id, or the graph file's directory name) so callers no
  // longer have to repeat --pipeline-id for project-scoped work.
  let pipelineId = typeof opts.pipelineId === 'string' ? opts.pipelineId : ''
  if (!pipelineId && typeof opts.projectId === 'string' && opts.projectId) {
    pipelineId = opts.projectId
  }
  if (!pipelineId && layout) {
    pipelineId = 'cli'
  }
  if (!pipelineId) {
    throw new CliError('missing required --pipeline-id (or pass --project-id / --graph-file)', 2)
  }

  return {
    projectRoot,
    pipelineId,
    pluginId: typeof opts.pluginId === 'string' ? opts.pluginId : 'forgeax.cli',
    batteriesDir: typeof opts.batteries === 'string' ? opts.batteries : '',
    ...(layout ? { layout } : {}),
  }
}
