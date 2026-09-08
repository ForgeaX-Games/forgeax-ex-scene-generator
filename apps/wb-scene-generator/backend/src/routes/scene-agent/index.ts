import type { FastifyInstance } from 'fastify'

import { registerSceneAgentLensRoutes } from './lens.js'
import { registerSceneAgentLocateRoutes } from './locate.js'
import { registerSceneAgentProposeRoutes } from './propose.js'
import { registerSceneAgentTransactionRoutes } from './transactions.js'
import { registerSceneAgentWorkGraphRoutes } from './work-graph.js'

export async function registerSceneProjectAgentRoutes(app: FastifyInstance): Promise<void> {
  registerSceneAgentWorkGraphRoutes(app)
  registerSceneAgentLocateRoutes(app)
  registerSceneAgentLensRoutes(app)
  registerSceneAgentProposeRoutes(app)
  registerSceneAgentTransactionRoutes(app)
}
