import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { listBakedLayersForProjectDir } from '../baked/store.js'
import { getActiveProjectDir, getProjectDir, getProjectRegistry, resolveSharedGamesRoot } from '../runtime.js'
import { cookMesh3dScene } from './cooker.js'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scene'
}

async function resolveCookProject(projectId?: string): Promise<{
  projectId: string
  projDir: string
  gameSlug: string | undefined
  projectName: string
}> {
  const reg = await getProjectRegistry()
  const trimmed = projectId?.trim()
  if (trimmed) {
    const rec = reg.getProject(trimmed)
    if (!rec) throw new Error(`project not found: ${trimmed}`)
    const projDir = await getProjectDir(trimmed)
    if (!projDir) throw new Error(`project not found: ${trimmed}`)
    return {
      projectId: trimmed,
      projDir,
      gameSlug: rec.manifest.gameSlug,
      projectName: rec.manifest.name,
    }
  }
  const viewingId = reg.getViewingProjectId()
  if (!viewingId) throw new Error('no projectId and no viewing project')
  const rec = reg.getProject(viewingId)
  if (!rec) throw new Error(`project not found: ${viewingId}`)
  const projDir = await getActiveProjectDir()
  return {
    projectId: viewingId,
    projDir,
    gameSlug: rec.manifest.gameSlug,
    projectName: rec.manifest.name,
  }
}

async function cookMesh3dForProject(body: {
  projectId?: string
  sceneName?: string
  sceneId?: string
  gameSlug?: string
  allowMissingAssets?: boolean
}) {
  const { projectId, projDir, gameSlug: projectGameSlug, projectName } = await resolveCookProject(body.projectId)
  // Precedence: explicit request (UI active game / agent override) → project tag.
  const gameSlug = (body.gameSlug?.trim() || projectGameSlug || '').trim()
  if (!gameSlug) {
    throw new Error('no gameSlug; pass gameSlug (active game) or bind the project to a game')
  }
  if (gameSlug.includes('..') || gameSlug.includes('/') || gameSlug.includes('\\')) {
    throw new Error(`invalid gameSlug: ${gameSlug}`)
  }

  const sceneName = body.sceneName?.trim() || projectName || 'Scene'
  const sceneId = (body.sceneId?.trim() || projectId || slugify(sceneName)).trim()
  // Host Studio games root — NOT workbench FORGEAX_PROJECT_ROOT (see resolveSharedGamesRoot).
  const gameRoot = join(resolveSharedGamesRoot(), gameSlug)
  const layers = listBakedLayersForProjectDir(projDir)

  const out = cookMesh3dScene({
    projectId,
    sceneId,
    sceneName,
    gameSlug,
    gameRoot,
    layers,
    allowMissingAssets: body.allowMissingAssets === true,
  })

  return {
    ...out,
    projectId,
    sceneName,
  }
}

export async function registerMesh3dExportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/mesh3d-export/cook', async (req, reply) => {
    const body = (req.body ?? {}) as {
      projectId?: string
      sceneName?: string
      sceneId?: string
      gameSlug?: string
      allowMissingAssets?: boolean
    }
    try {
      return await cookMesh3dForProject(body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message })
    }
  })

  app.post<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/mesh3d-export/cook',
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        sceneName?: string
        sceneId?: string
        gameSlug?: string
        allowMissingAssets?: boolean
      }
      try {
        return await cookMesh3dForProject({ ...body, projectId: req.params.projectId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return reply.code(400).send({ error: message })
      }
    },
  )
}
