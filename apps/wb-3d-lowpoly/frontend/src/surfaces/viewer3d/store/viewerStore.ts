// 💡 3D Viewer 全局状态：URDF/角色源 / 渲染开关 / 灯光与背景 / 面板开关 / 状态消息 / 语言模式
import { create } from 'zustand'
import type { AuthoredJointAnimationClip } from '../three/urdf-joint-motion'
import type { RigSpec } from '../three/rig-spec'
import type { SceneSpec } from '../three/scene-spec'
import { theme } from '../../../theme'

export type LangMode = 'zh' | 'en'

/**
 * 预览器模式（三管线一一对应）：
 * - 'static'：纯静态物体 / 场景（无关节、无骨架）——由 `sceneSpec` 驱动（null=空视口）；
 * - 'articulated'：普通关节 / 机械 / 建筑（URDF 关节链）——由 `source` 驱动；
 * - 'character'：角色 / 生物软体（骨架 + 平滑蒙皮）——由 `rigSpec` 驱动。
 * 三条源互斥：同一时刻只有一条非空（set* 动作会清空另外两条）。
 */
export type ViewerMode = 'static' | 'articulated' | 'character'

/**
 * 跨端口 localStorage 不共享（9555 ≠ 9558），独立窗口直接打开 9558 时需要本地兜底默认值。
 * editor 切语言时会通过 WS editor:lang_mode 事件同步过来；viewer 还会把最新值写回
 * 自己的 localStorage，下次刷新 9558 时使用上次的语言而不是回退到 zh。
 */
