import type { FastifyInstance } from 'fastify'

import { getProjectDir } from '../../runtime.js'
import { projectSinoContractCatalog } from '../../scene-script/contracts/agentContractCatalog.js'
import { getProjectSceneContractRegistry } from '../../scene-script/contracts/contracts.js'

import { SCENE_SCRIPT_PREFIX, type ProjectParams } from './types.js'

export function registerSceneScriptContractRoutes(app: FastifyInstance): void {
  const prefix = SCENE_SCRIPT_PREFIX
  app.get<{
    Params: ProjectParams
    Querystring: {
      audience?: string
      mode?: 'summary' | 'detail'
      functionNames?: string
    }
  }>(`${prefix}/contracts`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const registry = await getProjectSceneContractRegistry(projectDir)
    if (req.query.audience === 'sino') {
      const catalog = projectSinoContractCatalog(registry.list(), {
        mode: req.query.mode,
        functionNames: req.query.functionNames?.split(',').map((name) => name.trim()).filter(Boolean),
      })
      return catalog
    }
    return {
      version: '0.1',
      functions: registry.list()
        .filter((contract) => contract.agentVisible !== false)
        .map(({ definition: _definition, ...contract }) => contract),
    }
  })

}
