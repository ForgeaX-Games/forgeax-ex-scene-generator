// 💡 URDF 场景集成 hook：组合 useThreeScene + URDF 解析 + 场景图构建 + 关节控制 + 自动动画
//    职责：把 URDF 源文本变成 THREE 场景中的 articulated robot，并暴露 spec / joint 控制接口给 UI
import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react'
import * as THREE from 'three'
import { useThreeScene } from './useThreeScene'
import { parseUrdf, rewriteAbsoluteMeshFilenames, type UrdfSpec } from './urdf-parser'
import { buildRobotSceneGraph, type RobotSceneGraph } from './scene-graph-builder'
import { loadGeometryObject } from './geometry-loader'
import { disposeObject3D } from './three-dispose'
import { buildStaticScene } from './scene-builder'
import {
  buildCharacterSkeleton,
  buildCharacterSkinnedMeshes,
  buildCharacterAnimationClips,
  type CharacterSkeleton,
} from './character-builder'
import { buildBoneShapes } from './bone-shape-builder'
import type { AutoSkinParams } from './auto-skin'
import { resolveVisualMaterialSpec } from './materials'
import { useJointController } from './useJointController'
import { computeFit, updateCameraClipping, computeSceneSphere, applyClippingForSphere } from './camera-utils'
import { positionGroundHelpers } from './lighting'
import {
  buildPreviewMotions,
  isPreviewJoint,
  previewJointValue,
  computeAuthoredJointValuesAtTime,
  type PreviewJointMotion,
} from './urdf-joint-motion'
import { useViewerStore } from '../store/viewerStore'
import { pluginUrl } from '../../../api/pluginHttp'

export interface UseViewer3DSceneOptions {
  source: string
  baseUrl: string
  assetRevisionKey: string | null
  showGrid: boolean
  showAxis: boolean
  showCollisions: boolean
  autoAnimate: boolean
  doubleSided: boolean
  /** 建筑剖切：用水平裁剪面切掉顶部，看进中空建筑内部。 */
  sectionView: boolean
  /** 剖切高度（0..1，模型高度比例）：1=完整，越小切掉越多顶部。 */
  sectionHeight: number
  background?: number | string
  /** 灯光整体强度倍率，透传给 useThreeScene。 */
  lightIntensity?: number
  /** 线框模式：所有可见 mesh 材质切到 wireframe。 */
  wireframe: boolean
}

export interface Viewer3DSceneStats {
  links: number
  joints: number
  movableJoints: number
  primitiveCount: number
  meshCount: number
  loadedMeshCount: number
  failedMeshCount: number
}

export interface UseViewer3DSceneResult {
  spec: UrdfSpec | null
  error: string | null
  jointValues: Map<string, number>
  previewJointValues: Map<string, number>
  setJointValue: (name: string, value: number) => void
  resetAllJoints: () => void
  resetCamera: () => void
  getExportObject: () => THREE.Object3D | null
  /**
   * 角色模式导出访问器：返回活跃的 SkinnedMesh + Skeleton 容器与骨骼动画 clip；
   * 非角色模式（或尚未构建）返回 null。供 exportCharacterGlbBlob 使用。
   */
  getCharacterExport: () => { root: THREE.Object3D; clips: THREE.AnimationClip[] } | null
  /** Live renderer canvas accessor for screenshot capture (see `captureFrame`). */
  getFrameCanvas: () => HTMLCanvasElement | null
  /** Force a synchronous render so a capture reads a fresh frame (see `useThreeScene`). */
  renderFrame: () => void
  /** Render the robot from 4 orthographic views into a labeled 2×2 contact-sheet canvas. */
  captureContactSheet: () => HTMLCanvasElement | null
  invalidate: () => void
  stats: Viewer3DSceneStats
  loading: boolean
}

const PREVIEW_UI_SYNC_MS = 100
/** Link-name tag shared with scene-graph-builder.ts / selection-highlight.ts (`userData.urdfLinkName`). */
const LINK_USER_DATA_KEY = 'urdfLinkName'

/**
 * URDF 默认 Z-up（地面=Z=0 平面），THREE 默认 Y-up。
 * 把 spec.root 包到一个外层 Group 里：
 *   1) 绕 X 轴旋转 -90°，将 URDF 的 Z 轴对齐到 THREE 的 Y 轴；
 *   2) 把模型整体落到地面：center 对齐 (x=0, z=0)，box.min.y=0（脚踩网格）。
 * 不做这一步，对 z-up 模型而言，相机可能"看着原点"，而模型实际在视锥外；
 * 也可能模型 footprint 远离原点，导致 fit 之后摄像机飞出 grid 的可视区域。
 */
const ROBOT_GROUP_NAME = '__viewer_robot__'
const CHARACTER_GROUP_NAME = '__viewer_character__'
const SCENE_GROUP_NAME = '__viewer_scene__'
function normalizeRobotGroupToGroundOrigin(robotGroup: THREE.Group): void {
  robotGroup.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(robotGroup)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  robotGroup.position.x -= center.x
  robotGroup.position.y -= box.min.y
  robotGroup.position.z -= center.z
  robotGroup.updateMatrixWorld(true)
}

