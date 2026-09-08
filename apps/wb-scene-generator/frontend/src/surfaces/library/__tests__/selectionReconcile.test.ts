// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { reconcilePanelSelection } from '../selectionReconcile'
import { writeSelectedLayers, readSelectedLayers } from '../selectedLayerBus'
import { outputLayerToSnapshot } from '../layerSnapshots'
import { useRenderStore } from '../../../renderer/store'
import type { RendererVoxelLayer, Point3D } from '../../../renderer/types'

beforeEach(() => {
  localStorage.clear()
  useRenderStore.getState().reset()
})

function layer(key: string, cells: Point3D[]): RendererVoxelLayer {
  const isBaked = key.startsWith('baked:')
  const nodePath = isBaked ? key.slice('baked:'.length) : key.split(':')[1] ?? '/'
  return { key, nodeId: isBaked ? '__baked__' : key.split(':')[0], nodePath, nodeName: nodePath, value: 1, cells, visible: true, updatedAt: 0, assetName: 'grass', assetType: 'tile' }
}

/**
 * Models RendererSurface's bidirectional selection wiring without rendering the
 * whole surface: the store's `selectedLayerKey` is the SINGLE source of truth,
 * the panel keeps local selection sets, and a guarded reconcile collapses those
 * sets when `selectedLayerKey` changes from OUTSIDE the panel (SELECT-mode).
 */
class PanelModel {
  outputKeys = new Set<string>()
  bakedKeys = new Set<string>()
  echo: string | null = null
  reconcileRuns = 0
  setRuns = 0
  constructor(
    private readonly sources: { baked: Record<string, RendererVoxelLayer>; output: Record<string, RendererVoxelLayer> },
  ) {}

  /** A user click on an OUTPUT row: panel-originated → store + echo. */
  clickOutputRow(key: string): void {
    this.outputKeys = new Set([key])
    this.bakedKeys = new Set()
    this.echo = key
    useRenderStore.getState().setSelectedLayer(key)
  }

  /** The effect: runs on every selectedLayerKey change. Mirrors RendererSurface. */
  onSelectedKeyChanged(selectedKey: string | null): void {
    if (this.echo === selectedKey) return // panel-originated → skip (no clobber)
    this.reconcileRuns += 1
    this.echo = selectedKey
    if (selectedKey === null) {
      this.outputKeys = new Set()
      this.bakedKeys = new Set()
      return
    }
    const { outputKey, bakedKey } = reconcilePanelSelection(selectedKey, this.sources)
    if (bakedKey) { this.bakedKeys = new Set([bakedKey]); this.outputKeys = new Set() }
    else if (outputKey) { this.outputKeys = new Set([outputKey]); this.bakedKeys = new Set() }
    this.setRuns += 1
  }

  /** The publish effect: emits the resolved single selection to the bus. */
  publish(): void {
    const snaps = []
    for (const k of this.outputKeys) { const l = this.sources.output[k]; if (l) snaps.push(outputLayerToSnapshot(l)) }
    for (const k of this.bakedKeys) { const l = this.sources.baked[k]; if (l) snaps.push(outputLayerToSnapshot(l)) }
    writeSelectedLayers(snaps.length ? { layers: snaps, editContext: { editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true } } : null)
  }
}

describe('bidirectional layer selection (panel ↔ SELECT mode)', () => {
  const A = layer('n1:/Wall', [{ x: 0, y: 0, z: 0 }])
  const B = layer('n2:/Floor', [{ x: 1, y: 0, z: 0 }])
  const sources = { baked: {}, output: { [A.key]: A, [B.key]: B } }

  it('panel selects A → store + bus reflect A; THEN scene SELECT resolves B → store + bus reflect B (A replaced, no loop)', () => {
    const panel = new PanelModel(sources)

    // (a) panel click selects A
    panel.clickOutputRow(A.key)
    panel.onSelectedKeyChanged(useRenderStore.getState().selectedLayerKey) // echo === A → skip
    panel.publish()
    expect(useRenderStore.getState().selectedLayerKey).toBe('n1:/Wall')
    expect(panel.outputKeys).toEqual(new Set(['n1:/Wall']))
    expect(readSelectedLayers()?.layers[0].layerKey).toBe('n1:/Wall')
    expect(panel.reconcileRuns).toBe(0) // panel-originated, never reconciled

    // (b) SELECT-mode scene click resolves B → external store write
    useRenderStore.getState().setSelectedLayer(B.key)
    panel.onSelectedKeyChanged(useRenderStore.getState().selectedLayerKey) // echo !== B → reconcile
    panel.publish()
    expect(useRenderStore.getState().selectedLayerKey).toBe('n2:/Floor')
    expect(panel.outputKeys).toEqual(new Set(['n2:/Floor'])) // A REPLACED by B — the bug fix
    expect(readSelectedLayers()?.layers[0].layerKey).toBe('n2:/Floor')
    expect(panel.reconcileRuns).toBe(1)

    // (c) re-running the effect with the same key is a no-op (loop guard)
    panel.onSelectedKeyChanged(useRenderStore.getState().selectedLayerKey)
    expect(panel.reconcileRuns).toBe(1) // no extra reconcile
    expect(panel.setRuns).toBe(1) // no redundant set
  })

  it('scene SELECT then panel re-click: each direction overrides the other (one shared field)', () => {
    const panel = new PanelModel(sources)
    // scene selects A
    useRenderStore.getState().setSelectedLayer(A.key)
    panel.onSelectedKeyChanged(useRenderStore.getState().selectedLayerKey)
    expect(panel.outputKeys).toEqual(new Set(['n1:/Wall']))
    // panel re-selects B (panel-originated)
    panel.clickOutputRow(B.key)
    panel.onSelectedKeyChanged(useRenderStore.getState().selectedLayerKey)
    expect(useRenderStore.getState().selectedLayerKey).toBe('n2:/Floor')
    expect(panel.outputKeys).toEqual(new Set(['n2:/Floor']))
  })
})

describe('reconcilePanelSelection (pure)', () => {
  const out = layer('n1:/Wall', [{ x: 0, y: 0, z: 0 }])
  const baked = layer('baked:/Floor', [{ x: 0, y: 0, z: 0 }])
  const sources = { baked: { [baked.key]: baked }, output: { [out.key]: out } }

  it('classifies an output key into the output bucket', () => {
    expect(reconcilePanelSelection('n1:/Wall', sources)).toEqual({ outputKey: 'n1:/Wall', bakedKey: null })
  })
  it('classifies a baked key into the baked bucket', () => {
    expect(reconcilePanelSelection('baked:/Floor', sources)).toEqual({ outputKey: null, bakedKey: 'baked:/Floor' })
  })
  it('null selection clears both', () => {
    expect(reconcilePanelSelection(null, sources)).toEqual({ outputKey: null, bakedKey: null })
  })
  it('unknown key (layers still loading) leaves both null', () => {
    expect(reconcilePanelSelection('n9:/Ghost', sources)).toEqual({ outputKey: null, bakedKey: null })
  })
})
