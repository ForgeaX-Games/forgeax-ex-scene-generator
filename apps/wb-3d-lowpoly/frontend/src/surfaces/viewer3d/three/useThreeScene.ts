// 💡 三维场景 hook：渲染器 / 相机 / OrbitControls / 灯光 / 网格 / 坐标 / 渲染循环
//    去掉 fancyGraphics 切换（默认开启 PBR + envMap），保留 invalidate-driven render loop
import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createLightingRig, createGridHelper, createAxisHelper, createEnvironmentMap, applyLightingIntensity } from './lighting'
import { disposeObject3D } from './three-dispose'
import { theme } from '../../../theme'

export interface ThreeSceneState {
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  renderer: THREE.WebGLRenderer | null
  controls: OrbitControls | null
  gridGroup: THREE.Group | null
  axisGroup: THREE.Group | null
  invalidate: () => void
  /** Live renderer canvas (`renderer.domElement`) for screenshot capture, or null pre-mount. */
  getFrameCanvas: () => HTMLCanvasElement | null
  /**
   * Force a synchronous `renderer.render(scene, camera)` of the current frame.
   * Unlike `invalidate` (which only schedules a RAF), this paints the backing
   * drawing buffer *immediately* so a `canvas.toBlob` capture taken right after
   * (e.g. on a `screenshot:request`) reads a fresh frame, not a blank/stale one.
   */
  renderFrame: () => void
  /**
   * Render `target` (or the whole scene when null) from four orthographic
   * viewpoints — Front / Side / Top / Iso — and compose them into a single
   * labeled 2×2 contact-sheet `<canvas>`. The live OrbitControls camera is left
   * untouched (a throwaway OrthographicCamera is used), and the on-screen frame
   * is restored before returning. Returns null pre-mount or when the target is
   * empty. Used by the headless `screenshot:request` capture so the agent sees
   * orthographic views (alignment / interpenetration / proportions) instead of
   * one arbitrary perspective shot.
   */
  captureContactSheet: (target: THREE.Object3D | null) => HTMLCanvasElement | null
  sceneReady: boolean
}

export interface ThreeSceneOptions {
  maxPixelRatio?: number
  continuousRender?: boolean
  background?: number | string
  /** 灯光整体强度倍率（1 = 默认），实时生效，不重建场景。见 viewerStore.lighting.intensity。 */
  lightIntensity?: number
}

const DEFAULT_BACKGROUND = theme.colors.viewportBackground

function resolveDepthBufferOptions(): Pick<
  THREE.WebGLRendererParameters,
  'logarithmicDepthBuffer' | 'reversedDepthBuffer'
> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2')
  const supportsReversedDepth = context?.getExtension('EXT_clip_control') != null
  context?.getExtension('WEBGL_lose_context')?.loseContext()

  return supportsReversedDepth
    ? { reversedDepthBuffer: true }
    : { logarithmicDepthBuffer: true }
}

