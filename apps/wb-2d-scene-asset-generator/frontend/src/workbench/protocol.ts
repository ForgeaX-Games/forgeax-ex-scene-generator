// postMessage protocol between the workbench host (the editor pane on 9565) and
// its embedded child surfaces (Image Preview / Asset Folders iframes). Ported
// from the legacy editor's `workbench:*` contract, trimmed to the panes the
// scene plugin ships.

export type WorkbenchFocus = 'editor' | 'renderer' | 'assetstore' | null
export type WorkbenchSource = 'renderer' | 'assetstore'

export interface RequestFocusMessage {
  type: 'workbench:request-focus'
  target: Exclude<WorkbenchFocus, null>
}
export interface QueryFocusMessage {
  type: 'workbench:query-focus'
}
export interface FocusChangedMessage {
  type: 'workbench:focus-changed'
  focus: WorkbenchFocus
}
export interface StatusReportMessage {
  type: 'workbench:status-report'
  source: WorkbenchSource
  payload: Record<string, unknown>
}

export type WorkbenchMessage =
  | RequestFocusMessage
  | QueryFocusMessage
  | FocusChangedMessage
  | StatusReportMessage

export function isWorkbenchMessage(data: unknown): data is WorkbenchMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('workbench:')
  )
}
