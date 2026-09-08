import type { FastifyInstance } from 'fastify'
import { registerProjectPipelineRoutes } from '@forgeax/editor-host/backend'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { extractCaller } from './projects.js'
import { getBatteryCategories } from './batteryCategories.js'

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  await registerProjectPipelineRoutes(app, {
    getProjectRegistry,
    getRuntimeForProject,
    extractCaller,
    getBatteryCategories: async () =>
      (await getBatteryCategories()) as unknown as Map<string, Record<string, unknown>>,
  })
}
