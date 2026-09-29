import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getPipeline } from '@forgeax/node-runtime'
import {
  getActiveProjectDir,
  getProjectDir,
  getProjectRegistry,
  getRuntimeForProject,
  resolveActiveGameSlug,
  resolveSharedGamesRoot,
  resolveWorkspaceRoot,
} from '../runtime.js'
import { runSceneProject } from '../scene-script/run/runProject.js'
import { readSceneModule } from '../scene-script/persist/store.js'
import {
  parseScenePort,
  type SceneMesh,
} from '../../../vendor/dist/shared/types/index.js'
import { buildGlbBuffer, type GlbMeshInput } from './glbBuilder.js'

export interface ExportSceneGlbOptions {
  projectId?: string
  name?: string
  gameSlug?: string
  destDir?: string
  sceneName?: string
}

export interface ExportSceneGlbResult {
  ok: boolean
  name: string
  filename: string
  path: string
  relPath: string
  gameSlug: string | null
  bytes: number
  meshCount: number
  triangleCount: number
  vertexCount: number
  nodes: string[]
  message: string
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scene'
}

function isMeshObject(val: unknown): val is SceneMesh {
  if (!val || typeof val !== 'object') return false
  const rec = val as { positions?: unknown; indices?: unknown }
  return Array.isArray(rec.positions) && Array.isArray(rec.indices) && rec.positions.length >= 9 && rec.indices.length >= 3
}

function unwrapAllItems(val: unknown, depth = 0): unknown[] {
  if (val === null || val === undefined || depth > 8) return []
  if (Array.isArray(val)) {
    const out: unknown[] = []
    for (const entry of val) {
      if (entry && typeof entry === 'object' && Array.isArray((entry as { items?: unknown[] }).items)) {
        out.push(...unwrapAllItems((entry as { items: unknown[] }).items, depth + 1))
      } else {
        out.push(...unwrapAllItems(entry, depth + 1))
      }
    }
    return out
  }
  if (typeof val === 'object' && val !== null && Array.isArray((val as { items?: unknown[] }).items)) {
    return unwrapAllItems((val as { items: unknown[] }).items, depth + 1)
  }
  return [val]
}

function extractAllSceneMeshes(outputs: Record<string, Record<string, unknown>>): Array<{ name: string; mesh: SceneMesh }> {
  const extracted: Array<{ name: string; mesh: SceneMesh }> = []
  const seenMeshes = new Set<unknown>()

  for (const [nodeId, ports] of Object.entries(outputs)) {
    if (!ports || typeof ports !== 'object') continue

    for (const [portName, portRawVal] of Object.entries(ports)) {
      if (!portRawVal) continue
      const items = unwrapAllItems(portRawVal)

      for (const item of items) {
        if (!item || typeof item !== 'object') continue

        // 1. ScenePort value: { graph, focus }
        const port = parseScenePort(item)
        if (port && port.graph) {
          for (const node of port.graph.values()) {
            const content = node.content
            if (!content || typeof content !== 'object') continue
            const possibleMesh = (content as { mesh?: unknown }).mesh
            if (isMeshObject(possibleMesh) && !seenMeshes.has(possibleMesh)) {
              seenMeshes.add(possibleMesh)
              extracted.push({
                name: node.name || node.id || 'ground',
                mesh: possibleMesh,
              })
            }
          }
        }

        // 2. Direct mesh payload: { mesh: SceneMesh }
        const possibleMeshWrapper = (item as { mesh?: unknown }).mesh
        if (isMeshObject(possibleMeshWrapper) && !seenMeshes.has(possibleMeshWrapper)) {
          seenMeshes.add(possibleMeshWrapper)
          extracted.push({
            name: (item as { name?: unknown }).name && typeof (item as { name?: unknown }).name === 'string'
              ? (item as { name: string }).name
              : nodeId || portName || 'terrain',
            mesh: possibleMeshWrapper,
          })
        } else if (isMeshObject(item) && !seenMeshes.has(item)) {
          seenMeshes.add(item)
          extracted.push({
            name: nodeId || portName || 'terrain',
            mesh: item,
          })
        }
      }
    }
  }

  return extracted
}

async function resolveTargetProject(projectId?: string): Promise<{
  projectId: string
  projDir: string
  gameSlug: string | undefined
  projectName: string
}> {
  const reg = await getProjectRegistry()
  const trimmed = projectId?.trim()
  if (trimmed) {
    const rec = reg.getProject(trimmed)
    if (!rec) throw new Error(`Project not found: ${trimmed}`)
    const projDir = await getProjectDir(trimmed)
    if (!projDir) throw new Error(`Project directory not found: ${trimmed}`)
    return {
      projectId: trimmed,
      projDir,
      gameSlug: rec.manifest.gameSlug,
      projectName: rec.manifest.name,
    }
  }

  const viewingId = reg.getViewingProjectId()
  if (!viewingId) throw new Error('No projectId provided and no viewing project is currently open.')
  const rec = reg.getProject(viewingId)
  if (!rec) throw new Error(`Viewing project not found: ${viewingId}`)
  const projDir = await getActiveProjectDir()
  return {
    projectId: viewingId,
    projDir,
    gameSlug: rec.manifest.gameSlug,
    projectName: rec.manifest.name,
  }
}