function loadLangMode(): LangMode {
  try {
    const v = localStorage.getItem('langMode')
    return v === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export interface RenderOptions {
  showGrid: boolean
  showAxis: boolean
  showCollisions: boolean
  autoAnimate: boolean
  doubleSided: boolean
  /** 建筑剖切：用一个水平裁剪面切掉顶部，俯视看进房间 / 各楼层（专为中空建筑设计）。 */
  sectionView: boolean
  /** 线框模式：所有可见 mesh 的材质切到 wireframe（materials.ts 早就支持这个参数，只是
   * 没接到界面上）。 */
  wireframe: boolean
}

/** 灯光预设名。每个预设是 {光照强度倍率, 背景色} 的组合，一键切换整体氛围。 */
export type LightingPresetId = 'studio' | 'bright' | 'night'

export interface LightingOptions {
  /** 应用在 createLightingRig 各灯光基础强度上的倍率（0.4~1.8），1 = 默认强度。 */
  intensity: number
  /** three.js scene.background 十六进制颜色字符串，同时镜像进 CSS 变量 --viewport-bg。 */
  backgroundColor: string
  /** 当前激活的预设；手动拖滑块/改背景色后置为 null（自定义，不再高亮任何预设按钮）。 */
  preset: LightingPresetId | null
}

export const LIGHTING_PRESETS: Record<LightingPresetId, { intensity: number; backgroundColor: string }> = {
  studio: { intensity: 1, backgroundColor: theme.colors.viewportBackground },
  bright: { intensity: 1.35, backgroundColor: '#e7ecf1' },
  night: { intensity: 0.55, backgroundColor: '#05070a' },
}

export interface ViewerStoreState {
  /** URDF XML 文本（空字符串表示尚未加载）。 */
  source: string
  /** 用于解析 URDF 中 mesh filename 的 base URL（相对路径起点）；空字符串则不加载 mesh 资源。 */
  baseUrl: string
  /** 可选：用于 mesh 资源 cache busting 的版本号（如时间戳）。 */
  assetRevisionKey: string | null
  /** 标识当前模型的标签（文件名 / 自定义来源），仅用于状态栏展示。 */
  sourceLabel: string

  setSource: (source: string, opts?: { baseUrl?: string; sourceLabel?: string; assetRevisionKey?: string | null }) => void
  clearSource: () => void

  /** 当前预览模式（由 live-sync 依据命中 rig_preview / urdf_preview / 静态 GLB 决定）。 */
  mode: ViewerMode
  /**
   * 角色 IR（来自 rig_preview 的 rigSpec 输出）；mode='character' 时非空。
   * 前端据此加载可蒙皮网格 + 求权重 + 构建 SkinnedMesh/Skeleton。
   */
  rigSpec: RigSpec | null
  /** 加载 rigSpec.meshFilename 的 base URL（内容寻址 blob 路由）。 */
  rigBaseUrl: string
  /** 切到角色模式：注入 rigSpec（同时清空 URDF source / sceneSpec，避免多条链同时渲染）。 */
  setRig: (rigSpec: RigSpec, opts?: { baseUrl?: string; sourceLabel?: string }) => void

  /**
   * 静态 IR（来自 scene_preview 的 sceneSpec 输出）；mode='static' 且非空时渲染静态场景。
   * 前端据此逐条加载网格（<sha>.obj/.glb）、套 origin/rpy/scale + 材质，组合成静态场景；
   * 导出合并为单个多材质 .glb。null = 空视口（静态模式但无内容）。
   */
  sceneSpec: SceneSpec | null
  /** 加载 sceneSpec 各 item 网格的 base URL（内容寻址 blob 路由）。 */
  sceneBaseUrl: string
  /** 切到静态模式：注入 sceneSpec（同时清空 URDF source / rigSpec）。 */
  setScene: (sceneSpec: SceneSpec, opts?: { baseUrl?: string; sourceLabel?: string }) => void

  /**
   * 作者关节动画 clip（来自 g_bake_animation 的 `animation` 端口）。存在时 GLB 导出
   * 烘它而不是程序化预览；null = 无作者动画，回退到预览轨迹。
   */
  authoredAnimation: AuthoredJointAnimationClip | null
  setAuthoredAnimation: (clip: AuthoredJointAnimationClip | null) => void

  render: RenderOptions
  toggleRenderOption: (key: keyof RenderOptions) => void
  setRenderOption: <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) => void

  /** 剖切高度（0..1，模型高度的比例）：1=完整不切，越小切掉越多顶部。 */
  sectionHeight: number
  setSectionHeight: (value: number) => void

  /** 灯光强度 / 背景色（可调，见 Titlebar 设置面板的 Lighting 分组）。 */
  lighting: LightingOptions
  setLightIntensity: (value: number) => void
  setBackgroundColor: (hex: string) => void
  applyLightingPreset: (preset: LightingPresetId) => void

  sidePanelOpen: boolean
  toggleSidePanel: () => void
  setSidePanelOpen: (open: boolean) => void

  errorMessage: string | null
  setErrorMessage: (msg: string | null) => void

  /** 语言模式（由 editor 通过 WS editor:lang_mode 同步），zh=中文 / en=英文 */
  langMode: LangMode
  setLangMode: (mode: LangMode) => void
}

export const useViewerStore = create<ViewerStoreState>((set) => ({
  source: '',
  baseUrl: '',
  assetRevisionKey: null,
  sourceLabel: '',

  mode: 'static',
  rigSpec: null,
  rigBaseUrl: '',
  sceneSpec: null,
  sceneBaseUrl: '',

  setSource: (source, opts) =>
    set({
      source,
      baseUrl: opts?.baseUrl ?? '',
      sourceLabel: opts?.sourceLabel ?? '',
      assetRevisionKey: opts?.assetRevisionKey ?? null,
      // URDF 源到来 → articulated（空源 = static 空视口）；同时退出角色 / 静态场景。
      mode: source.trim() ? 'articulated' : 'static',
      rigSpec: null,
      rigBaseUrl: '',
      sceneSpec: null,
      sceneBaseUrl: '',
      errorMessage: null,
    }),
  clearSource: () =>
    set({
      source: '', baseUrl: '', sourceLabel: '', assetRevisionKey: null,
      mode: 'static', rigSpec: null, rigBaseUrl: '',
      sceneSpec: null, sceneBaseUrl: '', errorMessage: null,
    }),

  setRig: (rigSpec, opts) =>
    set({
      // 角色模式独占：清空 URDF 源 + 静态场景，只渲染骨架蒙皮。
      source: '', baseUrl: '', assetRevisionKey: null,
      mode: 'character',
      rigSpec,
      rigBaseUrl: opts?.baseUrl ?? '',
      sceneSpec: null,
      sceneBaseUrl: '',
      sourceLabel: opts?.sourceLabel ?? '',
      errorMessage: null,
    }),

  setScene: (sceneSpec, opts) =>
    set({
      // 静态模式独占：清空 URDF 源 + 角色 rig，只渲染静态场景。
      source: '', baseUrl: '', assetRevisionKey: null,
      mode: 'static',
      rigSpec: null,
      rigBaseUrl: '',
      sceneSpec,
      sceneBaseUrl: opts?.baseUrl ?? '',
      sourceLabel: opts?.sourceLabel ?? '',
      errorMessage: null,
    }),

  authoredAnimation: null,
  setAuthoredAnimation: (clip) => set({ authoredAnimation: clip }),

  render: {
    showGrid: true,
    showAxis: true,
    showCollisions: false,
    autoAnimate: false,
    doubleSided: false,
    sectionView: false,
    wireframe: false,
  },
  toggleRenderOption: (key) =>
    set((state) => ({ render: { ...state.render, [key]: !state.render[key] } })),
  setRenderOption: (key, value) =>
    set((state) => ({ render: { ...state.render, [key]: value } })),

  sectionHeight: 0.55,
  setSectionHeight: (value) => set({ sectionHeight: Math.min(1, Math.max(0, value)) }),

  lighting: { ...LIGHTING_PRESETS.studio, preset: 'studio' },
  setLightIntensity: (value) =>
    set((state) => ({ lighting: { ...state.lighting, intensity: Math.min(1.8, Math.max(0.4, value)), preset: null } })),
  setBackgroundColor: (hex) =>
    set((state) => ({ lighting: { ...state.lighting, backgroundColor: hex, preset: null } })),
  applyLightingPreset: (preset) =>
    set({ lighting: { ...LIGHTING_PRESETS[preset], preset } }),

  sidePanelOpen: true,
  toggleSidePanel: () => set((state) => ({ sidePanelOpen: !state.sidePanelOpen })),
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),

  errorMessage: null,
  setErrorMessage: (msg) => set({ errorMessage: msg }),

  langMode: loadLangMode(),
  setLangMode: (mode) => {
    try { localStorage.setItem('langMode', mode) } catch { /* ignore */ }
    set({ langMode: mode })
  },
}))
