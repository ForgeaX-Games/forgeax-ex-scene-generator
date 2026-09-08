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
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { IMPORT_BODY_LIMIT } from './body-limits.js'

interface ProjectParams {
  projectId: string
}

function templatesDir(rt: Runtime): string {
  return resolve(rt.config.projectRoot, 'templates')
}

function resolveTemplatePath(rt: Runtime, rel: string): string | null {
  const dir = templatesDir(rt)
  const full = resolve(dir, basename(rel))
  if (!full.startsWith(resolve(dir))) return null
  return full
}

function detectFormat(graph: unknown, declared?: string): ImportGraphFormat {
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
        /* unreadable file -> still listed with its filename */
      }
      items.push({ path: filename, name, source: 'templates', format })
    }
    return items
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/import`, {
    // Full-graph imports can be large (all nodes + inline templates), but still
    // bounded — an unbounded body is a DoS vector. The graph/file union is
    // validated below (400 on missing graph), so the schema only enforces shape.
    bodyLimit: IMPORT_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        properties: {
          format: { type: 'string' },
          file: {
            type: 'object',
            properties: { path: { type: 'string' }, source: { type: 'string' } },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
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

    return { ...result, executed } satisfies ImportPipelineResponse
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/export`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ status: 'rejected', reason: access.reason, code: access.code, projectId: access.projectId })
    const rt = await getRuntimeForProject(projectId)
    const { name } = (req.body ?? {}) as { name?: string; source?: string }
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
