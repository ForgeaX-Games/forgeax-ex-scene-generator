export type PreviewStaleReason =
  | 'no-renderer'
  | 'project-mismatch'
  | 'graph-ahead'
  | 'execute-ahead'
  | 'no-visible-output'
  | 'no-visible-delta'
  | 'preview-stale'

export interface RendererFrameReport {
  viewingProjectId?: string | null
  openProjectId?: string | null
  sourceRevision?: string | null
  projectRevision?: string | null
  graphHash?: string | null
  executionId?: string | null
  executionStatus?: 'idle' | 'running' | 'completed' | 'error'
  voxelLayers?: number
  gridLayers?: number
  meshLayers?: number
  guideLayers?: number
  frameTimestamp?: string
  frameDigest?: string
  reportedAt: string
}

export interface OutputRepresentation {
  voxelLayers: number
  gridLayers: number
  meshLayers: number
  hasTerrainMesh: boolean
  occupancyOnly: boolean
  note?: string
}

export const TERRAIN_MESH_REQUIRED_ACTION =
  'Terrain is occupancy-only. Keep or restore a height Grid → heightfieldMesh → meshSceneNode, then review in Default or 3DMesh — not top-down voxels.'

export function outputRepresentation(layers: {
  voxelLayers: number
  gridLayers: number
  meshLayers: number
}): OutputRepresentation {
  const occupancyOnly = layers.meshLayers <= 0 && (layers.voxelLayers > 0 || layers.gridLayers > 0)
  return {
    voxelLayers: layers.voxelLayers,
    gridLayers: layers.gridLayers,
    meshLayers: layers.meshLayers,
    hasTerrainMesh: layers.meshLayers > 0,
    occupancyOnly,
    ...(layers.meshLayers > 0
      ? {}
      : {
          note: occupancyOnly
            ? 'Occupancy voxels/grids are visible, but there is no terrain mesh. Add heightfieldMesh → meshSceneNode and review in Default or 3DMesh.'
            : 'No visible mesh, voxel, or grid output.',
        }),
  }
}

export interface RendererSyncStatus {
  connected: boolean
  viewingProjectId: string | null
  openProjectId: string | null
  sourceRevision: string | null
  projectRevision: string | null
  executedRevision: string | null
  executionId: string | null
  executionStatus: RendererFrameReport['executionStatus']
  voxelLayers: number
  gridLayers: number
  meshLayers: number
  guideLayers: number
  representation: OutputRepresentation
  frameTimestamp: string | null
  frameDigest: string | null
  aligned: boolean
  staleReasons: PreviewStaleReason[]
}

const reports = new Map<string, RendererFrameReport>()
let lastGlobalReport: RendererFrameReport | null = null
let lastCommitted: {
  projectId: string
  revision: string
  graphHash?: string
  executionId?: string
  executedRevision?: string
} | null = null

export function reportRendererFrame(report: RendererFrameReport): RendererFrameReport {
  const next = { ...report, reportedAt: report.reportedAt || new Date().toISOString() }
  lastGlobalReport = next
  if (next.viewingProjectId) reports.set(next.viewingProjectId, next)
  return next
}

export function noteAuthoringCommit(input: {
  projectId: string
  revision: string
  graphHash?: string
}): void {
  lastCommitted = {
    projectId: input.projectId,
    revision: input.revision,
    graphHash: input.graphHash,
    executionId: lastCommitted?.projectId === input.projectId ? lastCommitted.executionId : undefined,
    executedRevision: lastCommitted?.projectId === input.projectId ? lastCommitted.executedRevision : undefined,
  }
}

export function noteAuthoringExecute(input: {
  projectId: string
  revision: string
  executionId?: string
}): void {
  lastCommitted = {
    projectId: input.projectId,
    revision: lastCommitted?.projectId === input.projectId ? lastCommitted.revision : input.revision,
    graphHash: lastCommitted?.projectId === input.projectId ? lastCommitted.graphHash : undefined,
    executionId: input.executionId,
    executedRevision: input.revision,
  }
}

export function rendererSyncStatus(projectId?: string): RendererSyncStatus {
  const report = (projectId && reports.get(projectId)) || lastGlobalReport
  const committed = lastCommitted && (!projectId || lastCommitted.projectId === projectId)
    ? lastCommitted
    : null
  const staleReasons: PreviewStaleReason[] = []
  if (!report) staleReasons.push('no-renderer')
  const viewing = report?.viewingProjectId ?? null
  const open = report?.openProjectId ?? projectId ?? committed?.projectId ?? null
  if (viewing && open && viewing !== open) staleReasons.push('project-mismatch')
  if (committed && report?.graphHash && committed.graphHash && report.graphHash !== committed.graphHash) {
    staleReasons.push('graph-ahead')
  }
  if (committed?.executionId && report?.executionId && report.executionId !== committed.executionId) {
    staleReasons.push('execute-ahead')
  }
  if (committed && report && committed.revision && report.projectRevision && report.projectRevision !== committed.revision) {
    staleReasons.push('preview-stale')
  }
  const voxelLayers = report?.voxelLayers ?? 0
  const gridLayers = report?.gridLayers ?? 0
  const meshLayers = report?.meshLayers ?? 0
  const layers = voxelLayers + gridLayers + meshLayers
  if (report && layers === 0) staleReasons.push('no-visible-output')
  if (report?.executionStatus === 'completed' && layers === 0) staleReasons.push('no-visible-delta')
  const representation = outputRepresentation({ voxelLayers, gridLayers, meshLayers })

  return {
    connected: Boolean(report),
    viewingProjectId: viewing,
    openProjectId: open,
    sourceRevision: report?.sourceRevision ?? committed?.revision ?? null,
    projectRevision: report?.projectRevision ?? committed?.revision ?? null,
    executedRevision: committed?.executedRevision ?? null,
    executionId: report?.executionId ?? committed?.executionId ?? null,
    executionStatus: report?.executionStatus ?? 'idle',
    voxelLayers,
    gridLayers,
    meshLayers,
    guideLayers: report?.guideLayers ?? 0,
    representation,
    frameTimestamp: report?.frameTimestamp ?? null,
    frameDigest: report?.frameDigest ?? null,
    aligned: staleReasons.length === 0 && Boolean(report),
    staleReasons,
  }
}

export function resetRendererStatusForTests(): void {
  reports.clear()
  lastGlobalReport = null
  lastCommitted = null
}