/**
 * 角色可蒙皮网格资源的加载 base URL（内容寻址 blob）——与 rigBaseUrl 相同，缺省兜底。
 * 经 pluginUrl 前缀化：Studio `/__fx/<id>/` 反代下裸路径会 404（见 AGENTS.md
 * "Standalone HTTP wrapper"）。
 */
const RIG_ASSET_BASE_URL = pluginUrl('/api/v1/library/blob')

export function useViewer3DScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseViewer3DSceneOptions,
): UseViewer3DSceneResult {
  const scene = useThreeScene(containerRef, {
    background: options.background,
    continuousRender: false,
    lightIntensity: options.lightIntensity,
  })

  const [spec, setSpec] = useState<UrdfSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [jointNodes, setJointNodes] = useState<Map<string, THREE.Object3D> | null>(null)
  const [stats, setStats] = useState<Viewer3DSceneStats>({
    links: 0, joints: 0, movableJoints: 0, primitiveCount: 0, meshCount: 0,
    loadedMeshCount: 0, failedMeshCount: 0,
  })

  const robotGraphRef = useRef<RobotSceneGraph | null>(null)
  const robotRootRef = useRef<THREE.Group | null>(null)

  // ── Character（角色骨骼蒙皮）分支状态 ────────────────────────────────────
  // rigSpec / rigBaseUrl 由 live-sync 推进 store；命中 character 模式时构建
  // SkinnedMesh + Skeleton（权重由 auto-skin 求解），与 URDF 机器人互斥（同一时刻
  // 只有一条链非空——setRig 会清空 source，setSource 会清空 rigSpec）。
  const rigSpec = useViewerStore((s) => s.rigSpec)
  const rigBaseUrl = useViewerStore((s) => s.rigBaseUrl)
  const characterRootRef = useRef<THREE.Group | null>(null)
  const characterSkeletonRef = useRef<CharacterSkeleton | null>(null)
  const characterClipsRef = useRef<THREE.AnimationClip[]>([])
  const [characterReady, setCharacterReady] = useState(0)

  // ── Static（纯静态物体 / 场景）分支状态 ─────────────────────────────────
  // sceneSpec / sceneBaseUrl 由 live-sync 推进 store；命中 static 模式时逐条加载网格
  // 并组合成静态场景。与 URDF / 角色互斥（同一时刻只有一条源非空——setScene 会清空
  // source 与 rigSpec）。
  const sceneSpec = useViewerStore((s) => s.sceneSpec)
  const sceneBaseUrl = useViewerStore((s) => s.sceneBaseUrl)
  const sceneRootRef = useRef<THREE.Group | null>(null)
  // 建筑剖切用的世界空间水平裁剪面。法线 (0,-1,0)：保留 worldY <= constant 的部分
  // （即切掉 constant 以上的顶部）。constant 在下方 effect 里按模型高度实时更新。
  const sectionPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0))
  const getExportObject = useCallback(() => characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current, [])
  const getCharacterExport = useCallback(() => {
    const root = characterRootRef.current
    if (!root) return null
    return { root, clips: characterClipsRef.current }
  }, [])
  /**
   * 是否已经针对当前的 viewer 实例做过一次自动相机 fit。
   *
   * 只在"第一次"加载 URDF 时把相机自适应到模型——后续的所有 URDF 更新（拖滑条触发的
   * 增量重算 / 关节变化 / 几何重生成）都保留用户当下的视角，不要默默把相机弹回去。
   * 用户要重新 fit 时点侧边栏的"重置相机"（resetCamera）即可，那里仍然走 computeFit。
   */
  const hasFitInitiallyRef = useRef(false)
  /**
   * 上次自动 fit 时模型的尺寸（包围盒 size）。用来区分"实时调参"（尺寸基本不变，
   * 保持用户视角）和"切换到另一个模型/节点"（尺寸显著变化，需要重新 fit）——后者
   * 若不重新 fit，从大模型切到小模型时小模型会被框在远距相机里、看起来一片空白。
   */
  const lastFitSizeRef = useRef<THREE.Vector3 | null>(null)

  // useThreeScene 内部把 scene/camera/... 都用 useRef 持有，返回值里读 *Ref.current；
  // 因此 scene.scene / scene.camera / scene.invalidate 这些字段在多次 render 之间是稳定引用，
  // 直接进 effect 依赖列表是安全的。
  const { scene: sceneObj3d, camera, controls, gridGroup, axisGroup, invalidate, getFrameCanvas, renderFrame, captureContactSheet: captureContactSheetRaw, sceneReady } = scene

  // Capture the contact sheet framed to whichever pipeline is active (character
  // / static-scene / URDF — same precedence as getExportObject), falling back
  // to the whole scene inside useThreeScene when nothing is loaded yet. Framing
  // only on `robotRootRef` left character/static captures either empty (no
  // robot root) or wrongly bounded to the grid/lights.
  const captureContactSheet = useCallback<() => HTMLCanvasElement | null>(
    () => captureContactSheetRaw(characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current),
    [captureContactSheetRaw],
  )

  // 解析 URDF 源 + 构建场景图（每次 source 变化都触发）
  useEffect(() => {
    if (!sceneReady || !sceneObj3d) return
    const sceneObj = sceneObj3d

    // 清理上一棵机器人
    if (robotRootRef.current) {
      sceneObj.remove(robotRootRef.current)
      disposeObject3D(robotRootRef.current)
      robotRootRef.current = null
      robotGraphRef.current = null
    }
    setJointNodes(null)
    setSpec(null)
    setError(null)
    setStats({ links: 0, joints: 0, movableJoints: 0, primitiveCount: 0, meshCount: 0, loadedMeshCount: 0, failedMeshCount: 0 })

    const src = options.source.trim()
    if (!src) {
      invalidate()
      return
    }

    let parsed: UrdfSpec
    const parseT0 = performance.now()
    try {
      parsed = rewriteAbsoluteMeshFilenames(parseUrdf(src))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[viewer/useViewer3DScene] parseUrdf failed', { msg })
      setError(msg)
      invalidate()
      return
    }
    const parseMs = performance.now() - parseT0

    let graph: RobotSceneGraph
    const buildT0 = performance.now()
    try {
      graph = buildRobotSceneGraph(parsed, {
        showVisuals: true,
        showCollisions: options.showCollisions,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[viewer/useViewer3DScene] buildRobotSceneGraph failed', { msg })
      setError(`Scene build failed: ${msg}`)
      invalidate()
      return
    }
    const sceneBuildMs = performance.now() - buildT0

    // 关键：URDF Z-up → THREE Y-up 的坐标系换算 + 落地居中。
    // 不做包裹，box(1,1,1) 会以 [-0.5,0.5]³ 居中在原点（非 Z-up 也"恰好"显示），但
    // 一旦 URDF 用了 origin xyz/rpy 或多 link 关节链路，模型就会以 Z-up 视角散开，
    // 与 THREE 默认 Y-up 视角错位，造成视觉上"看不到模型"。
    const robotGroup = new THREE.Group()
    robotGroup.name = ROBOT_GROUP_NAME
    robotGroup.rotation.x = -Math.PI / 2
    robotGroup.add(graph.root)
    sceneObj.add(robotGroup)
    normalizeRobotGroupToGroundOrigin(robotGroup)
    robotGraphRef.current = graph
    robotRootRef.current = robotGroup

    // 决定本次加载是否要自动 fit：首次必 fit；之后只有当模型尺寸显著变化（切换到
    // 另一个模型/节点）才重新 fit，实时调参（尺寸基本不变）保持用户视角。
    const shouldFitFor = (robot: THREE.Group): boolean => {
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty()) return false
      const size = box.getSize(new THREE.Vector3())
      let doFit = false
      if (!hasFitInitiallyRef.current) {
        doFit = true
      } else {
        const prev = lastFitSizeRef.current
        const maxNow = Math.max(size.x, size.y, size.z)
        const maxPrev = prev ? Math.max(prev.x, prev.y, prev.z) : 0
        const ratio = maxNow / Math.max(1e-3, maxPrev)
        if (ratio < 0.6 || ratio > 1.66) doFit = true
      }
      if (doFit) {
        lastFitSizeRef.current = size
        hasFitInitiallyRef.current = true
      }
      return doFit
    }
    const fitCameraTo = (robot: THREE.Group): void => {
      if (!camera || !controls) return
      const fit = computeFit(camera, robot)
      camera.position.copy(fit.position)
      camera.near = fit.near
      camera.far = fit.far
      camera.updateProjectionMatrix()
      controls.target.copy(fit.target)
      controls.update()
      if (gridGroup && axisGroup) positionGroundHelpers(gridGroup, axisGroup, robot)
    }

    if (options.doubleSided) {
      robotGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach((m) => { m.side = THREE.DoubleSide })
          else if (mat) (mat as THREE.Material).side = THREE.DoubleSide
        }
      })
    }

    // 全部 visual 都是异步 mesh 时，此刻 link group 还是空的（mesh 在下方 async 块里
    // 才 add 进来）。对这种装配体，bbox 此刻为空 → 同步 fit 会把相机停在默认位置且
    // 永不重新 fit，中空模型（房间/建筑外壳）相机会落在内部、单面剔除后什么都看不到。
    // 因此：有待加载 mesh 时，把"首次落地居中 + 自动 fit"推迟到 mesh 加载完成后。
    const willLoadMeshes = graph.pendingMeshVisuals.length > 0 && !!options.baseUrl
    if (camera && controls && !willLoadMeshes) {
      // 纯 primitive（无异步 mesh）：bbox 此刻已完整，按需 fit / 仅刷新裁剪面。
      if (shouldFitFor(robotGroup)) fitCameraTo(robotGroup)
      else updateCameraClipping(camera, robotGroup)
    }
    // （首次 + 有待加载 mesh）：bbox 此刻为空，把 fit 推迟到 async 加载块结束后。
    if (gridGroup && axisGroup) {
      positionGroundHelpers(gridGroup, axisGroup, robotGroup)
    }

    setSpec(parsed)
    setJointNodes(graph.jointNodes)

    // 诊断：robot 进 scene 后，把 bbox / 相机姿态 / scene 子节点都打一份快照，
    // 用来判断"画布显示但模型不可见"是模型尺寸异常还是 fit/camera 跳飞。
    {
      const box = new THREE.Box3().setFromObject(robotGroup)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      console.log('[viewer/useViewer3DScene] robot attached', {
        links: parsed.links.length,
        joints: parsed.joints.length,
        parseMs: +parseMs.toFixed(1),
        sceneBuildMs: +sceneBuildMs.toFixed(1),
        bboxMin: box.min.toArray().map((v) => +v.toFixed(3)),
        bboxMax: box.max.toArray().map((v) => +v.toFixed(3)),
        bboxSize: size.toArray().map((v) => +v.toFixed(3)),
        bboxCenter: center.toArray().map((v) => +v.toFixed(3)),
        cameraPos: camera?.position.toArray().map((v) => +v.toFixed(3)),
        cameraTarget: controls?.target.toArray().map((v) => +v.toFixed(3)),
        cameraNearFar: camera ? [camera.near, camera.far] : null,
        sceneChildren: sceneObj.children.map((c) => c.name || c.type),
      })
    }

    // 统计
    let primitiveCount = 0
    let meshCount = 0
    for (const link of parsed.links) {
      for (const v of link.visuals) {
        if (v.geometry.type === 'mesh') meshCount += 1
        else primitiveCount += 1
      }
    }
    setStats((prev) => ({
      ...prev,
      links: parsed.links.length,
      joints: parsed.joints.length,
      movableJoints: parsed.joints.filter(isPreviewJoint).length,
      primitiveCount,
      meshCount,
      loadedMeshCount: 0,
      failedMeshCount: 0,
    }))

    // 异步加载 mesh 资源（如配置了 baseUrl）
    let cancelled = false
    if (graph.pendingMeshVisuals.length > 0) {
      if (!options.baseUrl) {
        setStats((prev) => ({ ...prev, failedMeshCount: graph.pendingMeshVisuals.length }))
        invalidate()
      } else {
        setLoading(true)
        const baseUrl = options.baseUrl
        const assetRevisionKey = options.assetRevisionKey
        ;(async () => {
          const meshBatchT0 = performance.now()
          const loadTasks = graph.pendingMeshVisuals.map(async (pending) => {
            if (cancelled) return
            const linkSpec = parsed.links.find((l) => l.name === pending.link)
            const visual = linkSpec?.visuals[pending.visualIndex]
            if (!linkSpec || !visual) return
            const meshLoadT0 = performance.now()
            try {
              // 自带内嵌材质的 mesh（GLB/GLTF，如 g_bake_object 的多材质产物）在没有
              // 显式 URDF link material 时，**不要**用默认灰 spec 覆盖——传 undefined 让
              // loadGeometryObject 保留 GLTFLoader 加载到的内嵌每-part 颜色。
              // OBJ 无内嵌材质、仍按旧行为上 spec（缺省灰）；显式 link material 一律覆盖。
              const fn = visual.geometry.filename ?? ''
              const isEmbeddedMatFormat = /\.(glb|gltf)$/i.test(fn)
              const materialSpec = (isEmbeddedMatFormat && !visual.material)
                ? undefined
                : resolveVisualMaterialSpec(visual)
              const group = await loadGeometryObject(visual.geometry, baseUrl, {
                kind: 'visual',
                materialSpec,
                doubleSided: options.doubleSided,
                assetRevisionKey,
              })
              if (cancelled) {
                disposeObject3D(group)
                return
              }
              if (visual.origin) {
                const m = new THREE.Matrix4()
                m.identity()
                const xyz = visual.origin.xyz ?? [0, 0, 0]
                const rpy = visual.origin.rpy ?? [0, 0, 0]
                m.makeRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))
                m.setPosition(xyz[0], xyz[1], xyz[2])
                group.applyMatrix4(m)
              }
              // Tag the async-loaded wrapper with the owning link name too — it's
              // already inherited via the parent `link:<name>` group (pending.parent)
              // for consumers that walk up the ancestor chain (selection-highlight.ts),
              // but tagging it directly here keeps sync (scene-graph-builder.ts) and
              // async mesh sources consistently self-describing for anything that
              // inspects this node without walking further up (e.g. the skinned GLB
              // export's mesh→bone resolution in skinned-mesh-builder.ts).
              group.userData[LINK_USER_DATA_KEY] = linkSpec.name
              pending.parent.add(group)
              setStats((prev) => ({ ...prev, loadedMeshCount: prev.loadedMeshCount + 1 }))
              if (camera) updateCameraClipping(camera, robotRootRef.current ?? group)
              invalidate()
              console.debug('[viewer/useViewer3DScene] mesh loaded', {
                link: linkSpec.name,
                filename: pending.geometryFilename,
                loadMs: +(performance.now() - meshLoadT0).toFixed(1),
              })
            } catch (err) {
              console.warn(`[viewer] mesh load failed for ${linkSpec.name}/${pending.geometryFilename}:`, err)
              setStats((prev) => ({ ...prev, failedMeshCount: prev.failedMeshCount + 1 }))
            }
          })
          await Promise.all(loadTasks)
          if (!cancelled) {
            // mesh 全部就位 → 装配体此刻才有真实 bbox。先落地居中（同步阶段对全-mesh
            // 装配体 bbox 为空、normalize 是 no-op），再按需 fit：不 fit 中空的房间 /
            // 建筑外壳相机会停在默认/旧位置，看起来一片空白。
            const robot = robotRootRef.current
            if (robot) {
              normalizeRobotGroupToGroundOrigin(robot)
              if (shouldFitFor(robot)) fitCameraTo(robot)
              else if (camera) updateCameraClipping(camera, robot)
            }
            invalidate()
            console.debug('[viewer/useViewer3DScene] mesh batch loaded', {
              meshCount: graph.pendingMeshVisuals.length,
              loadMs: +(performance.now() - meshBatchT0).toFixed(1),
            })
            setLoading(false)
          }
        })().catch(() => { if (!cancelled) setLoading(false) })
      }
    }

    invalidate()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, options.source, options.baseUrl, options.assetRevisionKey, options.showCollisions, options.doubleSided])

  // ── Character 分支：RigSpec → SkinnedMesh + Skeleton（权重由 auto-skin 求解）──────
  // 与 URDF effect 并列但互斥（source 与 rigSpec 不同时非空）。构建流程：加载可蒙皮
  // 网格 GLB → buildCharacterSkeleton → buildCharacterSkinnedMeshes（求权重）→ 挂
  // 八面体骨形（buildBoneShapes）→ 套 Y-up 外层旋转 + 落地 → 首帧 fit 相机；clip 交给下方播放 effect。
  useEffect(() => {
    if (!sceneReady || !sceneObj3d) return
    const sceneObj = sceneObj3d

    const cleanupCharacter = (): void => {
      if (characterRootRef.current) {
        sceneObj.remove(characterRootRef.current)
        disposeObject3D(characterRootRef.current)
        characterRootRef.current = null
      }
      characterSkeletonRef.current?.skeleton.dispose()
      characterSkeletonRef.current = null
      characterClipsRef.current = []
    }

    cleanupCharacter()

    if (!rigSpec) {
      invalidate()
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const baseUrl = rigBaseUrl || RIG_ASSET_BASE_URL
        // 复用 URDF mesh 加载器：把 rigSpec.meshFilename 当作一个 mesh 几何来加载（含
        // 模板缓存 + flatShading 呈现），返回一个持有 GLB 场景的 Group（模型根帧）。
        const loaded = await loadGeometryObject(
          { type: 'mesh', filename: rigSpec.meshFilename, scale: [1, 1, 1] },
          baseUrl,
          { kind: 'visual', doubleSided: options.doubleSided },
        )
        if (cancelled) { disposeObject3D(loaded); return }

        const charSkeleton = buildCharacterSkeleton(rigSpec)
        const skinParams: AutoSkinParams = {
          method: rigSpec.skin.method,
          maxInfluences: rigSpec.skin.maxInfluences,
          falloff: rigSpec.skin.falloff,
          resolution: rigSpec.skin.resolution,
        }
        const cacheKeyBase = `${rigSpec.meshFilename}|${JSON.stringify(rigSpec.bones)}|${skinParams.method}:${skinParams.maxInfluences}:${skinParams.falloff}:${skinParams.resolution}`
        const skinnedMeshes = buildCharacterSkinnedMeshes(loaded, charSkeleton, skinParams, cacheKeyBase)
        // 加载模板 clone 出来的中间 Group 只用于烘几何，权重烘完即释放。
        disposeObject3D(loaded)

        if (cancelled) {
          for (const m of skinnedMeshes) m.geometry.dispose()
          charSkeleton.skeleton.dispose()
          return
        }

        // 与 URDF 一致：Z-up → Y-up 外层旋转 + 落地居中，只套一次（不烘进骨/几何）。
        const group = new THREE.Group()
        group.name = CHARACTER_GROUP_NAME
        group.rotation.x = -Math.PI / 2
        group.add(charSkeleton.rootBone)
        for (const m of skinnedMeshes) group.add(m)
        // 可视骨形（Blender 风八面体骨 + 关节球）作为各 bone 的子节点挂上，天然随动画摆动；
        // 资源随 group 子树被 disposeObject3D 统一释放。取代旧的 SkeletonHelper 关节连线呈现。
        buildBoneShapes(charSkeleton)

        sceneObj.add(group)
        normalizeRobotGroupToGroundOrigin(group)

        characterRootRef.current = group
        characterSkeletonRef.current = charSkeleton
        characterClipsRef.current = buildCharacterAnimationClips(rigSpec, charSkeleton.boneByName)

        // 首帧 fit 相机到角色。
        if (camera && controls) {
          const fit = computeFit(camera, group)
          camera.position.copy(fit.position)
          camera.near = fit.near
          camera.far = fit.far
          camera.updateProjectionMatrix()
          controls.target.copy(fit.target)
          controls.update()
          if (gridGroup && axisGroup) positionGroundHelpers(gridGroup, axisGroup, group)
        }

        setError(null)
        setStats((prev) => ({ ...prev, links: rigSpec.bones.length, joints: rigSpec.bones.length, movableJoints: 0 }))
        setCharacterReady((v) => v + 1)
        setLoading(false)
        invalidate()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[viewer/useViewer3DScene] character build failed', { msg })
        setError(`Character build failed: ${msg}`)
        setLoading(false)
        invalidate()
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, rigSpec, rigBaseUrl, options.doubleSided])

  // ── Static 分支：SceneSpec → 一组已置位/上色的网格（scene-builder）────────────
  // 与 URDF / 角色 effect 并列但互斥（source / rigSpec / sceneSpec 不同时非空）。
  // 流程：buildStaticScene 逐条加载网格 → 套 Y-up 外层旋转 + 落地居中 → 首帧 fit 相机。
  // 导出走 exportStaticGlbBlob（几何 + 材质合并为单个多材质 GLB）。
  useEffect(() => {
    if (!sceneReady || !sceneObj3d) return
    const sceneObj = sceneObj3d

    const cleanupScene = (): void => {
      if (sceneRootRef.current) {
        sceneObj.remove(sceneRootRef.current)
        disposeObject3D(sceneRootRef.current)
        sceneRootRef.current = null
      }
    }

    cleanupScene()

    if (!sceneSpec) {
      invalidate()
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const baseUrl = sceneBaseUrl || RIG_ASSET_BASE_URL
        const content = await buildStaticScene(sceneSpec, baseUrl, {
          doubleSided: options.doubleSided,
          assetRevisionKey: options.assetRevisionKey,
        })
        if (cancelled) { disposeObject3D(content); return }

        // 与 URDF / 角色一致：Z-up → Y-up 外层旋转 + 落地居中，只套一次。
        const group = new THREE.Group()
        group.name = SCENE_GROUP_NAME
        group.rotation.x = -Math.PI / 2
        group.add(content)
        sceneObj.add(group)
        normalizeRobotGroupToGroundOrigin(group)
        sceneRootRef.current = group

        // 首帧 fit 相机到场景。
        if (camera && controls) {
          const fit = computeFit(camera, group)
          camera.position.copy(fit.position)
          camera.near = fit.near
          camera.far = fit.far
          camera.updateProjectionMatrix()
          controls.target.copy(fit.target)
          controls.update()
          if (gridGroup && axisGroup) positionGroundHelpers(gridGroup, axisGroup, group)
        }

        setError(null)
        setStats((prev) => ({
          ...prev,
          links: sceneSpec.itemCount,
          joints: 0,
          movableJoints: 0,
          primitiveCount: 0,
          meshCount: sceneSpec.itemCount,
          loadedMeshCount: sceneSpec.itemCount,
          failedMeshCount: 0,
        }))
        setLoading(false)
        invalidate()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[viewer/useViewer3DScene] static scene build failed', { msg })
        setError(`Static scene build failed: ${msg}`)
        setLoading(false)
        invalidate()
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, sceneSpec, sceneBaseUrl, options.doubleSided, options.assetRevisionKey])

  useEffect(() => {
    if (gridGroup) gridGroup.visible = options.showGrid
    if (axisGroup) axisGroup.visible = options.showAxis
    invalidate()
  }, [gridGroup, axisGroup, invalidate, options.showGrid, options.showAxis])

  // 用户拖动 / 缩放后动态重算 near/far：初始 fit 算出的近裁剪面只适用于初始相机位置，
  // 相机一旦靠近模型，固定的 near 就会从前侧切进几何体（典型表现：盒子下半边被斜切成尖角）。
  // 关键修复：以前只在 'end' 上重算，于是从远处连续拉近（滚轮 zoom）时，整个手势期间 near
  // 一直停留在"远视角"算出的大值，把已经贴近的模型整片切掉 → 放大出现黑边甚至黑屏，松手才恢复。
  // 现在缓存一次场景包围球（几何静态），在每帧 'change' 上用相机当前距离廉价地重算 near/far，
  // 'end' 与异步 mesh 加载完成（loading 变化）时再重建包围球。
  //
  // 三管线通用：以前这段只对 URDF 路（robotRootRef + spec）生效，角色 / 静态场景路
  // （characterRootRef / sceneRootRef，spec 恒为 null）完全没挂 'change' 监听，于是角色骨骼
  // 预览一旦 orbit / zoom 靠近，near 停在首帧 fit 的大值，模型被整片裁掉 → "有时候裁出一片
  // 黑色区域"。现在按活跃 root 取包围球，三条路都实时修正裁剪面。characterReady / sceneSpec
  // 进依赖，确保角色 / 场景构建完成后重新挂监听。
  useEffect(() => {
    if (!camera || !controls) return
    const activeRoot = characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current
    if (!activeRoot) return
    const targets: THREE.Object3D[] = [activeRoot]
    if (gridGroup) targets.push(gridGroup)
    if (axisGroup) targets.push(axisGroup)

    let sphere = computeSceneSphere(targets)
    // 重建包围球（几何/网格可能刚变化），随后立即按当前相机修正裁剪面。
    const rebuild = () => {
      sphere = computeSceneSphere(targets) ?? sphere
      if (sphere) applyClippingForSphere(camera, sphere)
      invalidate()
    }
    // 相机每次移动（orbit / zoom）都跑：仅用缓存包围球做廉价 near/far 修正，保证当前帧不被错误裁剪。
    const onChange = () => {
      if (sphere) applyClippingForSphere(camera, sphere)
    }

    rebuild()
    controls.addEventListener('change', onChange)
    controls.addEventListener('end', rebuild)
    return () => {
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('end', rebuild)
    }
  }, [camera, controls, gridGroup, axisGroup, invalidate, spec, characterReady, sceneSpec, loading])

  // 建筑剖切：把一个世界空间水平裁剪面挂到活跃 root 的所有 mesh 材质上，切掉顶部以看进
  // 中空建筑（房间 / 多层楼）。依赖 loading 以便 mesh 异步加载完后对新材质重新应用；
  // 依赖 spec 以便换模型后重算高度。开启时同时强制双面，避免剖切口看到背面镂空。
  //
  // 修复：以前只取 robotRootRef（URDF 路），静态建筑 / 角色路（sceneRootRef /
  // characterRootRef，spec 恒为 null）完全没挂裁剪面 → 剖切开关 / 滑块在最常见的无关节
  // 建筑预览上完全不生效。现按与相机 near/far 效果一致的优先级取活跃 root，并把
  // sceneSpec / characterReady 加入依赖，确保静态场景 / 角色构建完成后重新应用。
  useEffect(() => {
    const root = characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current
    if (!root) return
    const enabled = options.sectionView
    const plane = sectionPlaneRef.current

    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      const minY = box.min.y
      const height = Math.max(1e-3, box.max.y - minY)
      const frac = Math.min(1, Math.max(0, options.sectionHeight))
      // frac=1 时把裁剪面抬到模型顶部之上一点，确保"完整"状态不误切。
      plane.constant = frac >= 1 ? box.max.y + height : minY + frac * height
    }

    const wantDoubleSide = enabled || options.doubleSided
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of mats) {
        if (!m) continue
        const mat = m as THREE.Material
        mat.clippingPlanes = enabled ? [plane] : null
        mat.clipShadows = enabled
        mat.side = wantDoubleSide ? THREE.DoubleSide : THREE.FrontSide
        mat.needsUpdate = true
      }
    })
    invalidate()
  }, [spec, sceneSpec, characterReady, loading, options.sectionView, options.sectionHeight, options.doubleSided, invalidate])

  // 线框模式：实时切换活跃 root 上所有材质的 wireframe，不重建几何/mesh（与 doubleSided
  // 不同——doubleSided 改变 material.side 需要在 mesh 加载时就应用，这里只是切一个纯视觉
  // 标志位，跟建筑剖切一样按当前活跃 root 做一次材质遍历即可）。
  useEffect(() => {
    const root = characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current
    if (!root) return
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of mats) {
        if (!m) continue
        const mat = m as THREE.Material & { wireframe?: boolean }
        if ('wireframe' in mat) {
          mat.wireframe = options.wireframe
          mat.needsUpdate = true
        }
      }
    })
    invalidate()
  }, [spec, sceneSpec, characterReady, loading, options.wireframe, invalidate])

  // 关节控制器
  const { jointValues, setJointValue, applyJointValues, resetAll } = useJointController(jointNodes, spec)
  const jointValuesRef = useRef<Map<string, number>>(new Map())
  useEffect(() => { jointValuesRef.current = jointValues }, [jointValues])

  // 作者关节轨迹 q(t)（来自 g_bake_animation → useViewer3DLiveSync）。存在时实时预览
  // 直接播它，否则回退到程序化预览运动 —— 与 GLB 导出的 clip 选择逻辑保持一致。
  const authoredAnimation = useViewerStore((s) => s.authoredAnimation)

  const [previewJointValues, setPreviewJointValues] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!spec || !options.autoAnimate) {
      setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
      applyJointValues(jointValuesRef.current)
      invalidate()
      return
    }

    // 作者 clip 至少要有一条落在本 URDF 可动关节上的 channel 才驱动预览，
    // 否则（空 clip / 关节名对不上）回退到程序化运动。
    const movableJointNames = new Set(spec.joints.filter(isPreviewJoint).map((j) => j.name))
    const authoredDrivesPreview =
      authoredAnimation != null &&
      Number.isFinite(authoredAnimation.frameCount) &&
      authoredAnimation.frameCount >= 2 &&
      Object.entries(authoredAnimation.channels).some(
        ([name, series]) => series.length > 0 && movableJointNames.has(name),
      )

    let frameId = 0
    let lastUiSync = 0

    if (authoredDrivesPreview) {
      const clip = authoredAnimation!
      const startNow = performance.now()
      const tick = (now: number) => {
        const t = (now - startNow) / 1000
        const nextValues = computeAuthoredJointValuesAtTime(spec, clip, t)
        if (now - lastUiSync >= PREVIEW_UI_SYNC_MS) {
          lastUiSync = now
          startTransition(() => setPreviewJointValues(new Map(nextValues)))
        }
        applyJointValues(nextValues)
        invalidate()
        frameId = requestAnimationFrame(tick)
      }
      frameId = requestAnimationFrame(tick)
    } else {
      const motions: PreviewJointMotion[] = buildPreviewMotions(spec)
      if (motions.length === 0) {
        setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
        return
      }
      const tick = (now: number) => {
        const t = now / 1000
        const nextValues = new Map<string, number>()
        for (const m of motions) {
          const phase = THREE.MathUtils.euclideanModulo((t / m.cycleSeconds) + m.phaseOffset, 1)
          nextValues.set(m.joint.name, previewJointValue(m.joint, phase))
        }
        if (now - lastUiSync >= PREVIEW_UI_SYNC_MS) {
          lastUiSync = now
          startTransition(() => setPreviewJointValues(new Map(nextValues)))
        }
        applyJointValues(nextValues)
        invalidate()
        frameId = requestAnimationFrame(tick)
      }
      frameId = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(frameId)
      setPreviewJointValues((prev) => (prev.size === 0 ? prev : new Map()))
      applyJointValues(jointValuesRef.current)
      invalidate()
    }
  }, [spec, options.autoAnimate, authoredAnimation, applyJointValues, invalidate])

  // 角色骨骼动画播放：遵守 RigClip.loop；非循环动作只播一次并保持末帧。
  // 停止/切换时恢复完整 bind 旋转，并把根骨位置恢复到 bind position，避免根运动残留。
  useEffect(() => {
    const root = characterRootRef.current
    const clips = characterClipsRef.current
    const skel = characterSkeletonRef.current
    if (!root || clips.length === 0) return
    if (!options.autoAnimate) return

    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clips[0])
    const shouldLoop = rigSpec?.clips[0]?.loop === true
    if (shouldLoop) {
      action.setLoop(THREE.LoopRepeat, Infinity)
    } else {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    action.play()

    let frameId = 0
    let last = performance.now()
    const tick = (now: number) => {
      mixer.update((now - last) / 1000)
      last = now
      invalidate()
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
      mixer.stopAllAction()
      if (skel) {
        for (const bone of skel.bones) bone.quaternion.identity()
        skel.rootBone.position.copy(skel.rootBindPosition)
      }
      root.updateMatrixWorld(true)
      mixer.uncacheRoot(root)
      invalidate()
    }
    // characterReady 变化表示重建了角色（新 root/clips），需重挂 mixer。
  }, [options.autoAnimate, characterReady, invalidate, rigSpec])

  const wrappedSetJointValue = useCallback((name: string, value: number) => {
    setJointValue(name, value)
    invalidate()
  }, [setJointValue, invalidate])

  const wrappedResetAll = useCallback(() => {
    resetAll()
    invalidate()
  }, [resetAll, invalidate])

  const resetCamera = useCallback(() => {
    const robot = characterRootRef.current ?? sceneRootRef.current ?? robotRootRef.current
    if (!camera || !controls || !robot) return
    const fit = computeFit(camera, robot)
    camera.position.copy(fit.position)
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    controls.target.copy(fit.target)
    controls.update()
    if (gridGroup && axisGroup) {
      positionGroundHelpers(gridGroup, axisGroup, robot)
    }
    invalidate()
  }, [camera, controls, gridGroup, axisGroup, invalidate])

  const result = useMemo<UseViewer3DSceneResult>(() => ({
    spec,
    error,
    jointValues,
    previewJointValues,
    setJointValue: wrappedSetJointValue,
    resetAllJoints: wrappedResetAll,
    resetCamera,
    getExportObject,
    getCharacterExport,
    getFrameCanvas,
    renderFrame,
    captureContactSheet,
    invalidate,
    stats,
    loading,
  }), [spec, error, jointValues, previewJointValues, wrappedSetJointValue, wrappedResetAll, resetCamera, getExportObject, getCharacterExport, getFrameCanvas, renderFrame, captureContactSheet, invalidate, stats, loading])

  return result
}
