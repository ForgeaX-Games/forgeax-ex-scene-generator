// postMessage protocol between the workbench host (the editor pane on 9555) and
// its embedded Renderer iframe. Ported from the legacy editor's `workbench:*`
// contract and trimmed to the user-facing surfaces the scene plugin ships.

export type WorkbenchFocus = 'editor' | 'renderer' | null
export type WorkbenchSource = 'renderer'

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
export interface PreviewStatusMessage {
  type: 'workbench:preview-status'
  viewingProjectId?: string | null
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
}
/**
 * Host → renderer pane: the kernel editor's current node selection, forwarded so
 * the renderer can apply the legacy editor-selection highlight (green outline /
 * tint + Layers-panel row). View-only; carries no graph mutation. Replaces the
 * legacy `editor:selection` WS event, which has no equivalent on this backend
 * (kernel selection lives client-side in the host's pipeline store).
 */
export interface EditorSelectionMessage {
  type: 'workbench:editor-selection'
  selectedNodeIds: string[]
}

/**
 * Host → renderer pane: which nodes the editor has toggled preview OFF for.
 * Replaces the legacy `preview:change` WS event: the kernel editor's preview
 * toggle (`setNodePreview`) is applied optimistically in the host's pipeline
 * store and persisted async (debounced `applyBatch`), so the renderer (which
 * reads `previewEnabled` from `listNodes`) would otherwise lag behind by one
 * persist round-trip. The renderer treats any listed node as preview-off and
 * drops its grid/voxel layers immediately; absent nodes fall back to whatever
 * `listNodes` reports (which itself now persists across reloads). View-only —
 * carries no graph mutation.
 */
export interface PreviewChangeMessage {
  type: 'workbench:preview-change'
  previewDisabledNodeIds: string[]
}

/**
 * Host → renderer pane: live node output VALUES pushed directly from the editor
 * the instant an execute response lands, bypassing the WS `exec:completed` →
 * `getNodeOutput` re-pull round-trip. During a slider drag the editor's
 * `incrementalExecute` already holds the freshly computed outputs in memory; we
 * forward the changed (nodeId, port) payloads straight to the renderer so
 * the preview repaints in the same frame instead of waiting ~200ms for the WS +
 * GET detour. Includes grid previews AND voxel_layers sinks (scene_output).
 * exec:completed / graph:applied still own GC and the durable post-drag refresh.
 */
export interface PreviewDataMessage {
  type: 'workbench:preview-data'
  /** nodeId → portName → wire value (same shape as the executor `outputs`). */
  outputs: Record<string, Record<string, unknown>>
}

/** Host → renderer: a local slider/inspector scrub started another live tick. */
export interface ParamEditActiveMessage {
  type: 'workbench:param-edit-active'
}

/** Renderer → host: commit a node param (guide drag / Valley panel). */
export interface SetParamMessage {
  type: 'workbench:set-param'
  nodeId: string
  key: string
  value: unknown
  silent?: boolean
}

/** Renderer → host: commit many Control edits as one ordered persist+execute. */
export interface SetParamsMessage {
  type: 'workbench:set-params'
  edits: Array<{ nodeId: string; key: string; value: unknown }>
}

/** Renderer → host: restore the Alpine document to factory CVs/params and full-execute. */
export interface ResetDocumentMessage {
  type: 'workbench:reset-document'
}

/** Host → renderer: SetParam execute finished, or the edit was rolled back. */
export interface ParamEditResultMessage {
  type: 'workbench:param-edit-result'
  ok: boolean
  nodeId: string
  key: string
  error?: string
}

/** Renderer → host: Outliner / viewport pick selects authoring nodes. Empty `nodeIds` clears the selection. */
export interface SelectNodesMessage {
  type: 'workbench:select-nodes'
  nodeIds: string[]
}

/**
 * Host → renderer pane: an AI/Agent renderer-control command forwarded from the
 * backend WS/REST control channel through the host into the renderer's store.
 * Mirrors the legacy renderer commands (set-view-mode / select-layer /
 * open-all-sublayers) so an LLM/CLI can drive the preview view + selection.
 */
export interface RendererCommandMessage {
  type: 'workbench:renderer-command'
  command:
    | { kind: 'set-view-mode'; mode: string }
    | { kind: 'select-layer'; layerKey: string; subLayerValue?: number | null }
    | { kind: 'open-all-sublayers'; nodeId?: string }
}

/**
 * Renderer pane → host: coarse-grained progress for the data hooks that run
 * inside the iframe (useNodePreviews / useBakedLayers / useAliasMetas), none
 * of which the host can otherwise observe. Feeds the workbench's project-
 * switch loading-status panel — see `renderer/bridge/loadingSignals.ts` for
 * the producer side. Pure telemetry; the host never acts on it beyond display.
 */