export function useThreeScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: ThreeSceneOptions = {},
): ThreeSceneState {
  const [sceneReady, setSceneReady] = useState(false)

  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const gridGroupRef = useRef<THREE.Group | null>(null)
  const axisGroupRef = useRef<THREE.Group | null>(null)
  const lightingRigRef = useRef<THREE.Group | null>(null)
  const environmentMapRef = useRef<THREE.Texture | null>(null)
  const frameIdRef = useRef<number>(0)
  const lastFrameTimeRef = useRef<number | null>(null)
  const continuousRenderRef = useRef(Boolean(options.continuousRender))
  const needsRenderRef = useRef(false)
  const invalidateRef = useRef<() => void>(() => {})

  const invalidate = useCallback(() => {
    invalidateRef.current()
  }, [])

  // Stable accessor for the renderer canvas. The renderer is created with
  // `preserveDrawingBuffer: true`, so the backing buffer is readable any time
  // (this is the reusable seam Plan 4's headless `screenshot:request` loop
  // captures from via `canvas.toBlob`).
  const getFrameCanvas = useCallback<() => HTMLCanvasElement | null>(
    () => rendererRef.current?.domElement ?? null,
    [],
  )

  // Synchronous render of the current scene/camera into the (preserved) drawing
  // buffer. Reads the live refs directly so it works regardless of the RAF loop
  // state; a no-op until the scene is mounted.
  const renderFrame = useCallback<() => void>(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
  }, [])

  // Orthographic 4-view contact sheet. Renders the scene from Front/Side/Top/Iso
  // with a throwaway OrthographicCamera framed to `target`, blits each render into
  // a labeled quadrant of a 2D canvas, then restores the live perspective frame.
  const captureContactSheet = useCallback<(target: THREE.Object3D | null) => HTMLCanvasElement | null>((target) => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const liveCamera = cameraRef.current
    if (!renderer || !scene) return null

    const box = new THREE.Box3()
    if (target) {
      target.updateMatrixWorld(true)
      box.setFromObject(target)
    }
    if (box.isEmpty()) box.setFromObject(scene)
    if (box.isEmpty()) return null

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1

    const src = renderer.domElement
    const srcW = src.width
    const srcH = src.height
    if (srcW === 0 || srcH === 0) return null
    const aspect = srcW / srcH

    // Cap each cell so the composed PNG stays a reasonable size regardless of
    // the viewer's drawing-buffer resolution.
    const cellW = Math.min(srcW, 640)
    const cellH = Math.round(cellW / aspect)

    // World is Y-up here (the robot group rotates URDF Z-up → THREE Y-up), so the
    // ground plane is XZ and "up" for the elevation views is +Y.
    const views: Array<{ label: string; dir: THREE.Vector3; up: THREE.Vector3 }> = [
      { label: 'Front (−Z)', dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
      { label: 'Side (−X)', dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
      { label: 'Top (−Y)', dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
      { label: 'Iso', dir: new THREE.Vector3(1, 0.8, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
    ]

    const halfH = maxDim * 0.62
    const halfW = halfH * aspect
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, maxDim * 20)

    const labelH = 22
    const gap = 6
    const sheetW = cellW * 2 + gap * 3
    const sheetH = (cellH + labelH) * 2 + gap * 3
    const sheet = document.createElement('canvas')
    sheet.width = sheetW
    sheet.height = sheetH
    const ctx = sheet.getContext('2d')
    if (!ctx) return null

    ctx.fillStyle = '#0b0f0c'
    ctx.fillRect(0, 0, sheetW, sheetH)

    views.forEach((view, i) => {
      cam.up.copy(view.up)
      cam.position.copy(center).addScaledVector(view.dir, maxDim * 4)
      cam.lookAt(center)
      cam.left = -halfW
      cam.right = halfW
      cam.top = halfH
      cam.bottom = -halfH
      cam.near = 0.01
      cam.far = maxDim * 20
      cam.updateProjectionMatrix()
      renderer.render(scene, cam)

      const col = i % 2
      const row = Math.floor(i / 2)
      const x = gap + col * (cellW + gap)
      const y = gap + row * (cellH + labelH + gap)

      // label bar
      ctx.fillStyle = '#16201a'
      ctx.fillRect(x, y, cellW, labelH)
      ctx.fillStyle = '#9fe7b8'
      ctx.font = '13px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(view.label, x + 8, y + labelH / 2)

      // blit the rendered frame (drawImage reads the preserveDrawingBuffer canvas)
      ctx.drawImage(src, x, y + labelH, cellW, cellH)
    })

    // Restore the on-screen perspective frame so the viewer is unchanged.
    if (liveCamera) renderer.render(scene, liveCamera)

    return sheet
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 关键：在 iframe / 远程桌面 / 多 WebGL 上下文超额等场景下 WebGLRenderer 可能直接抛出。
    // 不捕获就会让整个 App 树崩溃成黑屏，并且没有任何提示。
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        ...resolveDepthBufferOptions(),
      })
    } catch (err) {
      console.error('[viewer/useThreeScene] WebGLRenderer create failed', { err: err instanceof Error ? err.message : String(err) })
      const errEl = document.createElement('div')
      errEl.dataset.viewerWebglError = '1'
      errEl.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f04e52;font-size:14px;padding:16px;text-align:center;line-height:1.6'
      errEl.textContent = 'WebGL not available — three.js cannot render. Try opening this viewer in a window with hardware acceleration.'
      container.querySelectorAll('[data-viewer-webgl-error="1"]').forEach((n) => n.remove())
      container.appendChild(errEl)
      return () => { errEl.remove() }
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // 建筑剖切（section view）用：开启局部裁剪面后，材质上挂的 clippingPlanes 才生效。
    // 不挂任何 plane 时此开关无副作用，保持常开即可。
    renderer.localClippingEnabled = true
    renderer.toneMapping = THREE.NoToneMapping
    renderer.toneMappingExposure = 1.0
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(options.background ?? DEFAULT_BACKGROUND)
    sceneRef.current = scene

    const aspect = container.clientWidth / container.clientHeight
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 1000)
    camera.position.set(3, 3, 3)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.target.set(0, 0, 0)
    controlsRef.current = controls

    const lightingRig = createLightingRig(options.lightIntensity ?? 1)
    scene.add(lightingRig)
    lightingRigRef.current = lightingRig

    const gridGroup = createGridHelper()
    scene.add(gridGroup)
    gridGroupRef.current = gridGroup

    const axisGroup = createAxisHelper()
    scene.add(axisGroup)
    axisGroupRef.current = axisGroup

    environmentMapRef.current = createEnvironmentMap(renderer)
    scene.environment = environmentMapRef.current

    let frameCounter = 0
    const renderScene = () => {
      renderer.render(scene, camera)
      frameCounter += 1
      // 仅在前 3 帧打日志，避免污染 console；后续就纯静默运行
      if (frameCounter <= 3) {
        console.log('[viewer/useThreeScene] rendered frame', {
          n: frameCounter,
          children: scene.children.length,
          canvasSize: [renderer.domElement.width, renderer.domElement.height],
        })
      }
    }

    const requestFrame = () => {
      if (frameIdRef.current === 0) {
        frameIdRef.current = requestAnimationFrame(renderFrame)
      }
    }

    const renderFrame = (now: number) => {
      frameIdRef.current = 0
      const deltaSeconds = lastFrameTimeRef.current == null ? null : (now - lastFrameTimeRef.current) / 1000
      lastFrameTimeRef.current = now

      const hadInvalidation = needsRenderRef.current
      needsRenderRef.current = false
      const controlsChanged = controls.update(deltaSeconds ?? undefined)
      if (continuousRenderRef.current || hadInvalidation || controlsChanged) {
        renderScene()
      }

      if (continuousRenderRef.current || controlsChanged) {
        requestFrame()
        return
      }
      lastFrameTimeRef.current = null
    }

    const invalidateFn = () => {
      needsRenderRef.current = true
      requestFrame()
    }

    invalidateRef.current = invalidateFn
    controls.addEventListener('change', invalidateFn)
    invalidateFn()

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width === 0 || height === 0) continue
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
        invalidateFn()
      }
    })
    resizeObserver.observe(container)

    // 一次性诊断：mount 完成后把渲染器关键状态打印到 browserLogger，方便排查
    // "canvas 一片浅灰但 grid/axis/model 都看不见" 这一类 bug。预期：
    //   - container 至少 100x100；canvas 与之相等；
    //   - sceneChildren 包含 lighting-rig / grid-group / axis-helper 三个；
    //   - cameraPos 为 (3,3,3)，target=(0,0,0)；
    console.log('[viewer/useThreeScene] mounted', {
      container: { w: container.clientWidth, h: container.clientHeight },
      canvas: { w: renderer.domElement.clientWidth, h: renderer.domElement.clientHeight },
      pixelRatio: renderer.getPixelRatio(),
      sceneChildren: scene.children.map((c) => c.name || c.type),
      camera: {
        pos: camera.position.toArray(),
        target: controls.target.toArray(),
        near: camera.near,
        far: camera.far,
      },
    })

    setSceneReady(true)

    return () => {
      setSceneReady(false)
      // 关键：cancelAnimationFrame 不会跑 callback，所以 renderFrame 里那句 frameIdRef.current = 0
      // 永远不会执行；如果不在这里手动归零，下一次 mount 调 invalidate → requestFrame() 时
      // 会因为 `frameIdRef.current !== 0` 直接 short-circuit、再也排不出新的 RAF，
      // 整个渲染循环就此死锁，画布一片浅灰且鼠标拖动也唤不醒。
      cancelAnimationFrame(frameIdRef.current)
      frameIdRef.current = 0
      resizeObserver.disconnect()
      controls.removeEventListener('change', invalidateFn)
      controls.dispose()
      renderer.domElement.remove()
      environmentMapRef.current?.dispose()

      // 释放整棵 scene 的 GPU 资源——Mesh、grid/axis 的 Line/LineSegments、
      // collision edge lines，以及 material 上挂的所有 texture。只 dispose Mesh
      // 会漏掉网格 / 坐标轴 / 边线，长期 mount/unmount 会泄漏 GPU 内存。
      disposeObject3D(scene)
      // 阴影贴图（shadow map render target）由各 DirectionalLight.shadow 持有，
      // renderer.dispose() 之前显式释放，避免 GPU 帧缓冲泄漏。
      // LightShadow.dispose() 会一并释放 map 与 mapPass。
      scene.traverse((object) => {
        const light = object as THREE.Object3D & { shadow?: { dispose?: () => void } | null }
        light.shadow?.dispose?.()
      })
      renderer.dispose()

      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      gridGroupRef.current = null
      axisGroupRef.current = null
      lightingRigRef.current = null
      environmentMapRef.current = null
      lastFrameTimeRef.current = null
      needsRenderRef.current = false
      invalidateRef.current = () => {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    continuousRenderRef.current = Boolean(options.continuousRender)
    invalidateRef.current()
  }, [options.continuousRender])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.background = new THREE.Color(options.background ?? DEFAULT_BACKGROUND)
    invalidateRef.current()
  }, [options.background])

  useEffect(() => {
    const rig = lightingRigRef.current
    if (!rig) return
    applyLightingIntensity(rig, options.lightIntensity ?? 1)
    invalidateRef.current()
  }, [options.lightIntensity])

  return {
    scene: sceneRef.current,
    camera: cameraRef.current,
    renderer: rendererRef.current,
    controls: controlsRef.current,
    gridGroup: gridGroupRef.current,
    axisGroup: axisGroupRef.current,
    invalidate,
    getFrameCanvas,
    renderFrame,
    captureContactSheet,
    sceneReady,
  }
}
