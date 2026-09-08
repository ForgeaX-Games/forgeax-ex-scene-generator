// Canvas annotations + frames. Persist is scheduled through get().

import type { CanvasAnnotation } from '../types.js'
import type { PipelineGet, PipelineSet, PipelineState } from './pipelineStore.types.js'

type CanvasExtraActions = Pick<
  PipelineState,
  | 'addAnnotation'
  | 'duplicateAnnotation'
  | 'updateAnnotation'
  | 'moveAnnotation'
  | 'removeAnnotation'
  | 'addFrame'
  | 'renameFrame'
  | 'removeFrame'
  | 'updateFrame'
>

export function createCanvasExtras(get: PipelineGet, set: PipelineSet): CanvasExtraActions {
  return {
  addAnnotation: (position) => {
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const annotation: CanvasAnnotation = { id, text: '', position }
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: [...(state.currentPipeline.annotations ?? []), annotation],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-add')
    return id
  },

  duplicateAnnotation: (sourceId, position) => {
    const source = get().currentPipeline?.annotations?.find((a) => a.id === sourceId)
    if (!source) return null

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const annotation: CanvasAnnotation = { ...source, id, position }
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: [...(state.currentPipeline.annotations ?? []), annotation],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-duplicate')
    return id
  },

  updateAnnotation: (id, text, width, height) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).map((a) => {
            if (a.id !== id) return a
            const updated = { ...a, text }
            if (width !== undefined) updated.width = width
            if (height !== undefined) updated.height = height
            return updated
          }),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-update')
  },

  moveAnnotation: (id, position) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).map((a) =>
            a.id === id ? { ...a, position } : a,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-move')
  },

  removeAnnotation: (id) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          annotations: (state.currentPipeline.annotations ?? []).filter((a) => a.id !== id),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('annotation-remove')
  },

  // ── Canvas frames ────────────────────────────────────────────────────
  addFrame: (frame) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: [...(state.currentPipeline.frames ?? []), frame],
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-add')
  },

  renameFrame: (frameId, name) => {
    const trimmed = name.trim() || 'Frame'
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).map((frame) =>
            frame.id === frameId ? { ...frame, name: trimmed, updatedAt: new Date().toISOString() } : frame,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-rename')
  },

  removeFrame: (frameId) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).filter((frame) => frame.id !== frameId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-remove')
  },

  updateFrame: (frameId, updates) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          frames: (state.currentPipeline.frames ?? []).map((frame) =>
            frame.id === frameId ? { ...frame, ...updates, updatedAt: new Date().toISOString() } : frame,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('frame-update')
  },
  }
}
