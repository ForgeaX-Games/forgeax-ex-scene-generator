// 💡 mode-free3d: Three.js free-camera 3D rendering.
//
// Design:
//   1. Fully self-managed 3D interaction. OrbitControls binds directly to
//      renderer.domElement; the host does not intercept mouse events.
//   2. PerspectiveCamera + Z-up (matches buildVoxelMesh world coords X, Y-flip, Z=up).
//   3. Render loop is driven by the controls 'change' event, not React rerender:
//      OrbitControls mutates the camera in mousemove → change → renderer.render().
//   4. First content auto-fits: when a voxel mesh first attaches, compute the
//      bbox, center controls.target, and place the camera at an iso-ish angle a
//      distance away. Manual orbit/dolly afterwards stops auto-fit.
//
// jsdom guard: WebGL is unavailable in jsdom. If WebGLRenderer construction fails
// (or no GL context is obtainable) we catch it and render just the host <div>
// with a fallback <canvas>, so the component still mounts without throwing.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useBakedLayer, useBakedLayerKeys, useVoxelLayer, useVoxelLayerKeys } from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import { useRenderStore } from '../../store'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { createViewGuides3d, disposeViewGuides3d } from '../../framework/guides3d'
import { mergeRenderableVoxelLayerKeys } from '../../framework/layerKeys'
import { buildVoxelMesh, disposeMesh } from '../../framework/adapters/voxelMesh'
import './ModeFree3d.css'

// ── Plugin Component ───────────────────────────────────────────────────

