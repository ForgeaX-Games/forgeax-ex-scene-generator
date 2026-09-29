import type { FastifyInstance } from 'fastify'

import { registerSceneScriptCommandRoutes } from './commands.js'
import { registerSceneScriptCommitRoutes } from './commit.js'
import { registerSceneScriptCompletionRoutes } from './completion.js'
import { registerSceneScriptContractRoutes } from './contracts.js'
import { registerSceneScriptDefinitionRoutes } from './definitions.js'
import { registerSceneScriptDraftPreviewRoutes } from './draft-preview.js'
import { registerSceneScriptHistoryRoutes } from './history.js'
import { registerSceneScriptLensRoutes } from './lens.js'
import { registerSceneScriptProjectRoutes } from './project.js'
import { registerSceneScriptSourceRoutes } from './source.js'

export async function registerSceneScriptRoutes(app: FastifyInstance): Promise<void> {
  registerSceneScriptProjectRoutes(app)
  registerSceneScriptHistoryRoutes(app)
  registerSceneScriptSourceRoutes(app)
  registerSceneScriptCommitRoutes(app)
  registerSceneScriptCompletionRoutes(app)
  registerSceneScriptDraftPreviewRoutes(app)
  registerSceneScriptContractRoutes(app)
  registerSceneScriptLensRoutes(app)
  registerSceneScriptDefinitionRoutes(app)
  registerSceneScriptCommandRoutes(app)
}
