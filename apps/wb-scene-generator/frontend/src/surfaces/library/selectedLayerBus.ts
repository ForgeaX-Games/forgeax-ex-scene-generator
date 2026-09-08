// Cross-pane channel for the preview's currently-selected layer(s). The renderer
// pane (?pane=renderer) publishes; the left pane (?pane=left) shows its detail
// under the Preview group. Sibling same-origin iframes → localStorage + `storage`
// event bus (same pattern as rulesApi.ts / paintAssetBus.ts).

import type { SelectedLayersState, SelectedLayerSnapshot } from './layerInspector.js'

/** @deprecated Use SelectedLayerSnapshot — kept for gradual migration. */
export interface SelectedLayerInfo {
  kind: 'baked' | 'output'
  nodePath: string
  nodeName: string
  assetName: string
  assetType?: string
  cellCount: number
}

const LS_SELECTED_LAYERS = 'wb-scene-generator.preview.selectedLayers'

export function writeSelectedLayers(state: SelectedLayersState | null): void {
  if (typeof localStorage === 'undefined') return
  if (state && state.layers.length > 0) localStorage.setItem(LS_SELECTED_LAYERS, JSON.stringify(state))
  else localStorage.removeItem(LS_SELECTED_LAYERS)
}

export function readSelectedLayers(): SelectedLayersState | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LS_SELECTED_LAYERS)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SelectedLayersState
  } catch {
    return null
  }
}

export function subscribeSelectedLayers(cb: (state: SelectedLayersState | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_SELECTED_LAYERS) return
    cb(readSelectedLayers())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/** First selected layer, for legacy single-layer consumers (e.g. asset highlight). */
export function readSelectedLayer(): SelectedLayerInfo | null {
  const state = readSelectedLayers()
  const layer = state?.layers[0]
  if (!layer) return null
  return {
    kind: layer.kind,
    nodePath: layer.nodePath,
    nodeName: layer.nodeName,
    assetName: layer.assetName,
    assetType: layer.assetType,
    cellCount: layer.voxelStats.cellCount,
  }
}

export function writeSelectedLayer(info: SelectedLayerInfo | null): void {
  if (!info) {
    writeSelectedLayers(null)
    return
  }
  const snap: SelectedLayerSnapshot = {
    kind: info.kind,
    layerKey: `${info.kind}:${info.nodePath}`,
    nodePath: info.nodePath,
    nodeName: info.nodeName,
    value: 0,
    assetName: info.assetName,
    assetType: info.assetType,
    attributes: {
      ...(info.assetName ? { asset_name: info.assetName } : {}),
      ...(info.assetType ? { asset_type: info.assetType } : {}),
    },
    voxelStats: {
      cellCount: info.cellCount,
      xMin: null, xMax: null, yMin: null, yMax: null, zMin: null, zMax: null,
      tokenCount: 0,
    },
  }
  writeSelectedLayers({
    layers: [snap],
    editContext: { editMode: false, viewMode: 'top', drawMode: 'asset', editAvailable: false },
  })
}

export function subscribeSelectedLayer(cb: (info: SelectedLayerInfo | null) => void): () => void {
  return subscribeSelectedLayers((state) => {
    const layer = state?.layers[0]
    cb(layer ? {
      kind: layer.kind,
      nodePath: layer.nodePath,
      nodeName: layer.nodeName,
      assetName: layer.assetName,
      assetType: layer.assetType,
      cellCount: layer.voxelStats.cellCount,
    } : null)
  })
}
