import type { FastifyInstance } from 'fastify'
import type { Runtime } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntime, getRuntimeForProject } from '../runtime.js'

interface AssetQuery {
  type?: string
  suffix?: string
}

interface ProjectParams {
  projectId: string
}

function listAssets(rt: Runtime, query: AssetQuery) {
  const items = rt.assets.list({
    ...(query.type ? { type: query.type } : {}),
    ...(query.suffix ? { suffix: query.suffix } : {}),
  })
  return {
    items: items.map(({ absPath: _absPath, ...safe }) => safe),
  }
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  // Project-scoped asset listing. Agents drive `projects.open(A)` → `pipeline.*`
  // on A while the UI may be VIEWING a different project B; resolving assets off
  // the explicit project (not the viewing runtime) keeps `assets.list` honest.
  app.get<{ Params: ProjectParams; Querystring: AssetQuery }>(
    '/api/v1/projects/:projectId/assets',
    async (req, reply) => {
      const { projectId } = req.params
      const reg = await getProjectRegistry()
      if (!reg.getProject(projectId)) {
        return reply.code(404).send({ reason: `project not found: ${projectId}` })
      }
      return listAssets(await getRuntimeForProject(projectId), req.query)
    },
  )

  // Legacy non-scoped route (viewing project). Retained for the human UI and
  // backward compatibility; agents should prefer the project-scoped route above.
  app.get<{ Querystring: AssetQuery }>('/api/v1/assets', async (req) => {
    return listAssets(await getRuntime(), req.query)
  })
}
