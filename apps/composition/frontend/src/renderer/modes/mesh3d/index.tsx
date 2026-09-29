// 💡 mode-3DMesh: smooth heightfield terrain from tile voxels (Wire / Color).
//
// Decoupling rules (hard):
//   * No imports from other modes (free3d / billboard / iso / top).
//   * Shared primitives only from `../../framework/*` and local `./` modules.
//
// Data: tile layers → smooth terrain; dense grid layers → discrete stepped
// heightfields; object layers with matching materials/models assetName → GLB
// instances (exact name).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  useBakedLayer,
  useBakedLayerKeys,
  useGridLayer,
  useGridLayerKeys,
  useVoxelLayer,
  useVoxelLayerKeys,
} from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import { useRenderStore } from '../../store'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { createViewGuides3d, disposeViewGuides3d } from '../../framework/guides3d'
import { mergeRenderableVoxelLayerKeys, orderBakedKeysForRender } from '../../framework/layerKeys'
import {
  buildSplatField,
  createSplatControlTexture,
  rankSplatMaterialNames,
} from './buildSplatField'
import { buildGridHeightMesh, disposeGridHeightMesh } from './buildGridHeightMesh'
import { buildTerrainMesh, disposeTerrainMesh, type TerrainSplatInput } from './buildTerrainMesh'
import { disposePbrMaps, loadPbrMaps } from './loadPbrTextures'
import { loadObjectTemplate } from './loadObjectModel'
import { fetchPbrMaterial } from './materialsApi'
import { fetchObjectModel, listObjectModels } from './modelsApi'
import {
  buildObjectPlacements,
  isObjectPropLayer,
  worldXY,
  type ObjectCellSample,
} from './objectPlacements'
import { buildSurfaceField, isTileTerrainLayer, type TileCellSample } from './surfaceOwner'
import './ModeMesh3d.css'

