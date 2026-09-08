import type { FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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
import { getProjectDir, getRuntime, getRuntimeForProject, resolveWorkspaceRoot } from '../runtime.js'
import { extractCaller, ensureMutationAccess } from './projects.js'
import { readSceneModule } from '../scene-script/persist/store.js'

// Where graph templates live. Kept under the runtime project root so an
// isolated test run (FORGEAX_PROJECT_ROOT=<temp>) gets its own templates dir,
// never the repo's. This is the kernel-batch equivalent of the legacy
// workspaces/pipelines|outcoms|finals/ buckets.
function templatesDir(rt: Runtime): string {
  return resolve(rt.config.projectRoot, 'templates')
}

/** Resolve a template file path, refusing anything that escapes the templates dir. */
function resolveTemplatePath(rt: Runtime, rel: string): string | null {
  const dir = templatesDir(rt)
  // Strip any directory component — templates are flat files keyed by name.
  const safe = basename(rel)
  const full = resolve(dir, safe)
  if (!full.startsWith(resolve(dir))) return null
  return full
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

interface ProjectParams {
  projectId: string
}

export async function registerPipelineImportRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/pipeline'

  app.get<{ Params: ProjectParams }>(`${prefix}/templates`, async (req) => {
    const rt = await getRuntimeForProject(req.params.projectId)
    const dir = templatesDir(rt)
    if (!existsSync(dir)) return [] as ImportTemplate[]
    const items: ImportTemplate[] = []
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
      items.push({ path: filename, name, source: 'templates', format })
    }
    return items
  })

  // Import a graph — inline ({ format, graph }) or from a template file
  // ({ file: { path, source } }). Applies via the kernel importPipelineGraph
  // (single applyBatch → graph:applied → live-sync). Honours executeAfter so
  // the preview reflects the imported graph.
  app.post<{ Params: ProjectParams }>(`${prefix}/import`, async (_req, reply) =>
    reply.code(410).send({
      status: 'rejected',
      code: 'runtime-graph-authoring-removed',
      reason: 'Runtime Graph import is no longer an authoring write path. Use Scene Script, or explicitly lift an existing legacy project.',
    }),
  )

  // Inline export for orchestrators (aw-support construction snapshots): same
  // shape as the on-disk export file, without writing into templates/.
  app.get<{ Params: ProjectParams }>(`${prefix}/snapshot`, async (req, reply) => {
    const rt = await getRuntimeForProject(req.params.projectId)
    const snap = getPipeline(rt)
    if (!snap) return reply.code(404).send({ reason: 'no pipeline to export' })
    const groups = listGroups(rt)
    return {
      format: 'kernel-graph-v1' as const,
      graph: {
        id: snap.id,
        nodes: snap.nodes,
        edges: snap.edges,
        ...(groups.length ? { groups: Object.fromEntries(groups.map((g) => [g.id, g])) } : {}),
        ...(snap.metadata ? { metadata: snap.metadata } : {}),
      },
    }
  })

  // Export the current graph to a template file (kernel-graph-v1). The faithful
  // kernel-batch equivalent of the legacy savePipelineAs route.
  app.post<{ Params: ProjectParams }>(`${prefix}/export`, async (req, reply) => {
    const rt = await getRuntimeForProject(req.params.projectId)
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
