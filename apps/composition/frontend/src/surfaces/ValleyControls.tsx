import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode } from '@forgeax/node-runtime'
import type { HttpApiClient, SceneScriptFunctionContract, SceneScriptPortContract } from '../api/HttpApiClient.js'
import { commitGuideParam, requestDocumentReset } from '../renderer/bridge/guideParamBridge.js'
import { guideLayerToControlPoints, guidePointToControlXY } from '../renderer/framework/guidePoints.js'
import { useRenderStore } from '../renderer/store.js'
import { sceneT, useSceneLocale } from '../sceneI18n.js'

export interface CollectedControl {
  id: string
  nodeId: string
  nodeName: string
  opId: string
  key: string
  label: string
  type: string
  value: number
  min: number
  max: number
  step: number
  description?: string
  defaultValue: number
}

const KNOWN_LABELS_EN: Record<string, string> = {
  seed: 'Seed',
  contourLevels: 'Contours',
  hillCount: 'Hills',
  peakPosition: 'Peak',
  roadWidth: 'Road width',
  buildingHeight: 'Building height',
  roofHeight: 'Roof height',
  footprint: 'House width',
  depth: 'House depth',
  plotCount: 'Plot count',
  count: 'Plot count',
  roundness: 'Roundness',
  peakRadius: 'Peak radius',
  width: 'Width',
  height: 'Height',
  gridSizeX: 'Grid width',
  gridSizeY: 'Grid height',
  valleyDepth: 'Valley depth',
  valleyWidth: 'Valley width',
  ridgeNoise: 'Ridge noise',
}

function deriveBounds(key: string, value: number, port?: SceneScriptPortContract): { min: number; max: number; step: number } {
  if (key === 'seed') return { min: 0, max: 100, step: 1 }
  if (key === 'contourLevels') return { min: 1, max: 10, step: 1 }
  if (key === 'hillCount') return { min: 1, max: 10, step: 1 }
  if (key === 'peakPosition') return { min: 1, max: 9, step: 1 }
  if (key === 'roadWidth') return { min: 1, max: 12, step: 0.5 }
  if (key === 'buildingHeight' || key === 'roofHeight' || key === 'footprint' || key === 'depth') {
    return { min: 0.2, max: 16, step: 0.1 }
  }
  if (key === 'plotCount' || key === 'count') return { min: 1, max: 24, step: 1 }
  if (key === 'roundness') return { min: 0, max: 1, step: 0.05 }
  if (key === 'peakRadius') return { min: 0.05, max: 1, step: 0.05 }
  if (key === 'width' || key === 'gridSizeX' || key === 'gridSizeY') return { min: 10, max: 128, step: 2 }
  if (key === 'valleyDepth') return { min: 1, max: 30, step: 0.5 }
  if (key === 'valleyWidth') return { min: 4, max: 40, step: 1 }
  if (key === 'ridgeNoise') return { min: 0, max: 6, step: 0.1 }

  const def = typeof port?.defaultValue === 'number' ? port.defaultValue : value
  if (def >= 0 && def <= 1 && !Number.isInteger(def)) {
    return { min: 0, max: 1, step: 0.05 }
  }
  const isFloat = !Number.isInteger(def)
  return {
    min: def < 0 ? Math.min(-10, def * 2) : 0,
    max: Math.max(10, def > 0 ? Math.ceil(def * 2.5) : 50),
    step: isFloat ? 0.05 : 1,
  }
}

