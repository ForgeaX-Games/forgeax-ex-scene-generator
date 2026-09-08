import Fastify, { type FastifyInstance } from 'fastify'
import { registerQueryRoutes } from './routes/queries.js'
import { registerMutationRoutes } from './routes/mutations.js'
import { registerPipelineImportRoutes } from './routes/pipelineImport.js'
import { registerExecuteRoutes } from './routes/execute.js'
import { registerWsRoutes } from './routes/ws.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerGroupTemplateRoutes } from './routes/groupTemplates.js'
import { registerGeneratedAssetRoutes } from './assets/routes.js'
import { registerAiRoutes } from './ai/routes.js'
import { registerPresetRoutes } from './presets/routes.js'
import { registerPromptRoutes } from './prompts/routes.js'
import { getRuntime, stopBatteryWatch } from './runtime.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Release the dev battery watcher on shutdown so `app.close()` lets the
  // process exit (an open chokidar watch keeps the event loop alive).
  app.addHook('onClose', async () => stopBatteryWatch())
  app.get('/health', async () => ({ status: 'ok' }))
  await registerQueryRoutes(app)
  await registerMutationRoutes(app)
  await registerPipelineImportRoutes(app)
  await registerExecuteRoutes(app)
  await registerWsRoutes(app)
  await registerProjectRoutes(app)
  await registerGroupTemplateRoutes(app)
  await registerGeneratedAssetRoutes(app)
  await registerAiRoutes(app)
  await registerPresetRoutes(app)
  await registerPromptRoutes(app)
  await getRuntime()
  return app
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 9567)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[wb-2d-scene-asset-generator backend] listening on :${port}`)
}
