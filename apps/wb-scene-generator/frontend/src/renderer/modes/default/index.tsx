// 💡 mode-default: orbit-camera Stage preview (lit terrain / road / houses / guide).
//
// Specialized modes stay registered. This plugin is the first DisplayIndex
// consumer: voxel, grid, and mesh stay separate schemas and can be hidden independently.
// Do not import from free3d / mesh3d / top — shared code lives in framework/.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { drawablesForSchema, useDisplayIndex } from '../../framework/displayIndex'
import { isGuideLayerKeyActive, isMeshLayerSelected } from '../../framework/guideSelection'
import { useBakedLayer, useGridLayer, useGuideLayer, useMeshLayer, useVoxelLayer } from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import { useRenderStore } from '../../store'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { cellToWorldXY, snapWorldXYToCellWorld } from '../../framework/guideDrag'
import {
  applyGizmoDrag,
  beginGizmoDrag,
  buildMoveGizmo,
  disposeMoveGizmo,
  gizmoHandleLiftsPin,
  hoveredGizmoHandle,
  pickGizmoHandle,
  scaleMoveGizmo,
  setGizmoHover,
  type GizmoDragState,
} from '../../framework/guideGizmo'
import { createWorldFrameOverlay, disposeWorldFrameOverlay, LIVE_LAYERED_TERRITORY_PLANES } from '../../framework/worldFrame'
import { buildVoxelMesh, disposeMesh } from '../../framework/adapters/voxelMesh'
import { buildGridPlaneMesh, disposeGridPlaneMesh } from '../../framework/adapters/gridPlane'
import { buildInstancedSurfaceMesh, buildTerrainSurfaceMesh, disposeTerrainSurfaceMesh } from '../../framework/adapters/terrainMesh'
import { buildGuideObject, disposeGuideObject, sampleTerrainZ, scaleGuideBillboards, setGuidePreviewWorld, terrainGuideStamp } from '../../framework/adapters/guideLine'
import { commitGuideParam } from '../../bridge/guideParamBridge'
import { guideLayerToControlPoints, guidePointToControlXY } from '../../framework/guidePoints'
import { commitStageSelect } from '../../bridge/stageSelectBridge'
import {
  registerSceneScriptDiagnosticDisplayIndex,
  useSceneScriptDiagnosticFocusLayerKey,
  useSceneScriptDiagnosticLayerKeys,
} from '../../../workbench/sceneScriptDiagnosticBridge'
import { countStageStats, createStageEnvironment, type StageEnvironment } from '../../framework/stageLighting'
import {
  MAX_ORBIT_DISTANCE,
  MIN_ORBIT_DISTANCE,
  applyCursorZoom,
  autoFitToContent,
  collectZoomPickables,
  pickZoomAim,
  syncOrbitClipPlanes,
} from '../../framework/orbitCamera'
import './ModeDefault.css'

function disposeContent(object: THREE.Object3D): void {
  if (object instanceof THREE.InstancedMesh) disposeMesh(object)
  else if (object instanceof THREE.Group && object.name.startsWith('guide:')) disposeGuideObject(object)
  else if (object instanceof THREE.Mesh) {
    if (object.name.startsWith('terrain:')) disposeTerrainSurfaceMesh(object)
    else disposeGridPlaneMesh(object)
  }
}

