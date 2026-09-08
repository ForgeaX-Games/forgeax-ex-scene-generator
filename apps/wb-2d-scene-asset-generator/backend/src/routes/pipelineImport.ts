import type { FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  executeNode,
  getPipeline,
  importPipelineGraph,
  listGroups,
} from '@forgeax/node-runtime'
import type {
  ImportGraphFormat,
  ImportGraphInput,
  ImportPipelineExecuteOptions,
  ImportPipelineResponse,
  ImportTemplate,
  Runtime,
} from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'

interface ProjectParams {
  projectId: string
}

// Graph templates have TWO sources, mirroring the text-preset store:
//   1. BUILTIN — shipped with the plugin at `apps/<app>/templates/` (version
//      controlled, read-only). Marked `source: 'builtin'` in the response.
//   2. USER    — written under the active workspace at `<projectRoot>/templates/`
//      (runtime = `.forgeax/workbench/<plugin>/templates/`). Honours the
//      runtime-isolation rule (own FORGEAX_PROJECT_ROOT only). `source: 'templates'`.
// On a name/file collision the user template wins.
const here = dirname(fileURLToPath(import.meta.url))
// backend/src/routes → app root is three levels up.
const appRoot = resolve(here, '..', '..', '..')
const BUILTIN_TEMPLATES_DIR = join(appRoot, 'templates')

// Where USER graph templates live. Kept under the runtime project root so an
// isolated test run (FORGEAX_PROJECT_ROOT=<temp>) gets its own templates dir,
// never the repo's. This is the kernel-batch equivalent of the legacy
// workspaces/pipelines|outcoms|finals/ buckets.
function templatesDir(rt: Runtime): string {
  return resolve(rt.config.projectRoot, 'templates')
}

/**
 * Resolve a template file to read, refusing anything that escapes its source
 * dir. A user template (under the workspace) shadows a built-in of the same
 * file name. Returns the absolute path + which source it came from.
 */
function resolveTemplatePath(rt: Runtime, rel: string): string | null {
  // Strip any directory component — templates are flat files keyed by name.
  const safe = basename(rel)
  const userDir = templatesDir(rt)
  const userFull = resolve(userDir, safe)
  if (userFull.startsWith(resolve(userDir)) && existsSync(userFull)) return userFull
  const builtinFull = resolve(BUILTIN_TEMPLATES_DIR, safe)
  if (builtinFull.startsWith(resolve(BUILTIN_TEMPLATES_DIR)) && existsSync(builtinFull)) return builtinFull
  return null
}

/** Sniff the input format from the graph shape unless the caller declared one. */
function detectFormat(graph: unknown, declared?: string): ImportGraphFormat {
  if (declared === 'kernel-graph-v1' || declared === 'legacy-pipeline-v1') return declared
  const g = graph as { nodes?: unknown }
  const nodes = Array.isArray(g?.nodes)
    ? (g.nodes as Array<Record<string, unknown>>)
    : g?.nodes && typeof g.nodes === 'object'
      ? Object.values(g.nodes as Record<string, Record<string, unknown>>)
      : []
  const first = nodes[0]
  // Legacy nodes carry `batteryId`; kernel nodes carry `opId`.
  if (first && 'batteryId' in first && !('opId' in first)) return 'legacy-pipeline-v1'
  return 'kernel-graph-v1'
}

function toImportInput(format: ImportGraphFormat, graph: unknown): ImportGraphInput {
  return format === 'legacy-pipeline-v1'
    ? { format, graph: graph as never }
    : { format, graph: graph as never }
}

interface ImportBody {
  format?: string
  graph?: unknown
  file?: { path: string; source?: string }
  options?: ImportPipelineExecuteOptions
}

