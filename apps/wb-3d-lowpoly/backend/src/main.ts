import Fastify, { type FastifyInstance } from 'fastify'
import { registerQueryRoutes } from './routes/queries.js'
import { registerMutationRoutes } from './routes/mutations.js'
import { registerPipelineImportRoutes } from './routes/pipelineImport.js'
import { registerExecuteRoutes } from './routes/execute.js'
import { registerWsRoutes } from './routes/ws.js'
import { registerLibraryRoutes } from './routes/library.js'
import { registerScreenshotRoutes } from './agent/routes.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerGroupTemplateRoutes } from './routes/groupTemplates.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerModelRoutes } from './routes/model.js'
import { getRuntime, stopBatteryWatch } from './runtime.js'
import { warmUpBaker } from './services/baker-context.js'

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
  await registerLibraryRoutes(app)
  await registerScreenshotRoutes(app)
  await registerProjectRoutes(app)
  await registerGroupTemplateRoutes(app)
  await registerAssetRoutes(app)
  await registerModelRoutes(app)
  await getRuntime()
  // Non-blocking OCCT WASM warmup: the first bake otherwise pays the ~1-2s WASM
  // boot inline. Fire-and-forget so the server starts serving immediately; a
  // warmup failure is logged but never blocks startup (baker re-tries on demand).
  void warmUpBaker().catch((err) => {
    console.warn(`[baker] warmup skipped: ${err instanceof Error ? err.message : String(err)}`)
  })
  return app
}

// Guard against a mid-conversation "the process just died" failure mode: with
// no listener here, Node's default action for an uncaught exception / rejected
// promise that nobody awaits (a stray broadcast, a WS handler, a fire-and-forget
// timer callback — none of which run inside a Fastify request lifecycle Fastify
// itself can catch) is to crash the whole backend. That instantly kills EVERY
// agent's in-flight tool call and wipes the in-memory session/lock tables, which
// looks exactly like "the agent conversation suddenly got cut off" — and the
// next turn's reopen/retry finds a blank slate, i.e. "forgot what it was doing".
// Logging-and-surviving trades a theoretical risk of continuing after corrupted
// state for the much more common and disruptive one of killing every active
// session over a single unrelated bug; this backend has no critical in-memory
// invariants that a stray rejection is likely to violate (project state is
// re-read from disk per request via ProjectRegistry).
function installCrashGuards(): void {
  process.on('uncaughtException', (err) => {
    console.error('[wb-3d-lowpoly backend] uncaughtException (process kept alive):', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[wb-3d-lowpoly backend] unhandledRejection (process kept alive):', reason)
  })
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  installCrashGuards()
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 9567)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[wb-3d-lowpoly backend] listening on :${port}`)
}
