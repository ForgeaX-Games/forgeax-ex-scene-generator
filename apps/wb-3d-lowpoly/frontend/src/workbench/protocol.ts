// postMessage protocol between the workbench host (the editor pane) and its
// embedded child surfaces (the 3D viewer iframe). Ported from the scene
// generator's `workbench:*` contract, trimmed to what the 3d plugin ships: the
// host → child editor-selection forwarding only (no renderer/assetstore focus
// or status members).

export type WorkbenchFocus = 'editor' | 'viewer3d' | null

/**
 * Host → 3D viewer pane: the kernel editor's current node selection, forwarded so
 * the viewer can react to selection. View-only; carries no graph mutation.
 */
export interface EditorSelectionMessage {
  type: 'workbench:editor-selection'
  selectedNodeIds: string[]
}

/** Viewer → workbench host: ask the host to forward the GLB to Studio's Editor
 * Gateway bridge. The bytes stay inside this local UI handoff and never enter
 * chat history. */
export interface ViewerDirectImportMessage {
  type: 'workbench:viewer-direct-import'
  requestId: string
  directory: string
  name: string
  base64: string
}

/** Workbench runtime → Studio host: direct Editor source-import request. */
export interface EditorAssetImportMessage {
  type: 'workbench:editor-asset-import'
  requestId: string
  destPath: string
  sourceName: string
  base64: string
}

/** Studio host → workbench runtime: direct Editor import result. */
export interface EditorAssetImportResultMessage {
  type: 'workbench:editor-asset-import-result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/** Workbench host → viewer: structured result for the pending direct import. */
export interface ViewerDirectImportResultMessage {
  type: 'workbench:viewer-direct-import-result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

export type WorkbenchMessage =
  | EditorSelectionMessage
  | ViewerDirectImportMessage
  | ViewerDirectImportResultMessage
  | EditorAssetImportMessage
  | EditorAssetImportResultMessage

export function isWorkbenchMessage(data: unknown): data is WorkbenchMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('workbench:')
  )
}