export interface LoadingStatusMessage {
  type: 'workbench:loading-status'
  tasks: Array<{
    id: 'previews' | 'baked' | 'aliases'
    label: string
    active: boolean
    done?: number
    total?: number
  }>
}

/** Host → renderer pane: active project changed, so renderer state must reset. */
export interface ProjectChangedMessage {
  type: 'workbench:project-changed'
  projectId: string
}

/** Renderer pane → host: toggle the floating Scene Gen editor card. */
export interface ToggleEditorMessage {
  type: 'workbench:toggle-editor'
}

/** Renderer pane → host: close the floating editor after an outside-canvas click. */
export interface RequestCloseEditorMessage {
  type: 'workbench:request-close-editor'
  /** Explicit competing surfaces may close a pinned editor; outside clicks may not. */
  force?: boolean
}

/** Renderer pane → host: query whether the floating editor is visible. */
export interface QueryEditorVisibilityMessage {
  type: 'workbench:query-editor-visibility'
}

/** Host → renderer pane: floating editor visibility changed. */
export interface EditorVisibilityChangedMessage {
  type: 'workbench:editor-visibility-changed'
  visible: boolean
}

/** Host → renderer pane: reset preview-internal chrome to defaults. */
export interface RestoreLayoutMessage {
  type: 'workbench:restore-layout'
}

/** Host → renderer: capture the actual composed frame for transaction evidence. */
export interface CapturePreviewMessage {
  type: 'workbench:capture-preview'
  requestId: string
}

/** Renderer → host: actual PNG frame (or capture error) for the matching request. */
export interface PreviewCapturedMessage {
  type: 'workbench:preview-captured'
  requestId: string
  capturedAt: string
  dataUrl?: string
  width?: number
  height?: number
  error?: string
}

/** Renderer → host: pass a generated GLB to Studio's Editor asset-import bridge. */
export interface RendererDirectImportMessage {
  type: 'workbench:renderer-direct-import'
  requestId: string
  directory: string
  name: string
  base64: string
}

/** Host → renderer: result of the corresponding direct Studio asset import. */
export interface RendererDirectImportResultMessage {
  type: 'workbench:renderer-direct-import-result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/** Workbench → Studio host: import a source asset into the active game project. */
export interface EditorAssetImportMessage {
  type: 'workbench:editor-asset-import'
  requestId: string
  destPath: string
  sourceName: string
  base64: string
}

/** Studio host → workbench: outcome of an Editor asset import request. */
export interface EditorAssetImportResultMessage {
  type: 'workbench:editor-asset-import-result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/** Renderer → host: resolve a clicked SceneGraph/baked layer back to graph + source. */
export interface PreviewLineageSelectionMessage {
  type: 'workbench:preview-lineage-selection'
  sceneNodeId?: string
  path?: string
  bakedLayerId?: string
}

/** Host → renderer: SceneGraph paths produced by the current graph/code selection. */
export interface LineageHighlightMessage {
  type: 'workbench:lineage-highlight'
  paths: string[]
  bakedPaths: string[]
}

/** Same-origin target for all workbench postMessage calls. */
export function workbenchTargetOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

/** Origin of the Studio window embedding this workbench. In local development
 * the plugin runs on its own port, so this can differ from window.location. */
export function workbenchParentOrigin(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  if (!document.referrer) return window.location.origin
  try {
    return new URL(document.referrer).origin
  } catch {
    return window.location.origin
  }
}

export type WorkbenchMessage =
  | RequestFocusMessage
  | QueryFocusMessage
  | FocusChangedMessage
  | ToggleEditorMessage
  | RequestCloseEditorMessage
  | QueryEditorVisibilityMessage
  | EditorVisibilityChangedMessage
  | StatusReportMessage
  | PreviewStatusMessage
  | EditorSelectionMessage
  | PreviewChangeMessage
  | PreviewDataMessage
  | ParamEditActiveMessage
  | SetParamMessage
  | SetParamsMessage
  | ResetDocumentMessage
  | ParamEditResultMessage
  | SelectNodesMessage
  | RendererCommandMessage
  | LoadingStatusMessage
  | ProjectChangedMessage
  | RestoreLayoutMessage
  | CapturePreviewMessage
  | PreviewCapturedMessage
  | RendererDirectImportMessage
  | RendererDirectImportResultMessage
  | EditorAssetImportMessage
  | EditorAssetImportResultMessage
  | PreviewLineageSelectionMessage
  | LineageHighlightMessage

export function isWorkbenchMessage(data: unknown): data is WorkbenchMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('workbench:')
  )
}
