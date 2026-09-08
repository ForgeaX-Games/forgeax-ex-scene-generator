/**
 * Baked scene-layer routes — the editable, graph-independent layer service the
 * preview's edit mode reads & writes. Persists to `<activeProject>/baked-scene.json`
 * (see ./store.ts). Every mutation broadcasts `baked:changed` so the renderer
 * (and any other client) re-pulls. The node graph is never touched here.
 */
import type { FastifyInstance } from 'fastify'
import { executeNode, getPipeline, type ExecuteNodeRequest } from '@forgeax/node-runtime'
import { broadcastToClients } from '../routes/ws.js'
import {
  addBakedLayer,
  bakeLayers,
  bakeLayersForProject,
  ensurePaintTarget,
  getBakedHistoryStatus,
  listBakedLayers,
  listBakedLayersForProjectDir,
  listBakedLayersSummaryForProjectDir,
  moveBakedLayer,
  patchBakedCustomAttributes,
  redoBakedHistory,
  removeBakedLayer,
  renameBakedLayer,
  setBakedCells,
  undoBakedHistory,
  type BakedCell,
} from './store.js'
import { buildBakeLayersFromExecutionResult, collectTerminalPorts } from './snapshot-from-execute.js'
import { getProjectDir, getActiveProjectDir, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from '../routes/projects.js'
import { syncTrace } from '../debug/syncTrace.js'
import { attachBakedLayers, buildExecutionLineage } from '../scene-script/agent/lineage.js'
import { readAuthoringState, writeResultLineage } from '../scene-script/persist/store.js'

/** Fastify default bodyLimit is 1MB — large voxel bake/paint payloads exceed it (HTTP 413). */
const BAKED_VOXEL_BODY_LIMIT = 64 * 1024 * 1024

// Broadcast + log every mutation so the baked-layer edit flow is traceable in
// the backend console (these are infrequent, user-driven actions).
function notifyChanged(msg: string, projectId?: string): void {
  syncTrace('backend:baked-mutation', { msg, projectId })
  console.log(`[baked] ${msg}`)
  broadcastToClients({ event: 'baked:changed', payload: projectId ? { projectId } : {} })
}

async function persistBakedLineage(
  projectDir: string,
  layers: ReadonlyArray<{ nodePath?: string }>,
  paths: readonly string[],
): Promise<void> {
  const state = await readAuthoringState(projectDir)
  if (!state?.resultLineage) return
  const mappings = paths.flatMap((bakedPath, index) => {
    const sourcePath = layers[index]?.nodePath
    return sourcePath ? [{ sourcePath, bakedPath }] : []
  })
  await writeResultLineage(projectDir, attachBakedLayers(state.resultLineage, mappings))
}

export async function registerBakedRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { mode?: string } }>('/api/v1/baked/layers', async (req) => {
    if (req.query.mode === 'summary') {
      const projDir = await getActiveProjectDir()
      return listBakedLayersSummaryForProjectDir(projDir)
    }
    return { layers: await listBakedLayers() }
  })

  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/v1/projects/:id/baked/layers',
    async (req, reply) => {
      const projDir = await getProjectDir(req.params.id)
      if (!projDir) return reply.code(404).send({ error: 'project not found' })
      if (req.query.mode === 'summary') {
        return listBakedLayersSummaryForProjectDir(projDir)
      }
      return { layers: listBakedLayersForProjectDir(projDir) }
    },
  )

  app.get('/api/v1/baked/history', async () => getBakedHistoryStatus())

  app.post('/api/v1/baked/history/undo', async () => {
    const status = await undoBakedHistory()
    notifyChanged('undo baked edit')
    return status
  })

  app.post('/api/v1/baked/history/redo', async () => {
    const status = await redoBakedHistory()
    notifyChanged('redo baked edit')
    return status
  })

  app.post('/api/v1/baked/layers', async (req) => {
    const b = (req.body ?? {}) as { name?: string; parentPath?: string }
    const path = await addBakedLayer(b.name ?? 'Layer', b.parentPath ?? '/')
    notifyChanged(`+ layer ${path}`)
    return { path }
  })

  // Add a sub-layer (tree child) under an existing layer.
  app.post('/api/v1/baked/sublayer', async (req, reply) => {
    const b = (req.body ?? {}) as { parentPath?: string; name?: string }
    if (!b.parentPath) return reply.code(400).send({ error: 'parentPath is required' })
    const path = await addBakedLayer(b.name ?? 'Sub', b.parentPath)
    notifyChanged(`+ sub-layer ${path}`)
    return { path }
  })

  // Resolve which layer a paint stroke of `asset` under `parentPath` writes into,
  // creating a `layer-n` sub-layer if the asset differs from the active layer's.
  // Returns the target path; the renderer then PATCHes its cells to that path.
  app.post('/api/v1/baked/target', async (req, reply) => {
    const b = (req.body ?? {}) as { parentPath?: string; asset?: { name?: string; type?: string; alias?: string } }
    if (!b.parentPath || !b.asset?.name) return reply.code(400).send({ error: 'parentPath and asset.name are required' })
    const path = await ensurePaintTarget(b.parentPath, { name: b.asset.name, type: b.asset.type, alias: b.asset.alias })
    notifyChanged(`target ${b.parentPath} + ${b.asset.name} → ${path}`)
    return { path }
  })

  // Whole-layer cell overwrite (z=0 painting), plus optional asset (re)bind.
  app.patch('/api/v1/baked/layers/cells', { bodyLimit: BAKED_VOXEL_BODY_LIMIT }, async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; cells?: BakedCell[]; asset?: { name: string; type?: string; alias?: string } }
    if (!b.path) return reply.code(400).send({ error: 'path is required' })
    await setBakedCells(b.path, b.cells ?? [], b.asset)
    notifyChanged(`paint ${b.path} (${(b.cells ?? []).length} cells${b.asset ? `, asset=${b.asset.name}` : ''})`)
    return { ok: true }
  })

  // Move (reparent and/or reorder) a layer — drag-and-drop in the Editable panel.
  app.patch('/api/v1/baked/move', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; destParentPath?: string; beforeName?: string }
    if (!b.path || !b.destParentPath) return reply.code(400).send({ error: 'path and destParentPath are required' })
    const dest = await moveBakedLayer(b.path, b.destParentPath, b.beforeName)
    notifyChanged(`move ${b.path} → ${dest ?? '(rejected)'}${b.beforeName ? ` before ${b.beforeName}` : ''}`)
    return { path: dest }
  })

  app.patch('/api/v1/baked/rename', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; name?: string }
    if (!b.path || typeof b.name !== 'string') return reply.code(400).send({ error: 'path and name are required' })
    try {
      const path = await renameBakedLayer(b.path, b.name)
      if (!path) return reply.code(404).send({ error: 'layer not found' })
      notifyChanged(`rename ${b.path} → ${path}`)
      return { path }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.delete('/api/v1/baked/layers', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string }
    if (!b.path) return reply.code(400).send({ error: 'path is required' })
    await removeBakedLayer(b.path)
    notifyChanged(`delete ${b.path}`)
    return { ok: true }
  })

  // Merge custom (non-reserved) attributes onto one or more baked layers.
  app.patch('/api/v1/baked/layers/attributes', async (req, reply) => {
    const b = (req.body ?? {}) as {
      paths?: string[]
      path?: string
      attributes?: Record<string, unknown>
      overwrite?: boolean
    }
    const paths = b.paths ?? (b.path ? [b.path] : [])
    if (paths.length === 0 || !b.attributes || typeof b.attributes !== 'object') {
      return reply.code(400).send({ error: 'paths (or path) and attributes are required' })
    }
    try {
      await patchBakedCustomAttributes(paths, b.attributes, { overwrite: b.overwrite })
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    notifyChanged(`attrs ${paths.length} layer(s)`)
    return { ok: true }
  })

  // Snapshot transient graph layers into the baked tree as editable copies.
  app.post('/api/v1/baked/bake', { bodyLimit: BAKED_VOXEL_BODY_LIMIT }, async (req) => {
    const b = (req.body ?? {}) as {
      layers?: Array<{ nodePath?: string; nodeName?: string; cells?: BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>
    }
    const paths = await bakeLayers((b.layers ?? []).map((l) => ({ ...l, cells: l.cells ?? [] })))
    await persistBakedLineage(await getActiveProjectDir(), b.layers ?? [], paths)
    notifyChanged(`bake ${paths.length} → [${paths.join(', ')}]`)
    return { paths }
  })

  app.post<{ Params: { id: string } }>(
    '/api/v1/projects/:id/baked/bake',
    { bodyLimit: BAKED_VOXEL_BODY_LIMIT },
    async (req, reply) => {
      const b = (req.body ?? {}) as {
        layers?: Array<{ nodePath?: string; nodeName?: string; cells?: BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>
      }
      try {
        const paths = await bakeLayersForProject(req.params.id, (b.layers ?? []).map((l) => ({ ...l, cells: l.cells ?? [] })))
        const projectDir = await getProjectDir(req.params.id)
        if (projectDir) await persistBakedLineage(projectDir, b.layers ?? [], paths)
        notifyChanged(`bake ${paths.length} → [${paths.join(', ')}] (project ${req.params.id})`)
        return { paths }
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message })
      }
    },
  )

  // 复盘(2026-07-01 sino bake/export 工具缺口):agent 侧只有 `scene:pipeline.execute`
  // 的**摘要**版本(无 cells),没法像 UI 那样先拿 raw execute 的 cells 再手工拼
  // bake payload。这个路由把「raw execute → 投影成体素图层 → bake」三步合成
  // 一次服务端内部调用,cells 全程不出服务器进程,更不进模型上下文。
  // agent 工具见 tool-handlers.ts `scene:baked.bakeFromExecute`。
  app.post<{ Params: { id: string }; Body: { nodeId?: string; replace?: boolean } }>(
    '/api/v1/projects/:id/baked/bake-from-execute',
    async (req, reply) => {
      syncTrace('backend:bake-from-execute', {
        projectId: req.params.id,
        nodeId: req.body?.nodeId,
        replace: req.body?.replace,
        referer: req.headers.referer,
      })
      const { id: projectId } = req.params
      const replace = req.body?.replace === true
      const access = await ensureMutationAccess(req, projectId)
      if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
      const execBody: ExecuteNodeRequest = typeof req.body?.nodeId === 'string' ? { nodeId: req.body.nodeId } : {}
      const runtime = await getRuntimeForProject(projectId)
      const handle = await executeNode(runtime, execBody)
      const full = await handle.done
      if (full.status !== 'completed') {
        return reply.code(422).send({
          error: `execute did not complete (status=${full.status})`,
          executionId: full.executionId,
          detail: full.error,
        })
      }
      // Only bake the port(s) that directly feed the graph's `scene_output`
      // sink — a whitelist, not a "no downstream consumer" blacklist, because
      // a blacklist can't see wiring *inside* nested `__group__` template
      // subgraphs (24/185 nodes here) and still re-bakes their internal
      // intermediate scene outputs (measured 4432 redundant layers vs. a
      // handful of real ones on a 185-node graph, ~40s). See
      // snapshot-from-execute.ts. Falls back to bake-all when the graph has
      // no wired scene_output (empty set).
      const snapshot = getPipeline(runtime)
      const terminalPorts = snapshot
        ? collectTerminalPorts(Object.values(snapshot.nodes), Object.values(snapshot.edges))
        : undefined
      let layers = buildBakeLayersFromExecutionResult(full, terminalPorts)
      // Full execution responses omit intermediate outputs once they feed a
      // sink. A wired scene_output therefore names the correct source port in
      // terminalPorts while `full.outputs` contains only the sink's compact
      // layers/names outputs. Recover those exact source DataTrees from the
      // runtime cache; never broaden this fallback to unrelated intermediates.
      if (layers.length === 0 && terminalPorts && terminalPorts.size > 0) {
        const terminalOutputs: Record<string, Record<string, unknown>> = {}
        for (const key of terminalPorts) {
          const separator = key.lastIndexOf(':')
          if (separator <= 0) continue
          const nodeId = key.slice(0, separator)
          const port = key.slice(separator + 1)
          const data = runtime.outputs.read(nodeId, port)?.data
          if (data === undefined) continue
          const nodeOutputs = terminalOutputs[nodeId] ?? {}
          nodeOutputs[port] = data
          terminalOutputs[nodeId] = nodeOutputs
        }
        layers = buildBakeLayersFromExecutionResult({ outputs: terminalOutputs }, terminalPorts)
      }
      if (layers.length === 0) {
        const outputShape = Object.entries(full.outputs ?? {}).flatMap(([nodeId, ports]) =>
          Object.entries(ports).map(([port, value]) => ({
            port: `${nodeId}:${port}`,
            kind: Array.isArray(value) ? 'branches' : typeof value,
            branches: Array.isArray(value) ? value.length : undefined,
            items: Array.isArray(value)
              ? value.reduce((count, branch) =>
                  count + (
                    branch && typeof branch === 'object' && Array.isArray((branch as { items?: unknown }).items)
                      ? (branch as { items: unknown[] }).items.length
                      : 0
                  ), 0)
              : undefined,
          })),
        )
        return reply.code(422).send({
          error: 'execute completed but produced zero scene layers to bake — nothing to snapshot',
          executionId: full.executionId,
          terminalPorts: [...(terminalPorts ?? [])],
          outputShape,
        })
      }
      try {
        const paths = await bakeLayersForProject(projectId, layers, { replace, recordHistory: !replace })
        const projectDir = await getProjectDir(projectId)
        if (projectDir) {
          const state = await readAuthoringState(projectDir)
          if (state) {
            const executionLineage = buildExecutionLineage(
              full,
              state.sourceMap,
              (nodeId, port) => runtime.outputs.read(nodeId, port)?.data,
            )
            const mappings = paths.flatMap((bakedPath, index) => {
              const sourcePath = layers[index]?.nodePath
              return sourcePath ? [{ sourcePath, bakedPath }] : []
            })
            await writeResultLineage(projectDir, attachBakedLayers(executionLineage, mappings))
          }
        }
        notifyChanged(
          `bake-from-execute${replace ? ' (replace)' : ''} ${paths.length} → [${paths.slice(0, 8).join(', ')}${paths.length > 8 ? ', …' : ''}] (project ${projectId})`,
          projectId,
        )
        return { paths, executionId: full.executionId, layerCount: layers.length }
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message })
      }
    },
  )
}