const ModeMesh3dPlugin = forwardRef<PluginHandle, object>(function ModeMesh3dPlugin(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const viewGuidesVisible = useRenderStore(s => s.viewGuides['3DMesh'])

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const rootGroupRef = useRef<THREE.Group | null>(null)
  const viewGuidesRef = useRef<THREE.Group | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const objectsRef = useRef<THREE.Group | null>(null)
  const gridMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const userInteractedRef = useRef(false)

  const [, forceTick] = useState(0)
  const bumpTick = useCallback(() => forceTick(t => t + 1), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      const probe = document.createElement('canvas')
      const gl = probe.getContext('webgl2') || probe.getContext('webgl')
      if (!gl) return
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      })
    } catch {
      return
    }

    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.pointerEvents = 'auto'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    const viewGuides = createViewGuides3d()
    viewGuides.visible = viewGuidesVisible
    scene.add(viewGuides)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1 * BASE_CELL_SIZE, 10000 * BASE_CELL_SIZE)
    camera.up.set(0, 0, 1)
    const initDist = 12 * BASE_CELL_SIZE
    camera.position.set(initDist, -initDist, initDist)
    camera.lookAt(0, 0, 0)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.15)
    dirLight.position.set(-0.4, -0.5, 0.85).normalize()
    scene.add(dirLight)
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))

    const root = new THREE.Group()
    root.name = 'terrain-root'
    scene.add(root)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.target.set(0, 0, 0)
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    controls.zoomToCursor = true
    controls.screenSpacePanning = true
    controls.minDistance = 0.5 * BASE_CELL_SIZE
    controls.maxDistance = 5000 * BASE_CELL_SIZE
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    controlsRef.current = controls
    rootGroupRef.current = root
    viewGuidesRef.current = viewGuides

    const syncSize = (): boolean => {
      const rect = container.getBoundingClientRect()
      const cssW = Math.max(1, Math.round(rect.width))
      const cssH = Math.max(1, Math.round(rect.height))
      const currentSize = renderer.getSize(new THREE.Vector2())
      if (currentSize.x === cssW && currentSize.y === cssH) return false
      renderer.setSize(cssW, cssH, true)
      camera.aspect = cssW / cssH
      camera.updateProjectionMatrix()
      return true
    }
    syncSize()

    if (meshRef.current) root.add(meshRef.current)
    if (objectsRef.current) root.add(objectsRef.current)
    for (const mesh of gridMeshesRef.current.values()) root.add(mesh)
    if (!userInteractedRef.current && (meshRef.current || objectsRef.current || gridMeshesRef.current.size > 0)) {
      autoFitToContent(root, camera, controls)
    }

    const renderOnce = () => {
      const sizeChanged = syncSize()
      if (sizeChanged && !userInteractedRef.current
        && (meshRef.current || objectsRef.current || gridMeshesRef.current.size > 0)) {
        autoFitToContent(root, camera, controls)
      }
      const mesh = meshRef.current
      if (mesh?.userData.needsWaterAnim) {
        const mat = mesh.material as THREE.ShaderMaterial
        if (mat?.uniforms?.time) mat.uniforms.time.value = performance.now() * 0.001
      }
      controls.update()
      renderer.render(scene, camera)
    }

    let rafId = 0
    const scheduleRender = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        renderOnce()
        const damping = controls.enableDamping && (controls as unknown as { _isDamping?: boolean })._isDamping
        const waterAnim = !!meshRef.current?.userData.needsWaterAnim
        if (damping || waterAnim) scheduleRender()
      })
    }
    controls.addEventListener('change', scheduleRender)
    controls.addEventListener('start', () => {
      ;(controls as unknown as { _isDamping?: boolean })._isDamping = true
      userInteractedRef.current = true
    })
    controls.addEventListener('end', () => {
      ;(controls as unknown as { _isDamping?: boolean })._isDamping = false
    })

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleRender())
      : null
    ro?.observe(container)

    scheduleRender()
    ;(renderer as unknown as { __scheduleRender?: () => void }).__scheduleRender = scheduleRender
    ;(renderer as unknown as { __renderOnce?: () => void }).__renderOnce = renderOnce

    return () => {
      ro?.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      controls.dispose()
      if (meshRef.current) {
        root.remove(meshRef.current)
        disposeTerrainMesh(meshRef.current)
        meshRef.current = null
      }
      if (objectsRef.current) {
        root.remove(objectsRef.current)
        disposeObjectGroup(objectsRef.current)
        objectsRef.current = null
      }
      scene.remove(viewGuides)
      disposeViewGuides3d(viewGuides)
      scene.clear()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      rootGroupRef.current = null
      viewGuidesRef.current = null
      userInteractedRef.current = false
    }
    // Visibility changes are applied imperatively below; setup remains mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (viewGuidesRef.current) viewGuidesRef.current.visible = viewGuidesVisible
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
  }, [viewGuidesVisible])

  const onMeshUpdate = useCallback((mesh: THREE.Mesh | null) => {
    const prev = meshRef.current
    if (prev === mesh) return
    meshRef.current = mesh
    const root = rootGroupRef.current
    if (root) {
      if (mesh) root.add(mesh)
      if (prev) {
        root.remove(prev)
        disposeTerrainMesh(prev)
      }
      if (!userInteractedRef.current && (mesh || objectsRef.current || gridMeshesRef.current.size > 0)) {
        autoFitToContent(root, cameraRef.current, controlsRef.current)
      }
    }
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
    bumpTick()
  }, [bumpTick])

  const onObjectsUpdate = useCallback((group: THREE.Group | null) => {
    const prev = objectsRef.current
    if (prev === group) return
    objectsRef.current = group
    const root = rootGroupRef.current
    if (root) {
      if (group) root.add(group)
      if (prev) {
        root.remove(prev)
        disposeObjectGroup(prev)
      }
      if (!userInteractedRef.current && (group || meshRef.current || gridMeshesRef.current.size > 0)) {
        autoFitToContent(root, cameraRef.current, controlsRef.current)
      }
    }
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
    bumpTick()
  }, [bumpTick])

  const onGridMeshUpdate = useCallback((key: string, mesh: THREE.Mesh | null) => {
    const previous = gridMeshesRef.current.get(key)
    if (previous === mesh) return
    const root = rootGroupRef.current
    if (mesh) {
      gridMeshesRef.current.set(key, mesh)
      if (mesh.parent !== root) root?.add(mesh)
    } else {
      gridMeshesRef.current.delete(key)
    }
    if (previous) {
      root?.remove(previous)
      disposeGridHeightMesh(previous)
    }
    if (root && !userInteractedRef.current
      && (meshRef.current || objectsRef.current || gridMeshesRef.current.size > 0)) {
      autoFitToContent(root, cameraRef.current, controlsRef.current)
    }
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
    bumpTick()
  }, [bumpTick])

  const resetView = useCallback(() => {
    userInteractedRef.current = false
    const root = rootGroupRef.current
    if (root) autoFitToContent(root, cameraRef.current, controlsRef.current)
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
  }, [])

  useImperativeHandle(ref, () => ({
    getFrameCanvas: () => rendererRef.current?.domElement ?? null,
    renderFrame: () => {
      const r = rendererRef.current
      const scene = sceneRef.current
      const camera = cameraRef.current
      if (!r || !scene || !camera) return
      const renderOnce = (r as unknown as { __renderOnce?: () => void }).__renderOnce
      if (renderOnce) renderOnce()
      else r.render(scene, camera)
    },
    resetView,
  }), [resetView])

  const voxelKeys = useVoxelLayerKeys()
  const bakedKeys = useBakedLayerKeys()
  const gridKeys = useGridLayerKeys()
  const orderedKeys = useMemo(
    () => mergeRenderableVoxelLayerKeys(voxelKeys, orderBakedKeysForRender(bakedKeys)),
    [voxelKeys, bakedKeys],
  )

  const wireframe = drawMode === 'wire'
  const colorMode = drawMode === 'color'
  const assetMode = drawMode === 'asset'

  return (
    <div ref={containerRef} className="mode-mesh3d-host">
      <canvas className="mode-mesh3d-fallback" />
      <TerrainMeshInstance
        orderedKeys={orderedKeys}
        wireframe={wireframe}
        colorMode={colorMode}
        assetMode={assetMode}
        onMeshUpdate={onMeshUpdate}
      />
      {gridKeys.map((key) => (
        <GridHeightMeshInstance
          key={key}
          layerKey={key}
          wireframe={wireframe}
          onMeshUpdate={onGridMeshUpdate}
        />
      ))}
      <ObjectModelsInstance
        orderedKeys={orderedKeys}
        // GLB props resolve by family stem (firtree/shrub/…) — not Asset Store PNGs.
        // Show in any non-wire 3DMesh draw mode so Color/Asset both see trees.
        enabled={!wireframe}
        onGroupUpdate={onObjectsUpdate}
      />
    </div>
  )
})
ModeMesh3dPlugin.displayName = 'ModeMesh3dPlugin'