export async function registerPipelineImportRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/pipeline'

  app.get<{ Params: ProjectParams }>(`${prefix}/templates`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const rt = await getRuntimeForProject(projectId)
    const byPath = new Map<string, ImportTemplate>()
    const scan = (dir: string, source: ImportTemplate['source']) => {
      if (!existsSync(dir)) return
      for (const filename of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        let name = filename.replace(/\.json$/, '')
        let format: ImportGraphFormat = 'kernel-graph-v1'
        try {
          const parsed = JSON.parse(readFileSync(join(dir, filename), 'utf-8')) as {
            name?: string
            format?: string
            graph?: unknown
            nodes?: unknown
          }
          if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name
          const graph = parsed.graph ?? parsed
          format = detectFormat(graph, parsed.format)
        } catch {
          /* unreadable file → still listed with its filename */
        }
        byPath.set(filename, { path: filename, name, source, format })
      }
    }
    // Built-ins first so a same-named user template overwrites (user wins).
    scan(BUILTIN_TEMPLATES_DIR, 'builtin')
    scan(templatesDir(rt), 'templates')
    return Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  // Import a graph — inline ({ format, graph }) or from a template file
  // ({ file: { path, source } }). Applies via the kernel importPipelineGraph
  // (single applyBatch → graph:applied → live-sync). Honours executeAfter so
  // the preview reflects the imported graph.
  app.post<{ Params: ProjectParams }>(`${prefix}/import`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ status: 'rejected', reason: access.reason, code: access.code, projectId: access.projectId })
    const rt = await getRuntimeForProject(projectId)
    const body = (req.body ?? {}) as ImportBody
    const options = body.options ?? {}

    let rawGraph: unknown
    let declaredFormat = body.format
    if (body.file?.path) {
      const full = resolveTemplatePath(rt, body.file.path)
      if (!full || !existsSync(full)) {
        return reply.code(404).send({ status: 'rejected', reason: `template not found: ${body.file.path}` })
      }
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { format?: string; graph?: unknown }
        // A template file may wrap the graph as { format, graph } or be the raw graph.
        rawGraph = parsed.graph ?? parsed
        declaredFormat = declaredFormat ?? parsed.format
      } catch (e) {
        return reply.code(400).send({ status: 'rejected', reason: `template parse failed: ${(e as Error).message}` })
      }
    } else if (body.graph !== undefined) {
      rawGraph = body.graph
    } else {
      return reply.code(400).send({ status: 'rejected', reason: 'missing graph (provide inline `graph` or `file.path`)' })
    }

    const format = detectFormat(rawGraph, declaredFormat)
    const result = await importPipelineGraph(rt, toImportInput(format, rawGraph), {
      mode: options.mode ?? 'replace',
      remapNodeIds: options.remapNodeIds,
      idRemap: options.idRemap,
      opIdMap: options.opIdMap,
      actor: options.actor ?? 'import',
      ...(options.label !== undefined ? { label: options.label } : {}),
    })

    if (result.status !== 'ok') {
      return reply.code(422).send(result as ImportPipelineResponse)
    }

    // graph:applied is emitted by the kernel importPipelineGraph (one applyBatch
    // → bus) and fanned out to every live editor by the /ws subscription binding
    // — the same single-source path /api/v1/batch uses. We deliberately do NOT
    // broadcast a second copy here (it carries actor + batchId for the History
    // bridge already).

    // Post-import execution so previews reflect the imported graph. Exec events
    // stream over /ws → the editor's exec:completed → refreshConnectedOutputs.
    const executeAfter = options.executeAfter ?? 'none'
    let executed = false
    if (executeAfter === 'full' || executeAfter === 'downstream') {
      try {
        const handle = await executeNode(rt, {})
        await handle.done
        executed = true
      } catch (e) {
        app.log?.warn?.(`[pipeline import] post-import execute failed: ${(e as Error).message}`)
      }
    }

    const response: ImportPipelineResponse = { ...result, executed }
    return response
  })

  // Export the current graph to a template file (kernel-graph-v1). The faithful
  // kernel-batch equivalent of the legacy savePipelineAs route.
  app.post<{ Params: ProjectParams }>(`${prefix}/export`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const rt = await getRuntimeForProject(projectId)
    const { name, source: _source } = (req.body ?? {}) as { name?: string; source?: string }
    const snap = getPipeline(rt)
    if (!snap) return reply.code(404).send({ reason: 'no pipeline to export' })

    const dir = templatesDir(rt)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const safeName = (name && name.trim() ? name.trim() : new Date().toISOString().slice(0, 19).replace('T', '_'))
      .replace(/[\\/:*?"<>|]/g, '_')
    const filename = `${safeName}.json`
    const full = join(dir, filename)

    const groups = listGroups(rt)
    const file = {
      format: 'kernel-graph-v1' as const,
      name: safeName,
      graph: {
        id: snap.id,
        nodes: snap.nodes,
        edges: snap.edges,
        ...(groups.length ? { groups: Object.fromEntries(groups.map((g) => [g.id, g])) } : {}),
        ...(snap.metadata ? { metadata: snap.metadata } : {}),
      },
    }
    writeFileSync(full, JSON.stringify(file, null, 2), 'utf-8')
    return { path: filename, name: safeName }
  })
}