function num(val: unknown, fallback: number): number {
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

function isNumericControlPort(input: SceneScriptPortContract, rawVal: unknown): boolean {
  if (input.type && input.type !== 'number') return false
  if (Array.isArray(rawVal) || (rawVal !== null && typeof rawVal === 'object')) return false
  return Number.isFinite(Number(rawVal))
}

export function useCollectedControls(client: HttpApiClient): {
  controls: CollectedControl[]
  hasControls: boolean
  nodes: GraphNode[]
  refresh: () => Promise<void>
} {
  const [contracts, setContracts] = useState<SceneScriptFunctionContract[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const guideLayers = useRenderStore((s) => s.guideLayers)
  const locale = useSceneLocale()

  const refresh = useCallback(async () => {
    try {
      if (typeof client.ensureViewingProject === 'function') {
        await client.ensureViewingProject().catch(() => null)
      }
      const [contractRes, nodeList] = await Promise.all([
        typeof client.getSceneScriptContracts === 'function'
          ? client.getSceneScriptContracts().catch(() => ({ version: '0.1', functions: [] }))
          : Promise.resolve({ version: '0.1', functions: [] }),
        typeof client.listNodes === 'function'
          ? client.listNodes().catch(() => [])
          : Promise.resolve([]),
      ])
      if (contractRes?.functions?.length) {
        setContracts(contractRes.functions)
      }
      setNodes([...nodeList])
    } catch {
      setNodes([])
    }
  }, [client])

  useEffect(() => {
    void refresh()
    if (typeof client.subscribe === 'function') {
      const unsub = client.subscribe('graph', (event) => {
        if (event.kind === 'graph:applied') void refresh()
      })
      return unsub
    }
  }, [client, refresh])

  const controls = useMemo(() => {
    const list: CollectedControl[] = []
    const contractsByOp = new Map<string, SceneScriptFunctionContract>()
    for (const c of contracts) {
      if (c.opId) contractsByOp.set(c.opId, c)
      contractsByOp.set(c.functionName, c)
    }

    const opCount = new Map<string, number>()
    for (const n of nodes) {
      opCount.set(n.opId, (opCount.get(n.opId) ?? 0) + 1)
    }

    for (const node of nodes) {
      const contract = contractsByOp.get(node.opId)
      if (!contract) continue
      for (const input of contract.inputs ?? []) {
        if (!input.control || input.mode !== 'parameter') continue
        const rawVal = node.params?.[input.name] ?? input.defaultValue
        if (!isNumericControlPort(input, rawVal)) continue
        const val = num(rawVal, 0)
        const defaultValue = typeof input.defaultValue === 'number' && Number.isFinite(input.defaultValue)
          ? input.defaultValue
          : val
        const bounds = deriveBounds(input.name, val, input)
        const isZh = locale.startsWith('zh')
        const baseLabel = isZh
          ? (input.label || input.name)
          : (KNOWN_LABELS_EN[input.name] || input.label || input.name)
        const isDuplicated = (opCount.get(node.opId) ?? 0) > 1
        const label = isDuplicated && node.name ? `${node.name}: ${baseLabel}` : baseLabel

        list.push({
          id: `${node.id}:${input.name}`,
          nodeId: node.id,
          nodeName: node.name || node.opId,
          opId: node.opId,
          key: input.name,
          label,
          type: input.type,
          value: val,
          min: bounds.min,
          max: bounds.max,
          step: bounds.step,
          description: input.description,
          defaultValue,
        })
      }
    }
    return list
  }, [contracts, nodes, locale])

  const hasControls = controls.length > 0 || Object.keys(guideLayers).length > 0

  return { controls, hasControls, nodes, refresh }
}

function ControlSlider({ control }: { control: CollectedControl }): JSX.Element {
  const [draft, setDraft] = useState(control.value)
  const draggingRef = useRef(false)
  const draftRef = useRef(control.value)

  useEffect(() => {
    if (!draggingRef.current) {
      draftRef.current = control.value
      setDraft(control.value)
    }
  }, [control.value])

  const commit = useCallback((next: number) => {
    if (!Number.isFinite(next) || Object.is(next, control.value)) return
    commitGuideParam(control.nodeId, control.key, next)
  }, [control.nodeId, control.key, control.value])

  const setDraftValue = (next: number) => {
    draftRef.current = next
    setDraft(next)
  }

  return (
    <label className="valley-controls__row">
      <span>{control.label}</span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={draft}
        aria-label={control.label}
        onPointerDown={() => { draggingRef.current = true }}
        onPointerUp={(e) => {
          draggingRef.current = false
          const next = Number(e.currentTarget.value)
          setDraftValue(next)
          commit(next)
        }}
        onChange={(e) => {
          const next = Number(e.target.value)
          setDraftValue(next)
          if (!draggingRef.current) commit(next)
        }}
      />
      <output>{draft}</output>
    </label>
  )
}

export function ValleyControls({
  client,
  controls: propControls,
}: {
  client: HttpApiClient
  controls?: CollectedControl[]
}): JSX.Element {
  const hookResult = useCollectedControls(client)
  const controls = propControls ?? hookResult.controls
  const guideLayers = useRenderStore((s) => s.guideLayers)

  const roadPoints = useMemo(() => {
    const layer = Object.values(guideLayers)[0]
    return layer?.points ?? []
  }, [guideLayers])

  const namedGuides = useMemo(
    () => Object.values(guideLayers).filter((layer) => layer.points.some((pt) => pt.sourceNodeId)),
    [guideLayers],
  )

  const manualNodes = hookResult.nodes.filter((n) => n.opId === 'manual_points')
  const houseCount = manualNodes.length > roadPoints.length ? manualNodes.length - roadPoints.length : 0

  return (
    <div className="valley-controls control-controls" data-testid="valley-controls">
      <div className="valley-controls__head">
        <p className="valley-controls__hint">{sceneT('control.hint')}</p>
        <button
          type="button"
          className="valley-controls__reset"
          data-testid="valley-controls-reset"
          onClick={() => requestDocumentReset()}
        >
          {sceneT('control.reset')}
        </button>
      </div>

      {controls.length === 0 && namedGuides.length === 0 && (
        <p className="valley-controls__empty" style={{ opacity: 0.6, fontSize: '13px', padding: '12px 0' }}>
          {sceneT('control.empty')}
        </p>
      )}

      {controls.map((control) => (
        <ControlSlider key={control.id} control={control} />
      ))}

      {houseCount > 0 && (
        <div className="valley-controls__row">
          <span>{sceneT('control.houseCount')}</span>
          <output>{houseCount}</output>
        </div>
      )}

      {namedGuides.map((layer) => (
        <div key={layer.key} className="valley-controls__points">
          <span>{layer.nodeName}</span>
          {layer.points.map((pt, i) => {
            const [localX, localY] = guidePointToControlXY(pt)
            return (
            <label key={`${pt.sourceNodeId ?? i}:${i}`} className="valley-controls__point">
              <span>P{i}</span>
              <input
                type="number"
                value={localX}
                aria-label={`${layer.nodeName} point ${i} x`}
                disabled={!pt.sourceNodeId}
                onChange={(e) => {
                  if (!pt.sourceNodeId) return
                  const nextX = Number(e.target.value)
                  if (pt.sourceOpId === 'control_points') {
                    const nextList = guideLayerToControlPoints(layer.points)
                    nextList[i] = [nextX, localY]
                    commitGuideParam(pt.sourceNodeId, 'points', nextList)
                  } else {
                    commitGuideParam(pt.sourceNodeId, 'x', nextX)
                  }
                }}
              />
              <input
                type="number"
                value={localY}
                aria-label={`${layer.nodeName} point ${i} y`}
                disabled={!pt.sourceNodeId}
                onChange={(e) => {
                  if (!pt.sourceNodeId) return
                  const nextY = Number(e.target.value)
                  if (pt.sourceOpId === 'control_points') {
                    const nextList = guideLayerToControlPoints(layer.points)
                    nextList[i] = [localX, nextY]
                    commitGuideParam(pt.sourceNodeId, 'points', nextList)
                  } else {
                    commitGuideParam(pt.sourceNodeId, 'y', nextY)
                  }
                }}
              />
            </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export const ControlControls = ValleyControls