const ModeFree3dPlugin = forwardRef<PluginHandle, object>(function ModeFree3dPlugin(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const viewGuidesVisible = useRenderStore(s => s.viewGuides.free3d)

  // Three.js resources (set up on mount, disposed on unmount).
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const layersGroupRef = useRef<THREE.Group | null>(null)
  const viewGuidesRef = useRef<THREE.Group | null>(null)
  // Whether the user has actively moved the camera (orbit / pan / zoom).
  //   * false: re-fit content on every voxel mesh change (matters when layers
  //     load async — only the last layer gives the full bbox).
  //   * true: stop auto-fit and respect the user's viewpoint.
  const userInteractedRef = useRef(false)

  // per-layer mesh table
  const layerMeshesRef = useRef<Map<string, THREE.InstancedMesh>>(new Map())
  const [, forceTick] = useState(0)
  const tickRef = useRef(0)
  const bumpTick = useCallback(() => {
    tickRef.current++
    forceTick(t => t + 1)
  }, [])

  // ── scene / camera / renderer / controls setup (once on mount) ────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // jsdom guard: bail out of WebGL setup if no GL context / construction throws.
    // The component still mounts (the host <div> + fallback <canvas> render below).
    let renderer: THREE.WebGLRenderer
    try {
      const probe = document.createElement('canvas')
      const gl = probe.getContext('webgl2') || probe.getContext('webgl')
      if (!gl) return
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true, // needed for Stage-3 screenshot capture
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
    // OrbitControls needs the pointer events the host CSS sets to none.
    renderer.domElement.style.pointerEvents = 'auto'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    const viewGuides = createViewGuides3d()
    viewGuides.visible = viewGuidesVisible
    scene.add(viewGuides)

    // PerspectiveCamera + Z-up (matches buildVoxelMesh world coords).
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1 * BASE_CELL_SIZE, 10000 * BASE_CELL_SIZE)
    camera.up.set(0, 0, 1)
    const initDist = 12 * BASE_CELL_SIZE
    camera.position.set(initDist, -initDist, initDist)
    camera.lookAt(0, 0, 0)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85)
    dirLight.position.set(-0.4, -0.5, 0.85).normalize()
    scene.add(dirLight)
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))

    const layersGroup = new THREE.Group()
    layersGroup.name = 'voxel-layers'
    scene.add(layersGroup)

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
    layersGroupRef.current = layersGroup
    viewGuidesRef.current = viewGuides

    // Configure renderer size + camera.aspect from the real container size BEFORE
    // draining meshes / auto-fit, else the fit distance is computed for aspect 1.
    // Returns true when the size actually changed (caller decides whether to re-fit).
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

    // React effect order is bottom-up: child VoxelLayerInstance effects run
    // before this parent effect, so onMeshUpdate stored meshes while layersGroup
    // was still null. Drain any already-built meshes into the group now.
    for (const mesh of layerMeshesRef.current.values()) {
      layersGroup.add(mesh)
    }
    if (!userInteractedRef.current && layerMeshesRef.current.size > 0) {
      autoFitToContent(layersGroup, camera, controls)
    }

    const renderOnce = () => {
      const sizeChanged = syncSize()
      if (sizeChanged && !userInteractedRef.current && layerMeshesRef.current.size > 0) {
        autoFitToContent(layersGroup, camera, controls)
      }
      controls.update()
      renderer.render(scene, camera)
    }

    // controls change → redraw (during damping pull frames via RAF until stop).
    let rafId = 0
    const scheduleRender = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        renderOnce()
        if (controls.enableDamping && (controls as unknown as { _isDamping?: boolean })._isDamping) {
          scheduleRender()
        }
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

    // Expose the internal render trigger for reuse (mesh updates / renderFrame).
    ;(renderer as unknown as { __scheduleRender?: () => void }).__scheduleRender = scheduleRender
    ;(renderer as unknown as { __renderOnce?: () => void }).__renderOnce = renderOnce

    return () => {
      ro?.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      controls.dispose()
      for (const mesh of layerMeshesRef.current.values()) {
        layersGroup.remove(mesh)
        disposeMesh(mesh)
      }
      layerMeshesRef.current.clear()
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
      layersGroupRef.current = null
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

  // ── per-layer mesh up-report ───────────────────────────────────────
  // React effect order is bottom-up: child effects run before the parent setup
  // effect, so layersGroupRef.current is null on first mount. This callback:
  //   (1) always updates layerMeshesRef
  //   (2) only syncs to the scene once layersGroup is ready (the setup effect
  //       drains the ref afterwards to catch meshes missed during mount)
  const onMeshUpdate = useCallback((key: string, mesh: THREE.InstancedMesh | null) => {
    const prev = layerMeshesRef.current.get(key)
    if (mesh) layerMeshesRef.current.set(key, mesh)
    else layerMeshesRef.current.delete(key)

    const layersGroup = layersGroupRef.current
    if (layersGroup) {
      if (prev) layersGroup.remove(prev)
      if (mesh) layersGroup.add(mesh)
      if (!userInteractedRef.current) {
        autoFitToContent(layersGroup, cameraRef.current, controlsRef.current)
      }
    }

    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
    bumpTick()
  }, [bumpTick])

  // resetView: clear userInteracted and re-fit. Triggered by the toolbar button.
  const resetView = useCallback(() => {
    userInteractedRef.current = false
    const layersGroup = layersGroupRef.current
    if (layersGroup) autoFitToContent(layersGroup, cameraRef.current, controlsRef.current)
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
  }, [])

  // ── reverse interface (screenshot protocol + view reset) ─────────────
  useImperativeHandle(ref, () => ({
    getFrameCanvas: () => rendererRef.current?.domElement ?? null,
    // Force one synchronous render so the frame is up to date before capture.
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
    // screenToCell / cellToScreen: 3D raycast picking is out of scope here.
  }), [resetView])

  // maxRows / maxCols feed buildVoxelMesh (centering).
  const voxelKeys = useVoxelLayerKeys()
  const bakedKeys = useBakedLayerKeys()
  const renderableVoxelKeys = useMemo(
    () => mergeRenderableVoxelLayerKeys(voxelKeys, bakedKeys),
    [voxelKeys, bakedKeys],
  )
  const { maxRows, maxCols } = useMaxRowsCols(renderableVoxelKeys)

  // wire / color routing
  const colorMode = drawMode === 'color'
  const wireframe = drawMode === 'wire'

  return (
    <div ref={containerRef} className="mode-free3d-host">
      {/* Fallback canvas: ensures a <canvas> is always present even when WebGL
          init is skipped (e.g. jsdom). Real GL output appends over it. */}
      <canvas className="mode-free3d-fallback" />
      {renderableVoxelKeys.map((key, idx) => (
        <VoxelLayerInstance
          key={key}
          layerKey={key}
          layerIdx={idx}
          maxRows={maxRows}
          maxCols={maxCols}
          colorMode={colorMode}
          wireframe={wireframe}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
    </div>
  )
})
ModeFree3dPlugin.displayName = 'ModeFree3dPlugin'

// ── auto-fit ────────────────────────────────────────────────────────────
//
// Place controls.target at the layersGroup bbox center, and the camera at an
// iso-ish angle a distance that just contains the content (bounding sphere).
//   dist = R / sin(fov/2); divide by aspect when portrait; × 1.2 margin.

function autoFitToContent(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null,
): void {
  if (!camera || !controls) return
  group.updateMatrixWorld(true)
  const bbox = new THREE.Box3().setFromObject(group)
  if (!isFinite(bbox.min.x)) return // empty group
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

// ── shared hook: max rows/cols across all voxel layers ──────────────────

function useMaxRowsCols(voxelKeys: string[]): { maxRows: number; maxCols: number } {
  const layers = voxelKeys.map((key) => {
    const voxelLayer = useVoxelLayer(key)
    const bakedLayer = useBakedLayer(key)
    return key.startsWith('baked:') ? bakedLayer : voxelLayer
  })
  return useMemo(() => {
    let maxX = 1, maxY = 1
    for (const layer of layers) {
      if (!layer || !layer.visible) continue
      for (const c of layer.cells) {
        if (c.x + 1 > maxX) maxX = c.x + 1
        if (c.y + 1 > maxY) maxY = c.y + 1
      }
    }
    return { maxRows: maxY, maxCols: maxX }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, layers)
}

// ── per-layer instance: subscribe layer + build mesh + up-report ────────

interface VoxelLayerInstanceProps {
  layerKey: string
  layerIdx: number
  maxRows: number
  maxCols: number
  colorMode: boolean
  wireframe: boolean
  onMeshUpdate(key: string, mesh: THREE.InstancedMesh | null): void
}

function VoxelLayerInstance({
  layerKey, layerIdx: _layerIdx, maxRows, maxCols, colorMode, wireframe, onMeshUpdate,
}: VoxelLayerInstanceProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer
  // Editor selection highlight: brighten the mesh of any layer whose node is
  // editor-selected (free3d's voxelMesh boosts sat/lightness for `isSelected`;
  // it has no separate success-green channel, so editor-selection maps onto the
  // same brighten path — a faithful approximation of the legacy 3D highlight).
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const selected = !!layer
    && (selectedEditorNodeIds.includes(layer.nodeId) || selectedEditorNodeIds.includes(layer.key))

  const cacheKey = useMemo(() => {
    if (!layer || !layer.visible) return undefined
    return `${layerKey}@${layer.updatedAt}|sel=${selected ? 1 : 0}|c=${colorMode ? 1 : 0}|w=${wireframe ? 1 : 0}|${maxRows}x${maxCols}`
  }, [layerKey, layer, selected, colorMode, wireframe, maxRows, maxCols])

  const mesh = useLayerSurface<THREE.InstancedMesh | null>(
    cacheKey,
    () => {
      if (!layer || !layer.visible) return null
      return buildVoxelMesh({
        layer,
        maxRows: Math.max(1, maxRows),
        maxCols: Math.max(1, maxCols),
        heightScale: 1,
        isSelected: selected,
        colorMode,
        wireframe,
      })
    },
    (m) => { if (m) disposeMesh(m) },
  )

  useEffect(() => {
    onMeshUpdate(layerKey, mesh)
  }, [layerKey, mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(layerKey, null), [layerKey, onMeshUpdate])

  return null
}

// ── self-registration ────────────────────────────────────────────────

registerRenderPlugin({
  name: 'free3d',
  modes: ['free3d'],
  Component: ModeFree3dPlugin,
})

export default ModeFree3dPlugin
