/**
 * 工作台三端（Editor / Renderer / AssetStore）状态栏信息同步协议。
 * 子应用 iframe 通过 postMessage 向 Editor 上报；Editor 可向子应用下发命令。
 */

export const WORKBENCH_STATUS_REPORT = 'workbench:status-report' as const
export const WORKBENCH_STATUS_COMMAND = 'workbench:status-command' as const

export type WorkbenchStatusSource = 'renderer' | 'assetstore'

export interface RendererStatusPayload {
  zoom: number
  visibleLayerCount: number
}

export interface AssetStoreSelectedAssetSummary {
  widthPx?: number
  heightPx?: number
  sizeBytes: number
  source: string
}

export interface AssetStoreStatusPayload {
  activeLibrary: string
  total: number
  page: number
  totalPages: number
  loading: boolean
  selectedAsset: AssetStoreSelectedAssetSummary | null
}

export type WorkbenchStatusReportMessage =
  | { type: typeof WORKBENCH_STATUS_REPORT; source: 'renderer'; payload: RendererStatusPayload }
  | { type: typeof WORKBENCH_STATUS_REPORT; source: 'assetstore'; payload: AssetStoreStatusPayload }

export type WorkbenchStatusCommandMessage =
  | { type: typeof WORKBENCH_STATUS_COMMAND; target: 'assetstore'; command: 'goToPage'; page: number }

export function isWorkbenchStatusReportMessage(data: unknown): data is WorkbenchStatusReportMessage {
  if (!data || typeof data !== 'object') return false
  const msg = data as Record<string, unknown>
  if (msg.type !== WORKBENCH_STATUS_REPORT) return false
  return msg.source === 'renderer' || msg.source === 'assetstore'
}

export function isWorkbenchStatusCommandMessage(data: unknown): data is WorkbenchStatusCommandMessage {
  if (!data || typeof data !== 'object') return false
  const msg = data as Record<string, unknown>
  return msg.type === WORKBENCH_STATUS_COMMAND && msg.target === 'assetstore' && msg.command === 'goToPage'
}
