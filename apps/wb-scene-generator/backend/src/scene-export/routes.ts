import { createReadStream, statSync } from 'node:fs'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { listBakedLayersForProjectDir } from '../baked/store.js'
import {
  listMergedAliasMetasAllZonesForProjectDir,
  resolveMergedAssetContentForProjectDir,
} from '../library/mergedLibraryPool.js'
import { getActiveProjectDir, getProjectDir, getProjectRegistry } from '../runtime.js'
import { buildSceneAtlases } from './atlas.js'
import { writeSceneBundle } from './bundle.js'
import { cookBakedScene } from './cooker.js'
import { applyNarrativeAreaTags, type NarrativeInput } from './narrativeAreaTags.js'
import { decodePng, type RgbaImage } from './png.js'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scene'
}

function bundleId(sceneName: string, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-')
  return `${slugify(sceneName)}-${stamp}`
}

type HeaderValue = string | string[] | undefined
export type NetworkInterfacesProvider = () => NodeJS.Dict<NetworkInterfaceInfo[]>

function firstHeaderValue(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw?.split(',')[0]?.trim()
  return first || undefined
}

function parseHost(host: string | undefined): { host: string; hostname: string; port: string } | undefined {
  if (!host) return undefined
  try {
    const url = new URL(`http://${host}`)
    return {
      host: url.host,
      hostname: url.hostname.toLowerCase(),
      port: url.port,
    }
  } catch {
    return undefined
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '0:0:0:0:0:0:0:1'
    || hostname.startsWith('127.')
    || hostname === '0.0.0.0'
}

function isExternalIpv4(address: NetworkInterfaceInfo): boolean {
  return !address.internal
    && address.family === 'IPv4'
    && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address.address)
}

export function preferredExternalIpv4(provider: NetworkInterfacesProvider = networkInterfaces): string | undefined {
  for (const entries of Object.values(provider())) {
    for (const entry of entries ?? []) {
      if (isExternalIpv4(entry)) return entry.address
    }
  }
  return undefined
}

function sceneExportDownloadHost(req: FastifyRequest, provider: NetworkInterfacesProvider): string {
  const forwardedHost = parseHost(firstHeaderValue(req.headers['x-forwarded-host']))
  const requestHost = parseHost(firstHeaderValue(req.headers.host))
  const realHost = [forwardedHost, requestHost].find((candidate) => candidate && !isLocalHostname(candidate.hostname))
  if (realHost) return realHost.host

  const localHost = requestHost ?? forwardedHost
  const lanIp = preferredExternalIpv4(provider)
  if (lanIp) return localHost?.port ? `${lanIp}:${localHost.port}` : lanIp
  return localHost?.host ?? 'localhost'
}

function sceneExportDownloadProtocol(req: FastifyRequest): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'])?.replace(/:$/, '')
  if (forwardedProto) return forwardedProto
  return req.protocol || 'http'
}

export function buildSceneExportDownloadUrl(
  req: FastifyRequest,
  projectId: string,
  bundleId: string,
  provider: NetworkInterfacesProvider = networkInterfaces,
): string {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/scene-export/download/${encodeURIComponent(bundleId)}`
  return `${sceneExportDownloadProtocol(req)}://${sceneExportDownloadHost(req, provider)}${path}`
}

async function resolveCookProject(projectId?: string): Promise<{ projectId: string; projDir: string }> {
  const trimmed = projectId?.trim()
  if (trimmed) {
    const projDir = await getProjectDir(trimmed)
    if (!projDir) throw new Error(`project not found: ${trimmed}`)
    return { projectId: trimmed, projDir }
  }
  const reg = await getProjectRegistry()
  const viewingId = reg.getViewingProjectId()
  if (!viewingId) throw new Error('no projectId and no viewing project')
  const projDir = await getActiveProjectDir()
  return { projectId: viewingId, projDir }
}

function sceneZipPathForBundle(projDir: string, bundleId: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(bundleId)) return undefined
  const exportRoot = resolve(projDir, 'exports', 'scene')
  const zipPath = resolve(exportRoot, bundleId, 'scene.zip')
  const rel = relative(exportRoot, zipPath)
  if (rel.startsWith('..') || rel === '..' || rel.includes(`..${sep}`) || resolve(zipPath) === exportRoot) return undefined
  return zipPath
}

