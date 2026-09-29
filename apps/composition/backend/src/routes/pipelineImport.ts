import type { FastifyInstance } from 'fastify'
import { getPipeline, listGroups } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../runtime.js'

interface ProjectParams {
  projectId: string
}

const GRAPH_NOT_AUTHORING = {
  status: 'rejected' as const,
  code: 'runtime-graph-authoring-removed',
  reason: 'The node graph is a Scene Script projection. Write .scene.ts with commitProject or the canvas formal editor.',
}

export async function registerPipelineImportRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/pipeline'

  app.get<{ Params: ProjectParams }>(`${prefix}/templates`, async (_req, reply) =>
    reply.code(410).send(GRAPH_NOT_AUTHORING),
  )

  app.post<{ Params: ProjectParams }>(`${prefix}/import`, async (_req, reply) =>
    reply.code(410).send(GRAPH_NOT_AUTHORING),
  )

  app.get<{ Params: ProjectParams }>(`${prefix}/snapshot`, async (req, reply) => {
    const rt = await getRuntimeForProject(req.params.projectId)
    const snap = getPipeline(rt)
    if (!snap) return reply.code(404).send({ reason: 'no compiled projection' })
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

  app.post<{ Params: ProjectParams }>(`${prefix}/export`, async (_req, reply) =>
    reply.code(410).send({
      ...GRAPH_NOT_AUTHORING,
      reason: 'The node graph is a Scene Script projection. Do not export Graph JSON as an authoring template.',
    }),
  )
}