const ModeDefaultPlugin = forwardRef<PluginHandle, object>(function ModeDefaultPlugin(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const viewGuidesVisible = useRenderStore(s => s.viewGuides.default)
  const worldPlanes = useRenderStore(s => s.worldPlanes)
  const guideLayers = useRenderStore(s => s.guideLayers)
  const schemaVisible = useRenderStore(s => s.schemaVisible)
  const guideEditError = useRenderStore(s => s.guideEditError)

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const contentGroupRef = useRef<THREE.Group | null>(null)
  const viewGuidesRef = useRef<THREE.Group | null>(null)
  const stageEnvRef = useRef<StageEnvironment | null>(null)
  const userInteractedRef = useRef(false)
  const [hud, setHud] = useState({ triangles: 0, objects: 0, selected: '' })

  const layerMeshesRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const [, forceTick] = useState(0)
  const tickRef = useRef(0)
  const bumpTick = useCallback(() => {
    tickRef.current++
    forceTick(t => t + 1)
  }, [])

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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.appendChild(renderer.domElement)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.pointerEvents = 'auto'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05 * BASE_CELL_SIZE, 24000 * BASE_CELL_SIZE)
    camera.up.set(0, 0, 1)
    const initDist = 12 * BASE_CELL_SIZE
    camera.position.set(initDist, -initDist, initDist)
    camera.lookAt(0, 0, 0)

    const stageEnv = createStageEnvironment(scene, renderer)
    stageEnvRef.current = stageEnv

    const contentGroup = new THREE.Group()
    contentGroup.name = 'default-content'
    scene.add(contentGroup)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.target.set(0, 0, 0)
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    controls.zoomToCursor = false
    controls.screenSpacePanning = true
    controls.minDistance = MIN_ORBIT_DISTANCE
    controls.maxDistance = MAX_ORBIT_DISTANCE
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    controlsRef.current = controls
    contentGroupRef.current = contentGroup
    viewGuidesRef.current = null

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

    for (const mesh of layerMeshesRef.current.values()) {
      contentGroup.add(mesh)
    }
    if (!userInteractedRef.current && layerMeshesRef.current.size > 0) {
      autoFitToContent(contentGroup, camera, controls)
    }

    const renderOnce = () => {
      const sizeChanged = syncSize()
      if (sizeChanged && !userInteractedRef.current && layerMeshesRef.current.size > 0) {
        autoFitToContent(contentGroup, camera, controls)
      }
      controls.update()
      scaleGuideBillboards(contentGroup, camera)
      scaleMoveGizmo(contentGroup, camera)
      renderer.render(scene, camera)
    }

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

    ;(renderer as unknown as { __scheduleRender?: () => void }).__scheduleRender = scheduleRender
    ;(renderer as unknown as { __renderOnce?: () => void }).__renderOnce = renderOnce

    return () => {
      ro?.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      controls.dispose()
      for (const mesh of layerMeshesRef.current.values()) {
        contentGroup.remove(mesh)
        disposeContent(mesh)
      }
      layerMeshesRef.current.clear()
      const overlay = viewGuidesRef.current
      if (overlay) {
        scene.remove(overlay)
        disposeWorldFrameOverlay(overlay)
      }
      stageEnvRef.current?.dispose()
      stageEnvRef.current = null
      scene.clear()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      contentGroupRef.current = null
      viewGuidesRef.current = null
      userInteractedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const content = contentGroupRef.current
    if (!renderer || !camera || !controls || !content) return
    const el = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()
    let drag: {
      key: string
      index: number
      sourceNodeId?: string
      sourceOpId?: string
      gizmo: GizmoDragState
      pending: { x: number; y: number; z: number }
    } | null = null
    let pointerDown: { x: number; y: number; missed: boolean } | null = null
    const CLICK_SLOP = 6

    const toNdc = (e: PointerEvent | WheelEvent): void => {
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    }

    const schedule = (): void => {
      (renderer as unknown as { __scheduleRender?: () => void }).__scheduleRender?.()
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      toNdc(e)
      raycaster.setFromCamera(ndc, camera)
      const store = useRenderStore.getState()
      if (store.schemaVisible.guide) {
        const handle = hoveredGizmoHandle(content) ?? pickGizmoHandle(raycaster, content)
        const sel = store.selectedGuidePoint
        if (handle && sel) {
          const layer = store.guideLayers[sel.key]
          const pt = layer?.points[sel.index]
          if (pt) {
            e.stopImmediatePropagation()
            e.preventDefault()
            controls.enabled = false
            userInteractedRef.current = true
            const gizmo = content.getObjectByName('guide-gizmo')
            const xy = cellToWorldXY(pt.x, pt.y, BASE_CELL_SIZE)
            const start = new THREE.Vector3(
              xy.x,
              xy.y,
              Number.isFinite(pt.z) ? pt.z! : (gizmo ? gizmo.position.z : 0),
            )
            const gizmoDrag = beginGizmoDrag(handle, raycaster.ray, start)
            if (gizmoDrag) {
              setGizmoHover(content, handle)
              store.setGuideDragging(true)
              store.setGuideCommitLock({ key: sel.key, index: sel.index, x: pt.x, y: pt.y })
              store.setGuideEditSnapshot({ key: sel.key, points: layer.points.map((p) => ({ ...p })) })
              store.setGuideEditError(null)
              drag = {
                key: sel.key,
                index: sel.index,
                sourceNodeId: pt.sourceNodeId,
                sourceOpId: pt.sourceOpId,
                gizmo: gizmoDrag,
                pending: { x: pt.x, y: pt.y, z: start.z },
              }
              el.setPointerCapture(e.pointerId)
              schedule()
            }
            return
          }
        }
        const dots: THREE.Object3D[] = []
        content.traverse((obj) => { if (obj.name.startsWith('guide-dot:')) dots.push(obj) })
        const obj = raycaster.intersectObjects(dots, false)[0]?.object
        if (obj) {
          const guideKey = obj.userData.guideKey
          const guideIndex = obj.userData.guideIndex
          if (typeof guideKey === 'string' && typeof guideIndex === 'number') {
            e.stopImmediatePropagation()
            e.preventDefault()
            controls.enabled = false
            userInteractedRef.current = true
            store.setSelectedGuidePoint({ key: guideKey, index: guideIndex })
            commitStageSelect([guideKey])
            pointerDown = { x: e.clientX, y: e.clientY, missed: false }
            el.setPointerCapture(e.pointerId)
            return
          }
        }
      }
      const pickables: THREE.Object3D[] = []
      content.traverse((child) => {
        if (child.userData?.skipFit) return
        if (child.userData?.gizmoHandle) return
        if (child.userData?.nodeId && (child instanceof THREE.Mesh || child instanceof THREE.Line)) {
          pickables.push(child)
        }
      })
      const picked = raycaster.intersectObjects(pickables, false)[0]?.object
      const layerKey = typeof picked?.userData.layerKey === 'string' ? picked.userData.layerKey : undefined
      const nodeId = typeof picked?.userData.nodeId === 'string' ? picked.userData.nodeId : undefined
      if (layerKey || nodeId) {
        store.setSelectedGuidePoint(null)
        setGizmoHover(content, null)
        commitStageSelect([layerKey ?? nodeId!])
        pointerDown = { x: e.clientX, y: e.clientY, missed: false }
        return
      }
      pointerDown = { x: e.clientX, y: e.clientY, missed: true }
    }

    const onMove = (e: PointerEvent): void => {
      toNdc(e)
      raycaster.setFromCamera(ndc, camera)
      if (drag) {
        if (!applyGizmoDrag(drag.gizmo, raycaster.ray, hit)) return
        const snapped = snapWorldXYToCellWorld(hit.x, hit.y, BASE_CELL_SIZE)
        const z = gizmoHandleLiftsPin(drag.gizmo.handle)
          ? hit.z
          : sampleTerrainZ(Object.values(useRenderStore.getState().meshLayers), snapped.cell.x, snapped.cell.y)
        drag.pending = { x: snapped.cell.x, y: snapped.cell.y, z }
        setGuidePreviewWorld(content, drag.key, drag.index, snapped.world.x, snapped.world.y, z)
        setGizmoHover(content, drag.gizmo.handle)
        schedule()
        return
      }
      const handle = pickGizmoHandle(raycaster, content)
      el.style.cursor = handle ? 'pointer' : ''
      if (setGizmoHover(content, handle ?? null)) schedule()
    }

    const onUp = (e: PointerEvent): void => {
      controls.enabled = true
      el.style.cursor = ''
      if (drag) {
        const done = drag
        drag = null
        pointerDown = null
        const store = useRenderStore.getState()
        const groundZ = sampleTerrainZ(Object.values(store.meshLayers), done.pending.x, done.pending.y)
        const xy = cellToWorldXY(done.pending.x, done.pending.y, BASE_CELL_SIZE)
        setGuidePreviewWorld(content, done.key, done.index, xy.x, xy.y, groundZ)
        store.moveGuidePoint(done.key, done.index, done.pending.x, done.pending.y)
        store.setGuideCommitLock({ key: done.key, index: done.index, x: done.pending.x, y: done.pending.y })
        store.setGuideDragging(false)
        scaleGuideBillboards(content, camera)
        const layer = store.guideLayers[done.key]
        const pt = layer?.points[done.index]
        if (pt && done.sourceNodeId) {
          if (done.sourceOpId === 'control_points' || pt.sourceOpId === 'control_points') {
            commitGuideParam(
              done.sourceNodeId,
              'points',
              guideLayerToControlPoints(layer?.points ?? [], done.index, {
                x: done.pending.x,
                y: done.pending.y,
              }),
            )
          } else {
            const [localX, localY] = guidePointToControlXY(pt, {
              x: done.pending.x,
              y: done.pending.y,
            })
            commitGuideParam(done.sourceNodeId, 'x', localX)
            commitGuideParam(done.sourceNodeId, 'y', localY)
          }
        }
        return
      }
      const down = pointerDown
      pointerDown = null
      if (!down?.missed) return
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return
      useRenderStore.getState().setSelectedGuidePoint(null)
      setGizmoHover(content, null)
      commitStageSelect([])
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      userInteractedRef.current = true
      toNdc(e)
      raycaster.setFromCamera(ndc, camera)
      const aim = pickZoomAim(raycaster, collectZoomPickables(content), camera, controls.target)
      applyCursorZoom(camera, controls, aim, e)
      syncOrbitClipPlanes(camera, controls.target)
      controls.update()
      schedule()
    }

    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel, true)
      el.style.cursor = ''
    }
  }, [])

  useEffect(() => {
    const hasContinentFrame = Object.values(guideLayers).some((layer) => layer.nodeName === 'ContinentFrame')
    const store = useRenderStore.getState()
    if (hasContinentFrame) {
      if (store.worldPlanes[0]?.id !== 'continent' || store.worldPlanes.length !== LIVE_LAYERED_TERRITORY_PLANES.length) {
        store.setWorldPlanes([...LIVE_LAYERED_TERRITORY_PLANES])
      }
      if (!store.viewGuides.default) store.setViewGuideVisible('default', true)
      return
    }
    if (store.worldPlanes.length) store.setWorldPlanes([])
  }, [guideLayers])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const prev = viewGuidesRef.current
    if (prev) {
      scene.remove(prev)
      disposeWorldFrameOverlay(prev)
    }
    const overlay = createWorldFrameOverlay(worldPlanes)
    overlay.visible = useRenderStore.getState().viewGuides.default
    scene.add(overlay)
    viewGuidesRef.current = overlay
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
  }, [worldPlanes])

  useEffect(() => {
    if (viewGuidesRef.current) viewGuidesRef.current.visible = viewGuidesVisible
    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
  }, [viewGuidesVisible])

  const onMeshUpdate = useCallback((key: string, mesh: THREE.Object3D | null) => {
    const prev = layerMeshesRef.current.get(key)
    if (mesh) layerMeshesRef.current.set(key, mesh)
    else layerMeshesRef.current.delete(key)

    const contentGroup = contentGroupRef.current
    if (contentGroup) {
      if (prev) contentGroup.remove(prev)
      if (mesh) contentGroup.add(mesh)
      if (!userInteractedRef.current) {
        autoFitToContent(contentGroup, cameraRef.current, controlsRef.current)
      }
    }

    const sched = (rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender
    sched?.()
    bumpTick()
    const content = contentGroupRef.current
    if (content) {
      const stats = countStageStats(content)
      const selected = useRenderStore.getState().selectedEditorNodeIds[0] ?? ''
      setHud({ triangles: stats.triangles, objects: stats.objects, selected })
    }
  }, [bumpTick])

  const resetView = useCallback(() => {
    userInteractedRef.current = false
    const contentGroup = contentGroupRef.current
    if (contentGroup) autoFitToContent(contentGroup, cameraRef.current, controlsRef.current)
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

  const index = useDisplayIndex()
  const diagnosticLayerKeys = useSceneScriptDiagnosticLayerKeys(index)
  const diagnosticLayerKeySet = useMemo(() => new Set(diagnosticLayerKeys), [diagnosticLayerKeys])
  const focusedDiagnosticLayerKey = useSceneScriptDiagnosticFocusLayerKey()
  useEffect(() => {
    registerSceneScriptDiagnosticDisplayIndex(index)
  }, [index])
  useEffect(() => {
    if (!focusedDiagnosticLayerKey) return
    const object = layerMeshesRef.current.get(focusedDiagnosticLayerKey)
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!object || !camera || !controls) return
    const box = new THREE.Box3().setFromObject(object)
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const direction = camera.position.clone().sub(controls.target).normalize()
    const distance = Math.max(sphere.radius * 3, MIN_ORBIT_DISTANCE)
    controls.target.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(direction, distance)
    syncOrbitClipPlanes(camera, controls.target)
    controls.update()
    userInteractedRef.current = true
    ;(rendererRef.current as unknown as { __scheduleRender?: () => void } | null)?.__scheduleRender?.()
  }, [focusedDiagnosticLayerKey])
  const allVoxelDrawables = drawablesForSchema(index, 'voxel')
  const voxelDrawables = schemaVisible.voxel ? allVoxelDrawables : []
  const gridDrawables = schemaVisible.grid ? drawablesForSchema(index, 'grid') : []
  const meshDrawables = schemaVisible.mesh ? drawablesForSchema(index, 'mesh') : []
  const roadDrawables = schemaVisible.road ? drawablesForSchema(index, 'road') : []
  const houseDrawables = schemaVisible.houses
    ? [...drawablesForSchema(index, 'houses'), ...drawablesForSchema(index, 'ref')]
    : []
  const guideDrawables = schemaVisible.guide ? drawablesForSchema(index, 'guide') : []
  const allVoxelKeys = useMemo(() => allVoxelDrawables.map((d) => d.layerKey), [allVoxelDrawables])
  const { maxRows, maxCols } = useMaxRowsCols(allVoxelKeys)

  const colorMode = drawMode === 'color'
  const wireframe = drawMode === 'wire'

  return (
    <div ref={containerRef} className="mode-default-host" data-mode="default">
      <canvas className="mode-default-fallback" />
      <div className="mode-default-hud" data-testid="stage-hud">
        <span>{hud.triangles} tri</span>
        <span>{hud.objects} obj</span>
        {hud.selected ? <span>sel {hud.selected.slice(0, 10)}</span> : <span>click a pin for axes</span>}
      </div>
      {guideEditError && (
        <div className="mode-default-edit-error" role="alert" data-testid="guide-edit-error">
          <span>{guideEditError}</span>
          <button type="button" onClick={() => useRenderStore.getState().setGuideEditError(null)}>Dismiss</button>
        </div>
      )}
      {voxelDrawables.map((drawable, idx) => (
        <VoxelLayerInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          layerIdx={idx}
          maxRows={maxRows}
          maxCols={maxCols}
          colorMode={colorMode}
          wireframe={wireframe}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      {gridDrawables.map((drawable, idx) => (
        <GridPlaneInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          layerIdx={idx}
          wireframe={wireframe}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      {meshDrawables.map((drawable) => (
        <TerrainMeshInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          wireframe={wireframe}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      {roadDrawables.map((drawable) => (
        <TerrainMeshInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          wireframe={wireframe}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      {houseDrawables.map((drawable) => (
        <TerrainMeshInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          wireframe={wireframe}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      {guideDrawables.map((drawable) => (
        <GuideLayerInstance
          key={drawable.id}
          layerKey={drawable.layerKey}
          diagnostic={diagnosticLayerKeySet.has(drawable.layerKey)}
          onMeshUpdate={onMeshUpdate}
        />
      ))}
      <MoveGizmoInstance onMeshUpdate={onMeshUpdate} />
    </div>
  )
})
ModeDefaultPlugin.displayName = 'ModeDefaultPlugin'

function useMaxRowsCols(voxelKeys: string[]): { maxRows: number; maxCols: number } {
  // Aggregate extent cannot subscribe per-key: a variable-length map of
  // useVoxelLayer/useBakedLayer violates the Rules of Hooks when Default stays
  // mounted and the layer list shrinks (landing/reset now keep viewMode default).
  const voxelLayers = useRenderStore((s) => s.layers)
  const bakedLayers = useRenderStore((s) => s.bakedLayers)
  return useMemo(() => {
    let maxX = 1, maxY = 1
    for (const key of voxelKeys) {
      const layer = key.startsWith('baked:') ? bakedLayers[key] : voxelLayers[key]
      if (!layer || !layer.visible) continue
      for (const c of layer.cells) {
        if (c.x + 1 > maxX) maxX = c.x + 1
        if (c.y + 1 > maxY) maxY = c.y + 1
      }
    }
    return { maxRows: maxY, maxCols: maxX }
  }, [voxelKeys, voxelLayers, bakedLayers])
}

interface VoxelLayerInstanceProps {
  layerKey: string
  layerIdx: number
  maxRows: number
  maxCols: number
  colorMode: boolean
  wireframe: boolean
  diagnostic?: boolean
  onMeshUpdate(key: string, mesh: THREE.Object3D | null): void
}

function VoxelLayerInstance({
  layerKey, layerIdx: _layerIdx, maxRows, maxCols, colorMode, wireframe, diagnostic = false, onMeshUpdate,
}: VoxelLayerInstanceProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const selected = !!layer
    && (diagnostic || selectedEditorNodeIds.includes(layer.nodeId) || selectedEditorNodeIds.includes(layer.key))

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

interface GridPlaneInstanceProps {
  layerKey: string
  layerIdx: number
  wireframe: boolean
  diagnostic?: boolean
  onMeshUpdate(key: string, mesh: THREE.Object3D | null): void
}

function GridPlaneInstance({ layerKey, layerIdx, wireframe, diagnostic = false, onMeshUpdate }: GridPlaneInstanceProps) {
  const layer = useGridLayer(layerKey)

  const cacheKey = useMemo(() => {
    if (!layer || !layer.visible) return undefined
    return `grid:${layerKey}@${layer.updatedAt}|w=${wireframe ? 1 : 0}|i=${layerIdx}|diag=${diagnostic ? 1 : 0}`
  }, [layerKey, layer, wireframe, layerIdx, diagnostic])

  const mesh = useLayerSurface<THREE.Mesh | null>(
    cacheKey,
    () => {
      if (!layer || !layer.visible) return null
      const plane = buildGridPlaneMesh({ layer, wireframe, layerIdx })
      if (plane && diagnostic && plane.material instanceof THREE.MeshBasicMaterial) {
        plane.material.color.set(0xff5a36)
      }
      return plane
    },
    (m) => { if (m) disposeGridPlaneMesh(m) },
  )

  useEffect(() => {
    onMeshUpdate(layerKey, mesh)
  }, [layerKey, mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(layerKey, null), [layerKey, onMeshUpdate])

  return null
}

interface TerrainMeshInstanceProps {
  layerKey: string
  wireframe: boolean
  diagnostic?: boolean
  onMeshUpdate(key: string, mesh: THREE.Object3D | null): void
}

function TerrainMeshInstance({ layerKey, wireframe, diagnostic = false, onMeshUpdate }: TerrainMeshInstanceProps) {
  const layer = useMeshLayer(layerKey)
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const meshLayers = useRenderStore(s => s.meshLayers)
  const selected = !!layer && (diagnostic || isMeshLayerSelected(layer, selectedEditorNodeIds, meshLayers))

  const cacheKey = useMemo(() => {
    if (!layer || !layer.visible) return undefined
    return `mesh:${layerKey}@${layer.updatedAt}|w=${wireframe ? 1 : 0}|sel=${selected ? 1 : 0}`
  }, [layerKey, layer, wireframe, selected])

  const mesh = useLayerSurface<THREE.Mesh | THREE.InstancedMesh | null>(
    cacheKey,
    () => {
      if (!layer || !layer.visible) return null
      if (layer.instances && layer.instances.length > 0) {
        return buildInstancedSurfaceMesh({ layer, wireframe, selected })
      }
      return buildTerrainSurfaceMesh({ layer, wireframe, selected })
    },
    (m) => { if (m) disposeTerrainSurfaceMesh(m) },
  )

  useEffect(() => {
    onMeshUpdate(layerKey, mesh)
  }, [layerKey, mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(layerKey, null), [layerKey, onMeshUpdate])

  return null
}

interface GuideLayerInstanceProps {
  layerKey: string
  diagnostic?: boolean
  onMeshUpdate(key: string, mesh: THREE.Object3D | null): void
}

function MoveGizmoInstance({ onMeshUpdate }: { onMeshUpdate(key: string, mesh: THREE.Object3D | null): void }) {
  const sel = useRenderStore((s) => s.selectedGuidePoint)
  const dragging = useRenderStore((s) => s.guideDragging)
  const layer = useGuideLayer(sel?.key)
  const meshLayers = useRenderStore((s) => s.meshLayers)
  const terrainStamp = useMemo(() => terrainGuideStamp(Object.values(meshLayers)), [meshLayers])
  const pt = sel && layer ? layer.points[sel.index] : undefined
  const cacheKey = sel ? `gizmo:${sel.key}:${sel.index}` : undefined

  const mesh = useLayerSurface<THREE.Object3D | null>(
    cacheKey,
    () => (sel ? buildMoveGizmo() : null),
    (m) => { if (m) disposeMoveGizmo(m) },
  )

  useEffect(() => {
    if (!mesh || !pt || dragging) return
    const xy = cellToWorldXY(pt.x, pt.y, BASE_CELL_SIZE)
    const z = Number.isFinite(pt.z) ? pt.z! : sampleTerrainZ(Object.values(meshLayers), pt.x, pt.y)
    mesh.position.set(xy.x, xy.y, z)
  }, [mesh, pt, pt?.x, pt?.y, terrainStamp, meshLayers, dragging])

  useEffect(() => {
    onMeshUpdate('__move-gizmo__', mesh)
  }, [mesh, onMeshUpdate])
  useEffect(() => () => onMeshUpdate('__move-gizmo__', null), [onMeshUpdate])
  return null
}

function GuideLayerInstance({ layerKey, diagnostic = false, onMeshUpdate }: GuideLayerInstanceProps) {
  const layer = useGuideLayer(layerKey)
  const meshLayers = useRenderStore(s => s.meshLayers)
  const terrainStamp = useMemo(() => terrainGuideStamp(Object.values(meshLayers)), [meshLayers])
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const index = useDisplayIndex()
  const selected = diagnostic || isGuideLayerKeyActive(layerKey, index, selectedEditorNodeIds, layer?.nodeId)

  const cacheKey = useMemo(() => {
    if (!layer || !layer.visible) return undefined
    const sig = `${layer.style}|${layer.points.map((pt) => `${pt.x},${pt.y}`).join(';')}`
    return `guide:${layerKey}@${layer.updatedAt}|t${terrainStamp}|${sig}|sel=${selected ? 1 : 0}`
  }, [layerKey, layer, selected, terrainStamp])

  const mesh = useLayerSurface<THREE.Object3D | null>(
    cacheKey,
    () => {
      if (!layer || !layer.visible) return null
      return buildGuideObject(layer, Object.values(meshLayers), selected)
    },
    (m) => { if (m) disposeGuideObject(m) },
  )

  useEffect(() => {
    onMeshUpdate(layerKey, mesh)
  }, [layerKey, mesh, onMeshUpdate])

  useEffect(() => () => onMeshUpdate(layerKey, null), [layerKey, onMeshUpdate])

  return null
}

registerRenderPlugin({
  name: 'default',
  modes: ['default'],
  Component: ModeDefaultPlugin,
})

export default ModeDefaultPlugin
