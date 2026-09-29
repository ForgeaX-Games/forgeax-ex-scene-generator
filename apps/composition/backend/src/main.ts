import Fastify, { type FastifyInstance } from 'fastify'
import { registerQueryRoutes } from './routes/queries.js'
import { registerMutationRoutes } from './routes/mutations.js'
import { registerPipelineImportRoutes } from './routes/pipelineImport.js'
import { registerExecuteRoutes } from './routes/execute.js'
import { registerWsRoutes } from './routes/ws.js'
import { registerScreenshotRoutes } from './agent/routes.js'
import { registerRendererAgentRoutes } from './agent/rendererRoutes.js'
import { registerLibraryRoutes } from './library/routes.js'
import { registerPrivateLibraryRoutes } from './library/privateRoutes.js'
import { registerMaterialsRoutes } from './materials/routes.js'
import { registerObjectModelRoutes } from './models/routes.js'
import { registerBakedRoutes } from './baked/routes.js'
import { registerSceneExportRoutes } from './scene-export/routes.js'
import { registerMesh3dExportRoutes } from './mesh3d-export/routes.js'
import { registerGlbExportRoutes } from './export/routes.js'
import { registerPackExportRoutes } from './pack-export/routes.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerGroupTemplateRoutes } from './routes/groupTemplates.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerCanvasPerfDebugRoutes } from './routes/canvasPerfDebug.js'
import { registerSceneScriptRoutes } from './routes/scene-script/index.js'
import { registerPackRoutes } from './routes/packs.js'
import {
  ACTIVE_GAME_REQUIRED,
  disposeRuntimeState,
  getRuntime,
  getRuntimeBindingStatus,
  isActiveGameRequiredError,
} from './runtime.js'
import { isCanvasPerfDebugEnabled, logPerfDebugStartup } from './lib/canvasPerfDebug.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.setErrorHandler((error, _request, reply) => {
    if (isActiveGameRequiredError(error)) {
      return reply.code(409).send({
        status: 'waiting',
        code: ACTIVE_GAME_REQUIRED,
        message: error.message,
        retryable: true,
      })
    }
    return reply.send(error)
  })
  // Perf debug hooks must register before route handlers so every request is timed.
  await registerCanvasPerfDebugRoutes(app)
  logPerfDebugStartup()
  // Release the dev battery watcher on shutdown so `app.close()` lets the
  // process exit (an open chokidar watch keeps the event loop alive).
  app.addHook('onClose', async () => disposeRuntimeState())
  app.get('/health', async () => ({
    status: 'ok',
    instanceId: process.env.FORGEAX_PLUGIN_BOOT_ID ?? null,
    uiUrl: process.env.FORGEAX_SCENE_UI_URL ?? null,
    ...getRuntimeBindingStatus(),
  }))
  await registerQueryRoutes(app)
  await registerPackRoutes(app)
  await registerMutationRoutes(app)
  await registerPipelineImportRoutes(app)
  await registerExecuteRoutes(app)
  await registerWsRoutes(app)
  await registerScreenshotRoutes(app)
  await registerRendererAgentRoutes(app)
  await registerLibraryRoutes(app)
  await registerPrivateLibraryRoutes(app)
  await registerMaterialsRoutes(app)
  await registerObjectModelRoutes(app)
  await registerBakedRoutes(app)
  await registerSceneExportRoutes(app)
  await registerMesh3dExportRoutes(app)
  await registerGlbExportRoutes(app)
  await registerPackExportRoutes(app)
  await registerProjectRoutes(app)
  await registerGroupTemplateRoutes(app)
  await registerSceneScriptRoutes(app)
  await registerAssetRoutes(app)
  // Preserve the established warm-start contract when a workspace is already
  // usable, but do not let Studio's expected pre-game phase prevent listening.
  // Hydrate reads `.scene.ts`; a TDZ / host throw must not keep :9557 closed.
  if (getRuntimeBindingStatus().binding === 'ready') {
    try {
      await getRuntime()
    } catch (error) {
      console.error('[scene-generator] warm-start hydrate failed; still listening', error)
    }
  }
  return app
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 9557)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[scene-generator backend] listening on :${port}`)
  if (isCanvasPerfDebugEnabled()) {
    console.log(
      `[scene-generator backend] FORGEAX_CANVAS_PERF_DEBUG=${process.env.FORGEAX_CANVAS_PERF_DEBUG} — canvas perf logs on stdout`,
    )
  }
}