interface GridHeightMeshInstanceProps {
  layerKey: string
  wireframe: boolean
  onMeshUpdate(key: string, mesh: THREE.Mesh | null): void
}

function GridHeightMeshInstance({
  layerKey,
  wireframe,
  onMeshUpdate,
}: GridHeightMeshInstanceProps) {
  const layer = useGridLayer(layerKey)
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const selectedKey = selectedEditorNodeIds.join(',')
  const cacheKey = layer?.visible
    ? `${layer.updatedAt}|${layer.rows}x${layer.cols}|w=${wireframe ? 1 : 0}|sel=${selectedKey}`
    : undefined
  const mesh = useLayerSurface<THREE.Mesh | null>(
    cacheKey,
    () => buildGridHeightMesh({
      layer: layer!,
      wireframe,
      selectedEditorNodeIds,
    }),
  )

  useEffect(() => {
    onMeshUpdate(layerKey, mesh)
  }, [layerKey, mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(layerKey, null), [layerKey, onMeshUpdate])
  return null
}

function disposeObjectGroup(group: THREE.Group): void {
  // Templates are cached; only dispose instanced scene graph leaves that own nothing unique.
  group.clear()
}

function autoFitToContent(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null,
): void {
  if (!camera || !controls) return
  group.updateMatrixWorld(true)
  const bbox = new THREE.Box3().setFromObject(group)
  if (!isFinite(bbox.min.x)) return
  const sphere = new THREE.Sphere()
  bbox.getBoundingSphere(sphere)
  const radius = Math.max(sphere.radius, BASE_CELL_SIZE)
  const fovRad = camera.fov * Math.PI / 180
  let dist = radius / Math.sin(fovRad / 2)
  const aspect = camera.aspect || 1
  if (aspect < 1) dist /= aspect
  dist *= 1.2

  controls.target.copy(sphere.center)
  const dir = new THREE.Vector3(1, -1, 1).normalize().multiplyScalar(dist)
  camera.position.copy(sphere.center).add(dir)
  camera.up.set(0, 0, 1)
  camera.lookAt(sphere.center)
  controls.update()
}

interface TerrainMeshInstanceProps {
  orderedKeys: string[]
  wireframe: boolean
  colorMode: boolean
  assetMode: boolean
  onMeshUpdate(mesh: THREE.Mesh | null): void
}

function collectSamples(
  orderedKeys: string[],
  bag: Map<string, TileCellSample[]>,
): TileCellSample[] {
  const samples: TileCellSample[] = []
  for (const k of orderedKeys) {
    const chunk = bag.get(k)
    if (chunk) samples.push(...chunk)
  }
  return samples
}

function disposeSplatInput(s: TerrainSplatInput | null): void {
  if (!s) return
  for (const L of s.layers) disposePbrMaps(L)
  s.controlMap.dispose()
}

/**
 * Subscribes to every ordered layer key, filters tiles, and rebuilds one mesh.
 * Asset mode: per-cell assetName → 4-way splat control map + multi PBR.
 */
function TerrainMeshInstance({
  orderedKeys, wireframe, colorMode, assetMode, onMeshUpdate,
}: TerrainMeshInstanceProps) {
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const selectedKey = selectedEditorNodeIds.join(',')

  const samplesRef = useRef<Map<string, TileCellSample[]>>(new Map())
  const versionsRef = useRef<Map<string, string>>(new Map())
  const [revision, setRevision] = useState(0)
  const [splat, setSplat] = useState<TerrainSplatInput | null>(null)
  const splatRef = useRef<TerrainSplatInput | null>(null)
  splatRef.current = splat
  const [splatReadyKey, setSplatReadyKey] = useState('')
  const retiredSplatsRef = useRef<TerrainSplatInput[]>([])
  const settledSplatKeyRef = useRef('')
  if (!splatReadyKey.startsWith('loading:')) settledSplatKeyRef.current = splatReadyKey

  const replaceSplat = useCallback((next: TerrainSplatInput | null) => {
    setSplat((prev) => {
      if (prev && prev !== next) retiredSplatsRef.current.push(prev)
      return next
    })
  }, [])

  const onLayerSamples = useCallback((key: string, samples: TileCellSample[] | null, version: string) => {
    if (!samples || samples.length === 0) {
      samplesRef.current.delete(key)
      versionsRef.current.delete(key)
    } else {
      samplesRef.current.set(key, samples)
      versionsRef.current.set(key, version)
    }
    setRevision(r => r + 1)
  }, [])

  useEffect(() => {
    const live = new Set(orderedKeys)
    let changed = false
    for (const k of [...samplesRef.current.keys()]) {
      if (!live.has(k)) {
        samplesRef.current.delete(k)
        versionsRef.current.delete(k)
        changed = true
      }
    }
    if (changed) setRevision(r => r + 1)
  }, [orderedKeys])

  // Async splat resolve — top-4 assetNames by coverage, exact pack match each.
  useEffect(() => {
    if (!assetMode || wireframe) {
      replaceSplat(null)
      setSplatReadyKey('')
      return
    }
    const samples = collectSamples(orderedKeys, samplesRef.current)
    const field = buildSurfaceField(samples)
    const ranked = rankSplatMaterialNames(field)
    if (ranked.length === 0) {
      replaceSplat(null)
      setSplatReadyKey('none')
      return
    }
    let cancelled = false
    setSplatReadyKey(`loading:${ranked.join('+')}`)
    ;(async () => {
      try {
        const loadedNames: string[] = []
        const loadedLayers: NonNullable<TerrainSplatInput['layers'][number]>[] = []
        for (const name of ranked) {
          const detail = await fetchPbrMaterial(name)
          if (cancelled) return
          if (!detail) continue
          const maps = await loadPbrMaps(detail)
          if (cancelled) {
            disposePbrMaps(maps)
            return
          }
          loadedNames.push(name)
          loadedLayers.push(maps)
        }
        if (cancelled) return
        if (loadedNames.length === 0) {
          replaceSplat(null)
          setSplatReadyKey(`miss:${ranked.join('+')}`)
          return
        }
        const splatField = buildSplatField(field, loadedNames, { blurPasses: 1 })
        if (!splatField) {
          for (const L of loadedLayers) disposePbrMaps(L)
          setSplatReadyKey('empty-field')
          return
        }
        const controlMap = createSplatControlTexture(splatField)
        const next: TerrainSplatInput = {
          splatField,
          controlMap,
          layers: loadedLayers,
        }
        replaceSplat(next)
        setSplatReadyKey(`ok:${loadedNames.join('+')}`)
      } catch {
        if (cancelled) return
        replaceSplat(null)
        setSplatReadyKey(`err:${ranked.join('+')}`)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode, wireframe, orderedKeys, revision, replaceSplat])

  useEffect(() => () => {
    disposeSplatInput(splatRef.current)
    splatRef.current = null
    for (const retired of retiredSplatsRef.current.splice(0)) disposeSplatInput(retired)
  }, [])

  const cacheKey = useMemo(() => {
    const parts: string[] = [
      `w=${wireframe ? 1 : 0}`,
      `c=${colorMode ? 1 : 0}`,
      `a=${assetMode ? 1 : 0}`,
      `splat=${settledSplatKeyRef.current}`,
      `sel=${selectedKey}`,
    ]
    for (const k of orderedKeys) {
      const v = versionsRef.current.get(k)
      if (v) parts.push(v)
    }
    return parts.join('|')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeys, wireframe, colorMode, assetMode, splatReadyKey, selectedKey, revision])

  const mesh = useLayerSurface<THREE.Mesh | null>(
    cacheKey,
    () => {
      const samples = collectSamples(orderedKeys, samplesRef.current)
      if (samples.length === 0) return null
      const useSplat = assetMode && !wireframe && !!splat
      return buildTerrainMesh({
        samples,
        selectedEditorNodeIds,
        wireframe,
        colorMode: colorMode || (assetMode && !useSplat),
        splat: useSplat ? splat : null,
      })
    },
  )

  useEffect(() => {
    onMeshUpdate(mesh)
    // The scene swap above has detached and disposed the old terrain mesh, so
    // textures referenced by its retired splat material are now safe to free.
    for (const retired of retiredSplatsRef.current.splice(0)) disposeSplatInput(retired)
  }, [mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(null), [onMeshUpdate])

  return (
    <>
      {orderedKeys.map((key, layerIdx) => (
        <LayerSampleProbe
          key={key}
          layerKey={key}
          layerIdx={layerIdx}
          onLayerSamples={onLayerSamples}
        />
      ))}
    </>
  )
}

interface LayerSampleProbeProps {
  layerKey: string
  layerIdx: number
  onLayerSamples(key: string, samples: TileCellSample[] | null, version: string): void
}

function LayerSampleProbe({ layerKey, layerIdx, onLayerSamples }: LayerSampleProbeProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer

  useEffect(() => {
    if (!layer || !layer.visible || !isTileTerrainLayer(layer.assetType) || !layer.cells?.length) {
      onLayerSamples(layerKey, null, `${layerKey}@empty`)
      return
    }
    const samples: TileCellSample[] = layer.cells.map((c) => ({
      x: c.x,
      y: c.y,
      z: c.z,
      layerIdx,
      value: layer.value,
      assetName: layer.assetName ?? '',
      layerKey,
      nodeId: layer.nodeId,
    }))
    onLayerSamples(
      layerKey,
      samples,
      `${layerKey}@${layer.updatedAt}|${layer.cells.length}|idx=${layerIdx}|a=${layer.assetName ?? ''}`,
    )
  }, [layer, layerKey, layerIdx, onLayerSamples])

  return null
}

interface ObjectModelsInstanceProps {
  orderedKeys: string[]
  enabled: boolean
  onGroupUpdate(group: THREE.Group | null): void
}

function ObjectModelsInstance({ orderedKeys, enabled, onGroupUpdate }: ObjectModelsInstanceProps) {
  const tileBag = useRef<Map<string, TileCellSample[]>>(new Map())
  const objBag = useRef<Map<string, ObjectCellSample[]>>(new Map())
  const versionsRef = useRef<Map<string, string>>(new Map())
  const [revision, setRevision] = useState(0)

  const onTile = useCallback((key: string, samples: TileCellSample[] | null, version: string) => {
    if (!samples?.length) tileBag.current.delete(key)
    else tileBag.current.set(key, samples)
    versionsRef.current.set(`t:${key}`, version)
    setRevision((r) => r + 1)
  }, [])

  const onObj = useCallback((key: string, samples: ObjectCellSample[] | null, version: string) => {
    if (!samples?.length) objBag.current.delete(key)
    else objBag.current.set(key, samples)
    versionsRef.current.set(`o:${key}`, version)
    setRevision((r) => r + 1)
  }, [])

  useEffect(() => {
    if (!enabled) {
      onGroupUpdate(null)
      return
    }
    let cancelled = false
    const tileSamples = collectSamples(orderedKeys, tileBag.current)
    const terrain = tileSamples.length ? buildSurfaceField(tileSamples) : null
    const objSamples: ObjectCellSample[] = []
    for (const k of orderedKeys) {
      const chunk = objBag.current.get(k)
      if (chunk) objSamples.push(...chunk)
    }
    ;(async () => {
      let catalog: string[] = []
      try {
        catalog = (await listObjectModels()).map((m) => m.name)
      } catch {
        catalog = []
      }
      if (cancelled) return

      const placements = buildObjectPlacements(objSamples, terrain, catalog)
      if (placements.length === 0) {
        onGroupUpdate(null)
        return
      }

      const bounds = terrain ?? (() => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const p of placements) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
        }
        return { minX, maxX, minY, maxY, owners: new Map() }
      })()

      const names = [...new Set(placements.map((p) => p.name))]
      const templates = new Map<string, Awaited<ReturnType<typeof loadObjectTemplate>>>()
      await Promise.all(names.map(async (name) => {
        const detail = await fetchObjectModel(name)
        if (!detail || cancelled) return
        const tpl = await loadObjectTemplate(detail)
        if (tpl) templates.set(name, tpl)
      }))
      if (cancelled) return

      const group = new THREE.Group()
      group.name = 'object-models'
      for (const p of placements) {
        const tpl = templates.get(p.name)
        if (!tpl) continue
        const { wx, wy } = worldXY(p.x, p.y, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY)
        const inst = tpl.root.clone(true)
        inst.position.set(wx, wy, p.groundZ)
        inst.name = p.instanceKey
        group.add(inst)
      }
      if (group.children.length === 0) {
        onGroupUpdate(null)
        return
      }
      onGroupUpdate(group)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, orderedKeys, revision, onGroupUpdate])

  useEffect(() => () => onGroupUpdate(null), [onGroupUpdate])

  if (!enabled) return null
  return (
    <>
      {orderedKeys.map((key, layerIdx) => (
        <LayerSampleProbe
          key={`tile-${key}`}
          layerKey={key}
          layerIdx={layerIdx}
          onLayerSamples={onTile}
        />
      ))}
      {orderedKeys.map((key) => (
        <ObjectLayerProbe
          key={`obj-${key}`}
          layerKey={key}
          onLayerSamples={onObj}
        />
      ))}
    </>
  )
}

interface ObjectLayerProbeProps {
  layerKey: string
  onLayerSamples(key: string, samples: ObjectCellSample[] | null, version: string): void
}

function ObjectLayerProbe({ layerKey, onLayerSamples }: ObjectLayerProbeProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer

  useEffect(() => {
    if (!layer || !layer.visible || !isObjectPropLayer(layer.assetType) || !layer.cells?.length) {
      onLayerSamples(layerKey, null, `${layerKey}@empty`)
      return
    }
    const samples: ObjectCellSample[] = layer.cells.map((c) => {
      const id = c.state?.instanceId
      return {
        x: c.x,
        y: c.y,
        z: c.z,
        assetName: layer.assetName ?? '',
        instanceId: typeof id === 'string' && id ? id : null,
        layerKey,
      }
    })
    onLayerSamples(
      layerKey,
      samples,
      `${layerKey}@${layer.updatedAt}|${layer.cells.length}|a=${layer.assetName ?? ''}`,
    )
  }, [layer, layerKey, onLayerSamples])

  return null
}

registerRenderPlugin({
  name: 'mesh3d',
  modes: ['3DMesh'],
  Component: ModeMesh3dPlugin,
})

export default ModeMesh3dPlugin
