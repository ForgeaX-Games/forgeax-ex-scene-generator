import type { FastifyInstance } from 'fastify'
import { broadcastToClients } from '../routes/ws.js'
import { reportRendererFrame, rendererSyncStatus, type RendererFrameReport } from './rendererStatus.js'
import { isScreenshotEnabled } from './routes.js'

// AI/Agent → renderer control channel (parity with the legacy
// /agent/renderer/* routes). An LLM/CLI drives the embedded renderer's view +
// selection over REST; each route broadcasts a `renderer:command` event on /ws,
// which live renderer clients apply to their render store (see the renderer's
// useRendererCommands bridge — mirrors the screenshot:request WS pattern).
//
// View modes are the renderer's own (default / top / topBillboard / iso / free3d); legacy
// 2d/3d and deprecated 3DMesh aliases map onto default/supported modes so existing callers keep working.

const VIEW_MODES = ['default', 'top', 'topBillboard', 'iso', 'free3d'] as const
type ViewMode = (typeof VIEW_MODES)[number]
const LEGACY_VIEW_ALIASES: Record<string, ViewMode> = {
  '2d': 'top',
  '3d': 'iso',
  default: 'default',
  top: 'top',
  billboard: 'topBillboard',
  iso: 'iso',
  free3d: 'free3d',
  '3DMesh': 'default',
  mesh3d: 'default',
}

interface ViewModeBody {
  mode?: string
}
interface SelectLayerBody {
  /** layerKey = `${nodeId}:${nodePath}` (voxel) or `${nodeId}:${portName}` (grid). */
  layerKey?: string
  /** Split form: nodeId + nodePath/portName joined into a layerKey. */
  nodeId?: string
  nodePath?: string
  portName?: string
  /** Optional multi-value sub-layer selector (G2 sub-layer token/value). */
  subLayerValue?: number | null
}
interface OpenAllSubLayersBody {
  /** Restrict to one node; omitted → open every node's sub-layers. */
  nodeId?: string
}

export async function registerRendererAgentRoutes(app: FastifyInstance): Promise<void> {
  // Where the renderer lives (the editor host embeds it as a `?pane=renderer`
  // iframe of this same origin). Returned so an AI knows where the preview is.
  app.get('/api/v1/agent/renderer/info', async () => ({
    pane: 'renderer',
    paneUrl: '/?pane=renderer',
    viewModes: VIEW_MODES,
    screenshot: { enabled: isScreenshotEnabled() },
    note: 'Renderer is an embedded pane of the editor; POST the control routes to drive its view + selection. Screenshot capability is toggleable by user setting (see screenshot.enabled).',
    sync: rendererSyncStatus(),
  }))

  app.post<{ Body: RendererFrameReport }>('/api/v1/renderer/status', async (req) => {
    const report = reportRendererFrame({
      ...(req.body ?? {}),
      reportedAt: new Date().toISOString(),
    })
    return { ok: true, report, sync: rendererSyncStatus(report.viewingProjectId ?? undefined) }
  })

  app.patch<{ Body: ViewModeBody }>('/api/v1/agent/renderer/view-mode', async (req, reply) => {
    const raw = (req.body?.mode ?? '').toString()
    const mode = LEGACY_VIEW_ALIASES[raw]
    if (!mode) {
      return reply.code(400).send({ error: `invalid mode "${raw}"; valid: ${Object.keys(LEGACY_VIEW_ALIASES).join(', ')}` })
    }
    const n = broadcastToClients({ event: 'renderer:command', payload: { kind: 'set-view-mode', mode } })
    return { ok: true, mode, clients: n }
  })

  app.post<{ Body: SelectLayerBody }>('/api/v1/agent/renderer/select-layer', async (req, reply) => {
    const b = req.body ?? {}
    let layerKey = b.layerKey
    if (!layerKey && b.nodeId && (b.nodePath || b.portName)) {
      layerKey = `${b.nodeId}:${b.nodePath ?? b.portName}`
    }
    if (!layerKey) {
      return reply.code(400).send({ error: 'provide layerKey, or nodeId + nodePath/portName' })
    }
    const subLayerValue = typeof b.subLayerValue === 'number' ? b.subLayerValue : null
    const n = broadcastToClients({ event: 'renderer:command', payload: { kind: 'select-layer', layerKey, subLayerValue } })
    return { ok: true, layerKey, subLayerValue, clients: n }
  })

  app.post<{ Body: OpenAllSubLayersBody }>('/api/v1/agent/renderer/open-all-sublayers', async (req) => {
    const nodeId = req.body?.nodeId
    const n = broadcastToClients({ event: 'renderer:command', payload: { kind: 'open-all-sublayers', nodeId: nodeId ?? null } })
    return { ok: true, nodeId: nodeId ?? null, clients: n }
  })
}
