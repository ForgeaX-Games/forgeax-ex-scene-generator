// `forgeax project list|create|open|delete` handlers — multi-project management as shell subcommands wrapping the kernel ProjectRegistry, the AI-native twin of the editor's projects modal. Unlike the pipeline verbs these do NOT take --pipeline-id (the project IS the pipeline); they operate on the workspace under --project-root and emit JSON/NDJSON.

import { readFileSync } from 'node:fs'
import { OpRegistry, ProjectRegistry, createBatteryLoader, createRuntime, getPipeline } from '@forgeax/node-runtime'
import type { ImportGraphInput, ProjectRuntimeFactory } from '@forgeax/node-runtime'

import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { mode, requireStr } from './shared.js'

// Build a ProjectRegistry for the workspace: scan the battery folder once into one shared OpRegistry, then hand the registry a per-project runtime factory so every project opened reuses the same registered ops.
async function buildRegistry(opts: Record<string, unknown>): Promise<ProjectRegistry> {
  const projectRoot = typeof opts.projectRoot === 'string' ? opts.projectRoot : process.cwd()
  const pluginId = typeof opts.pluginId === 'string' ? opts.pluginId : 'forgeax.cli'
  const defaultType = typeof opts.type === 'string' ? opts.type : 'default'

  // One shared OpRegistry across every per-project runtime (scan once).
  const registry = new OpRegistry()
  const batteriesDir = typeof opts.batteries === 'string' ? opts.batteries : ''
  if (batteriesDir) {
    const loader = createBatteryLoader(registry, {
      pluginId,
      scanDirs: [batteriesDir],
      layout: 'flexible',
    })
    const res = await loader.scan()
    if (res.errors.length > 0) {
      const detail = res.errors.map((e) => `  ${e.dir}: ${e.reason}`).join('\n')
      throw new CliError(`battery scan failed:\n${detail}`, 2)
    }
  }

  const factory: ProjectRuntimeFactory = (req) =>
    createRuntime({
      projectRoot,
      pipelineId: req.pipelineId,
      pluginId,
      registry,
      layout: { graphFile: req.graphFile, historyFile: req.historyFile, outputsDir: req.outputsDir },
    })

  const reg = new ProjectRegistry({
    workspaceRoot: projectRoot,
    createRuntime: factory,
    defaultType,
  })
  reg.init()
  return reg
}

// Pick the template graph's format: trust an explicit declaration, else sniff kernel-graph-v1 vs legacy-pipeline-v1 from the first node's shape.
function detectFormat(graph: unknown, declared?: unknown): ImportGraphInput['format'] {
  if (declared === 'kernel-graph-v1' || declared === 'legacy-pipeline-v1') return declared
  const g = graph as { nodes?: unknown }
  const nodes = Array.isArray(g?.nodes)
    ? (g.nodes as Array<Record<string, unknown>>)
    : g?.nodes && typeof g.nodes === 'object'
      ? Object.values(g.nodes as Record<string, Record<string, unknown>>)
      : []
  const first = nodes[0]
  if (first && 'batteryId' in first && !('opId' in first)) return 'legacy-pipeline-v1'
  return 'kernel-graph-v1'
}

// list: emit every project in the workspace plus the active-workspace pointer.
export async function projectList(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  makeEmitter(mode(opts)).record({
    projects: reg.listProjects(),
    workspace: reg.getWorkspace(),
  })
}

// create: make a project (optionally seeded from a kernel/legacy template file), then activate it so the call behaves as a faithful "create and open".
export async function projectCreate(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const name = requireStr(opts, 'name', '--name')

  let fromTemplate: ImportGraphInput | undefined
  if (typeof opts.fromTemplate === 'string' && opts.fromTemplate) {
    let raw: { format?: string; graph?: unknown }
    try {
      raw = JSON.parse(readFileSync(opts.fromTemplate, 'utf-8')) as { format?: string; graph?: unknown }
    } catch (e) {
      throw new CliError(
        `failed to read template '${opts.fromTemplate}': ${e instanceof Error ? e.message : String(e)}`,
        2,
      )
    }
    const graph = raw.graph ?? raw
    fromTemplate = { format: detectFormat(graph, raw.format), graph } as ImportGraphInput
  }

  const meta = await reg.createProject({
    name,
    ...(typeof opts.type === 'string' ? { type: opts.type } : {}),
    ...(typeof opts.description === 'string' ? { description: opts.description } : {}),
    ...(typeof opts.id === 'string' ? { id: opts.id } : {}),
    ...(fromTemplate ? { fromTemplate } : {}),
  })

  reg.viewProject(meta.id)
  makeEmitter(mode(opts)).record({ project: meta, workspace: reg.getWorkspace() })
}

// open: activate a project (swaps the active graph) and report its meta, the workspace, and the now-active pipeline.
export async function projectOpen(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const id = requireStr(opts, 'id', '--id')
  const rt = reg.viewProject(id)
  makeEmitter(mode(opts)).record({
    project: reg.getProject(id),
    workspace: reg.getWorkspace(),
    pipeline: getPipeline(rt),
  })
}

// delete: remove a project, choosing whether its assets are detached or deleted; the registry guarantees the workspace is never left empty.
export async function projectDelete(opts: Record<string, unknown>): Promise<void> {
  const reg = await buildRegistry(opts)
  const id = requireStr(opts, 'id', '--id')
  const assetPolicy = opts.assetPolicy === 'delete' ? 'delete' : 'detach'
  await reg.deleteProject(id, { assetPolicy })
  makeEmitter(mode(opts)).record({ ok: true, deleted: id, assetPolicy, workspace: reg.getWorkspace() })
}
