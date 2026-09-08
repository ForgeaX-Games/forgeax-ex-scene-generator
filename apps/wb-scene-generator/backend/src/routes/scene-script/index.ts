import type { FastifyInstance } from 'fastify'

import { registerSceneScriptCommandRoutes } from './commands.js'
import { registerSceneScriptCommitRoutes } from './commit.js'
import { registerSceneScriptCompletionRoutes } from './completion.js'
import { registerSceneScriptContractRoutes } from './contracts.js'
import { registerSceneScriptDefinitionRoutes } from './definitions.js'
import { registerSceneScriptDraftPreviewRoutes } from './draft-preview.js'
import { registerSceneScriptHistoryRoutes } from './history.js'
import { registerSceneScriptLensRoutes } from './lens.js'
import { registerSceneScriptLiftRoutes } from './lift.js'
import { registerSceneScriptProjectRoutes } from './project.js'
import { registerSceneScriptReferenceRoutes } from './references.js'
import { registerSceneScriptScaffoldRoutes } from './scaffold.js'
import { registerSceneScriptSourceRoutes } from './source.js'

export async function registerSceneScriptRoutes(app: FastifyInstance): Promise<void> {
  registerSceneScriptProjectRoutes(app)
  registerSceneScriptHistoryRoutes(app)
  registerSceneScriptLiftRoutes(app)
  registerSceneScriptSourceRoutes(app)
  registerSceneScriptCommitRoutes(app)
  registerSceneScriptCompletionRoutes(app)
  registerSceneScriptDraftPreviewRoutes(app)
  registerSceneScriptScaffoldRoutes(app)
  registerSceneScriptReferenceRoutes(app)
  registerSceneScriptContractRoutes(app)
  registerSceneScriptLensRoutes(app)
  registerSceneScriptDefinitionRoutes(app)
  registerSceneScriptCommandRoutes(app)
}