async function cookSceneForProject(
  req: FastifyRequest,
  projectId: string | undefined,
  body: { sceneName?: string; allowMissingAssets?: boolean; narrative?: NarrativeInput },
) {
  const sceneName = body.sceneName?.trim() || 'Scene'
  const generatedAt = new Date()
  const { projectId: resolvedId, projDir } = await resolveCookProject(projectId)
  const bakedLayers = listBakedLayersForProjectDir(projDir)
  const layers = body.narrative ? applyNarrativeAreaTags(bakedLayers, body.narrative) : bakedLayers
  const aliases = listMergedAliasMetasAllZonesForProjectDir(projDir)
  // cookBakedScene calls resolveRuleImage synchronously during variant sampling;
  // preload atlas PNGs here so the sync callback can hit a warm cache.
  const ruleImageCache = new Map<string, RgbaImage | null>()
  for (const meta of aliases) {
    const keys = new Set<string>([meta.alias])
    if (meta.tileType) keys.add(meta.tileType)
    for (const key of keys) {
      if (ruleImageCache.has(key)) continue
      const content = await resolveMergedAssetContentForProjectDir(projDir, meta.alias)
      if (!content) {
        ruleImageCache.set(key, null)
        continue
      }
      try {
        ruleImageCache.set(key, decodePng(content.bytes))
      } catch {
        ruleImageCache.set(key, null)
      }
    }
  }
  const cooked = cookBakedScene({
    bundleId: bundleId(sceneName, generatedAt),
    sceneName,
    layers,
    aliases,
    generatedAt,
    resolveRuleImage: (alias) => ruleImageCache.get(alias) ?? null,
  })
  const atlases = await buildSceneAtlases(cooked, {
    allowMissingAssets: body.allowMissingAssets === true,
    resolveAssetContent: (alias) => resolveMergedAssetContentForProjectDir(projDir, alias),
  })
  const out = await writeSceneBundle({
    activeProjectDir: projDir,
    cooked,
    atlases,
  })
  return {
    ...out,
    projectId: resolvedId,
    downloadUrl: buildSceneExportDownloadUrl(req, resolvedId, out.bundleId),
    warnings: cooked.warnings,
  }
}

async function sendSceneExportDownload(
  reply: FastifyReply,
  projDir: string,
  bundleId: string,
) {
  const zipPath = sceneZipPathForBundle(projDir, bundleId)
  if (!zipPath) return reply.code(404).send({ error: 'scene export bundle not found' })
  let zipStats: ReturnType<typeof statSync>
  try {
    zipStats = statSync(zipPath)
    if (!zipStats.isFile()) return reply.code(404).send({ error: 'scene export bundle not found' })
  } catch {
    return reply.code(404).send({ error: 'scene export bundle not found' })
  }

  reply.header('Content-Type', 'application/octet-stream')
  reply.header('Content-Disposition', 'attachment; filename="scene.zip"')
  reply.header('Content-Length', String(zipStats.size))
  reply.header('Cache-Control', 'no-store')
  reply.header('X-Content-Type-Options', 'nosniff')
  return reply.send(createReadStream(zipPath))
}

export async function registerSceneExportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/scene-export/cook', async (req, reply) => {
    const body = (req.body ?? {}) as { projectId?: string; sceneName?: string; allowMissingAssets?: boolean; narrative?: NarrativeInput }
    try {
      return await cookSceneForProject(req, body.projectId, body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message })
    }
  })

  app.post<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/scene-export/cook',
    async (req, reply) => {
      const body = (req.body ?? {}) as { sceneName?: string; allowMissingAssets?: boolean; narrative?: NarrativeInput }
      try {
        return await cookSceneForProject(req, req.params.projectId, body)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return reply.code(400).send({ error: message })
      }
    },
  )

  app.get<{ Params: { projectId: string; bundleId: string } }>(
    '/api/v1/projects/:projectId/scene-export/download/:bundleId',
    async (req, reply) => {
      const projDir = await getProjectDir(req.params.projectId)
      if (!projDir) return reply.code(404).send({ error: 'project not found' })
      return sendSceneExportDownload(reply, projDir, req.params.bundleId)
    },
  )

  // Legacy download — resolves viewing project when projectId query param is absent.
  app.get<{ Params: { bundleId: string }; Querystring: { projectId?: string } }>(
    '/api/v1/scene-export/download/:bundleId',
    async (req, reply) => {
      const projectId = req.query.projectId?.trim()
      const projDir = projectId ? await getProjectDir(projectId) : await getActiveProjectDir()
      if (!projDir) return reply.code(404).send({ error: 'project not found' })
      return sendSceneExportDownload(reply, projDir, req.params.bundleId)
    },
  )
}
