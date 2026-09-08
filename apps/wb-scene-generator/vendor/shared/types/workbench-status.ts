/**
 * 工作台 Renderer → Editor 状态栏信息同步协议。
 * Renderer iframe 通过 postMessage 向 Editor 上报只读状态。
 */

export const WORKBENCH_STATUS_REPORT = 'workbench:status-report' as const

export type WorkbenchStatusSource = 'renderer'

export interface RendererStatusPayload {
  zoom: number
  visibleLayerCount: number
}

export type WorkbenchStatusReportMessage =
  { type: typeof WORKBENCH_STATUS_REPORT; source: 'renderer'; payload: RendererStatusPayload }

export function isWorkbenchStatusReportMessage(data: unknown): data is WorkbenchStatusReportMessage {
  if (!data || typeof data !== 'object') return false
  const msg = data as Record<string, unknown>
  if (msg.type !== WORKBENCH_STATUS_REPORT) return false
  return msg.source === 'renderer'
}