export async function exportProjectSceneToGlb(options: ExportSceneGlbOptions): Promise<ExportSceneGlbResult> {
  const { projectId, projDir, gameSlug: boundGameSlug, projectName } = await resolveTargetProject(options.projectId)

  // Determine gameSlug: explicit option -> project manifest -> active game
  let activeGame: string | null = null
  try {
    activeGame = resolveActiveGameSlug()
  } catch {
    activeGame = null
  }
  const gameSlug = (options.gameSlug?.trim() || boundGameSlug || activeGame || '').trim() || null

  const stored = await readSceneModule(projDir).catch(() => ({ file: 'main.scene.ts', source: '' }))
  const runtime = await getRuntimeForProject(projectId)
  const ran = stored.source.trim()
    ? await runSceneProject({
        projectId,
        projectDir: projDir,
        runtime,
        entryFile: stored.file,
        actor: 'scene-script:export',
        label: 'Export GLB Scene run',
      }).catch((err) => {
        console.warn(`[exportGlb] runSceneProject failed: ${err.message}`)
        return null
      })
    : null
  const outputs = ((ran?.execution.outputs ?? {}) as Record<string, Record<string, unknown>>)

  // Also harvest cached node outputs from runtime.outputs for all nodes in the pipeline
  const snap = getPipeline(runtime)
  if (snap?.nodes) {
    const pipelineNodes = Array.isArray(snap.nodes) ? snap.nodes : Object.values(snap.nodes)
    for (const n of pipelineNodes) {
      if (!n?.id) continue
      const portNames = runtime.outputs.listPorts(n.id)
      if (!outputs[n.id]) outputs[n.id] = {}
      for (const p of portNames) {
        if (outputs[n.id][p] === undefined) {
          const cached = runtime.outputs.read(n.id, p)
          if (cached?.data !== undefined) {
            outputs[n.id][p] = cached.data
          }
        }
      }
    }
  }

  const rawMeshes = extractAllSceneMeshes(outputs)

  if (rawMeshes.length === 0) {
    throw new Error(
      'No 3D meshes found in project execution output. GLB is a triangle-mesh asset. Add Geometry mesh (for example heightfieldMesh) or skip export when the scene is voxel or grid only.',
    )
  }

  // Deduplicate and format mesh inputs
  const seenMeshNames = new Map<string, number>()
  const glbMeshInputs: GlbMeshInput[] = []

  for (const item of rawMeshes) {
    const rawName = slugify(item.name)
    const count = (seenMeshNames.get(rawName) ?? 0) + 1
    seenMeshNames.set(rawName, count)
    const meshName = count === 1 ? rawName : `${rawName}_${count}`

    const isWater = /water|lake|ocean|river|sea/i.test(meshName)
    const baseColorFactor: [number, number, number, number] = isWater
      ? [0.25, 0.55, 0.85, 0.85]
      : [1.0, 1.0, 1.0, 1.0]

    glbMeshInputs.push({
      name: meshName,
      positions: Array.from(item.mesh.positions),
      indices: Array.from(item.mesh.indices),
      normals: item.mesh.normals ? Array.from(item.mesh.normals) : undefined,
      colors: item.mesh.colors ? Array.from(item.mesh.colors) : undefined,
      material: {
        name: `${meshName}_material`,
        baseColorFactor,
        roughnessFactor: isWater ? 0.1 : 0.85,
        metallicFactor: isWater ? 0.1 : 0.0,
      },
    })
  }

  const safeSceneName = options.sceneName?.trim() || projectName || 'Scene'
  const safeFilename = slugify(options.name?.trim() || options.sceneName?.trim() || projectName || 'scene')

  const glb = buildGlbBuffer(glbMeshInputs, { sceneName: safeSceneName })

  // Determine write locations
  let writtenPath = ''
  let writtenRelPath = ''

  if (gameSlug) {
    const sharedGames = resolveSharedGamesRoot()
    const gameRoot = join(sharedGames, gameSlug)
    const subDir = (options.destDir?.trim() || 'assets/3d').replace(/^[/\\]+|[/\\]+$/g, '')
    const targetDir = join(gameRoot, subDir)
    mkdirSync(targetDir, { recursive: true })
    const targetFile = join(targetDir, `${safeFilename}.glb`)
    writeFileSync(targetFile, glb.buffer)
    writtenPath = targetFile
    writtenRelPath = join(subDir, `${safeFilename}.glb`)

    // Also mirror to standalone runtime workspace games dir if distinct
    const wsRoot = resolveWorkspaceRoot()
    const wsGameDir = join(wsRoot, '.forgeax', 'games', gameSlug, subDir)
    if (wsGameDir !== targetDir && existsSync(wsRoot)) {
      mkdirSync(wsGameDir, { recursive: true })
      writeFileSync(join(wsGameDir, `${safeFilename}.glb`), glb.buffer)
    }
  }

  // Also write to project-local assets folder if project exists
  if (projDir && existsSync(projDir)) {
    const localAssetsDir = join(projDir, 'assets', '3d')
    mkdirSync(localAssetsDir, { recursive: true })
    const localFile = join(localAssetsDir, `${safeFilename}.glb`)
    writeFileSync(localFile, glb.buffer)
    if (!writtenPath) {
      writtenPath = localFile
      writtenRelPath = join('assets', '3d', `${safeFilename}.glb`)
    }
  }

  const nodeNames = glbMeshInputs.map((m) => m.name)

  return {
    ok: true,
    name: safeFilename,
    filename: `${safeFilename}.glb`,
    path: writtenPath,
    relPath: writtenRelPath,
    gameSlug,
    bytes: glb.byteLength,
    meshCount: glb.meshCount,
    triangleCount: glb.totalTriangles,
    vertexCount: glb.totalVertices,
    nodes: nodeNames,
    message: `Successfully exported 3D scene GLB to ${writtenRelPath} (${glb.totalTriangles.toLocaleString()} triangles, ${(glb.byteLength / 1024).toFixed(1)} KB, nodes: ${nodeNames.join(', ')})`,
  }
}
