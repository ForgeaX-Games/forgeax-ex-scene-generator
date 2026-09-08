// 💡 URDF Viewer 双语文案表：editor 通过 WS editor:lang_mode 同步 langMode 到本端口；
//    若 viewer 作为独立窗口（直接打开 :9558）则默认 zh、可后续自行切换。
//
//    使用方式：
//      const t = useViewerI18n()      // hook，自动随 langMode 变化重渲染
//      t.titlebar.open                 // 字符串
//      t.fmt.linksCount(3)             // 函数（带格式化）

import { useViewerStore } from '../store/viewerStore'

export interface ViewerI18nStrings {
  titlebar: {
    productName: string
    open: string
    openTooltip: string
    paste: string
    pasteTooltip: string
    export: string
    exportTooltip: string
    exportHeader: string
    directImportHeader: string
    directImportToggle: string
    directImportToggleSub: string
    directImportAction: string
    directImportActionSub: string
    directImportTitle: string
    directImportDescription: string
    directImportDirectoryLabel: string
    directImportDirectoryHint: string
    directImportFilenameLabel: string
    directImportFilenameHint: string
    directImportSubmit: string
    directImportWorking: string
    directImportSuccess: string
    directImportRetry: string
    directImportClose: string
    exportObj: string
    exportObjSub: string
    exportGlb: string
    exportGlbSub: string
    exportGlbStatic: string
    exportGlbStaticSub: string
    exportGlbSkinned: string
    exportGlbSkinnedSub: string
    exportGlbCharacter: string
    exportGlbCharacterSub: string
    exportUrdf: string
    exportUrdfSub: string
    pasteOverlayTitle: string
    pastePlaceholder: string
    cancel: string
    load: string
    clearModelTooltip: string
    toggleGrid: string
    toggleAxis: string
    playAnimation: string
    stopAnimation: string
    screenshot: string
    moreOptions: string
    viewOptions: string
    showCollision: string
    renderBothSides: string
    wireframe: string
    sectionView: string
    sectionViewHint: string
    sectionHeightLabel: string
    lightingHeader: string
    lightingPreset: { studio: string; bright: string; night: string }
    lightIntensityLabel: string
    backgroundColorLabel: string
    resetCamera: string
    resetCameraSub: string
    showJointPanel: string
    hideJointPanel: string
    fullscreenStandaloneNote: string
    enterFullscreen: string
    exitFullscreen: string
  }
  sidePanel: {
    modelInfo: string
    robot: string
    links: string
    joints: string
    visuals: string
    movableSuffix: string
    fixedSuffix: string
    mimicSuffix: string
    primitive: string
    meshLoaded: string
    meshFailed: string
    noModelLoaded: string
    jointsHeader: string
    animatingTag: string
    resetAllJoints: string
    noMovableJoints: string
    noLimit: string
    rangeArrow: string
    typeLabel: string
    modeArticulated: string
    modeStatic: string
    modeCharacter: string
    items: string
    meshes: string
    bones: string
    skinMethod: string
    clips: string
  }
  canvas: {
    emptyTitle: string
    emptySubPrefix: string
    emptySubMid1: string
    emptySubSuffix: string
    loadingMesh: string
  }
}

const ZH: ViewerI18nStrings = {
  titlebar: {
    productName: '3D 预览器',
    open: '打开',
    openTooltip: '打开本地 URDF 文件',
    paste: '粘贴',
    pasteTooltip: '粘贴 URDF XML 文本',
    export: '导出',
    exportTooltip: '导出当前模型',
    exportHeader: '导出格式',
    directImportHeader: '导入到引擎',
    directImportToggle: '直接导入到引擎',
    directImportToggleSub: '开启后只保留 GLB 导入操作',
    directImportAction: '选择目录并导入 GLB',
    directImportActionSub: '生成文件后自动交给 Editor 导入并烘焙',
    directImportTitle: '导入 GLB 到引擎',
    directImportDescription: '选择项目内的目标目录。生成 GLB 后会自动走 Editor 的统一导入链路。',
    directImportDirectoryLabel: '项目相对目录',
    directImportDirectoryHint: '例如 assets/3d；不能使用绝对路径或 ..',
    directImportFilenameLabel: '文件名',
    directImportFilenameHint: '只支持 .glb，扩展名可省略',
    directImportSubmit: '生成并导入',
    directImportWorking: '正在生成 GLB 并导入 Editor…',
    directImportSuccess: '已导入项目，Content Browser 将在刷新后显示它。',
    directImportRetry: '重试',
    directImportClose: '完成',
    exportObj: 'OBJ',
    exportObjSub: '保存当前视图中的物体为 Wavefront OBJ',
    exportGlb: 'GLB（带动画）',
    exportGlbSub: '保存当前物体为 GLB，含关节预览动画（与自动动画一致）',
    exportGlbStatic: 'GLB（静态）',
    exportGlbStaticSub: '保存当前物体为 GLB，仅几何 + 材质，不含任何动画轨道',
    exportGlbSkinned: 'GLB（骨骼蒙皮）',
    exportGlbSkinnedSub: '保存为带标准骨骼/蒙皮的 GLB，每个连杆刚性绑定到对应关节骨骼',
    exportGlbCharacter: 'GLB（角色蒙皮）',
    exportGlbCharacterSub: '保存角色为带骨架 + 平滑蒙皮（前端体素权重）的 GLB，含骨骼动画',
    exportUrdf: 'URDF',
    exportUrdfSub: '保存当前 URDF XML 源文件',
    pasteOverlayTitle: '粘贴 URDF XML',
    pastePlaceholder: "<?xml version='1.0'?>\n<robot name='...'>\n  ...\n</robot>",
    cancel: '取消',
    load: '加载',
    clearModelTooltip: '清除当前模型',
    toggleGrid: '网格地面',
    toggleAxis: '坐标系',
    playAnimation: '开始预览动画',
    stopAnimation: '停止预览动画',
    screenshot: '保存截图',
    moreOptions: '更多设置',
    viewOptions: '视图选项',
    showCollision: '显示碰撞几何',
    renderBothSides: '双面渲染（DoubleSide）',
    wireframe: '线框模式',
    sectionView: '建筑剖切（切掉顶部看内部）',
    sectionViewHint: '用水平面切掉模型顶部，俯视看进房间 / 各楼层',
    sectionHeightLabel: '剖切高度',
    lightingHeader: '光照 / 背景',
    lightingPreset: { studio: '影棚', bright: '明亮', night: '暗夜' },
    lightIntensityLabel: '灯光强度',
    backgroundColorLabel: '背景色',
    resetCamera: '重置相机',
    resetCameraSub: '让相机重新适配当前模型',
    showJointPanel: '显示关节面板',
    hideJointPanel: '隐藏关节面板',
    fullscreenStandaloneNote: '全屏仅在嵌入到编辑器时可用',
    enterFullscreen: '让 Viewer 占据整个工作台',
    exitFullscreen: '退出全屏',
  },
  sidePanel: {
    modelInfo: '模型信息',
    robot: '名称',
    links: '连杆',
    joints: '关节',
    visuals: '可视元素',
    movableSuffix: '可动',
    fixedSuffix: '固定',
    mimicSuffix: '联动',
    primitive: '基础形状',
    meshLoaded: 'mesh 已加载',
    meshFailed: '加载失败',
    noModelLoaded: '尚未加载模型。',
    jointsHeader: '关节',
    animatingTag: '预览动画中',
    resetAllJoints: '重置所有关节',
    noMovableJoints: '该模型没有可动关节。',
    noLimit: '(无限位)',
    rangeArrow: '→',
    typeLabel: '类型',
    modeArticulated: '关节模型',
    modeStatic: '静态场景',
    modeCharacter: '角色',
    items: '物体',
    meshes: '网格',
    bones: '骨骼',
    skinMethod: '蒙皮',
    clips: '动画',
  },
  canvas: {
    emptyTitle: '尚未加载模型',
    emptySubPrefix: '在节点画布运行 ',
    emptySubMid1: '管线',
    emptySubSuffix: '，模型会自动出现在这里。',
    loadingMesh: '正在加载 mesh 资源…',
  },
}

const EN: ViewerI18nStrings = {
  titlebar: {
    productName: '3D Viewer',
    open: 'Open',
    openTooltip: 'Open URDF file',
    paste: 'Paste',
    pasteTooltip: 'Paste URDF XML text',
    export: 'Export',
    exportTooltip: 'Export current model',
    exportHeader: 'Export format',
    directImportHeader: 'Import to Engine',
    directImportToggle: 'Import directly to Engine',
    directImportToggleSub: 'When enabled, only the GLB import action is shown',
    directImportAction: 'Choose a folder and import GLB',
    directImportActionSub: 'Generate the file, then send it through the Editor import pipeline',
    directImportTitle: 'Import GLB to Engine',
    directImportDescription: 'Choose a project-relative destination. The generated GLB will use the Editor import pipeline automatically.',
    directImportDirectoryLabel: 'Project-relative directory',
    directImportDirectoryHint: 'For example assets/3d; absolute paths and .. are not allowed',
    directImportFilenameLabel: 'File name',
    directImportFilenameHint: 'GLB only; the extension may be omitted',
    directImportSubmit: 'Generate and import',
    directImportWorking: 'Generating the GLB and importing it into the Editor…',
    directImportSuccess: 'Imported into the project. Content Browser will show it after refresh.',
    directImportRetry: 'Retry',
    directImportClose: 'Done',
    exportObj: 'OBJ',
    exportObjSub: 'Save the visible object as Wavefront OBJ',
    exportGlb: 'GLB (animated)',
    exportGlbSub: 'Save as GLB with joint preview animation (same as auto-animate)',
    exportGlbStatic: 'GLB (static)',
    exportGlbStaticSub: 'Save as GLB with geometry + materials only, no animation tracks',
    exportGlbSkinned: 'GLB (skinned)',
    exportGlbSkinnedSub: 'Save as GLB with standard bones/skinning, each link rigidly bound to its joint bone',
    exportGlbCharacter: 'GLB (character)',
    exportGlbCharacterSub: 'Save the character as a GLB with a skeleton + smooth skinning (frontend voxel weights), incl. bone animation',
    exportUrdf: 'URDF',
    exportUrdfSub: 'Save the current URDF XML source',
    pasteOverlayTitle: 'Paste URDF XML',
    pastePlaceholder: "<?xml version='1.0'?>\n<robot name='...'>\n  ...\n</robot>",
    cancel: 'Cancel',
    load: 'Load',
    clearModelTooltip: 'Clear model',
    toggleGrid: 'Toggle grid',
    toggleAxis: 'Toggle axis helper',
    playAnimation: 'Play animation',
    stopAnimation: 'Stop animation',
    screenshot: 'Save screenshot',
    moreOptions: 'More options',
    viewOptions: 'View options',
    showCollision: 'Show collision geometry',
    renderBothSides: 'Render both sides (DoubleSide)',
    wireframe: 'Wireframe mode',
    sectionView: 'Section view (cut top to see inside)',
    sectionViewHint: 'Clip the top of the model with a horizontal plane to look into rooms / floors',
    sectionHeightLabel: 'Section height',
    lightingHeader: 'Lighting / background',
    lightingPreset: { studio: 'Studio', bright: 'Bright', night: 'Night' },
    lightIntensityLabel: 'Light intensity',
    backgroundColorLabel: 'Background color',
    resetCamera: 'Reset camera',
    resetCameraSub: 'Re-fit camera to current model',
    showJointPanel: 'Show joint panel',
    hideJointPanel: 'Hide joint panel',
    fullscreenStandaloneNote: 'Fullscreen available only when embedded in editor',
    enterFullscreen: 'Maximize Viewer in workbench',
    exitFullscreen: 'Exit fullscreen',
  },
  sidePanel: {
    modelInfo: 'Model Info',
    robot: 'Name',
    links: 'Links',
    joints: 'Joints',
    visuals: 'Visuals',
    movableSuffix: 'movable',
    fixedSuffix: 'fixed',
    mimicSuffix: 'mimic',
    primitive: 'primitive',
    meshLoaded: 'mesh loaded',
    meshFailed: 'failed',
    noModelLoaded: 'No model loaded.',
    jointsHeader: 'Joints',
    animatingTag: 'animating',
    resetAllJoints: 'Reset all joints',
    noMovableJoints: 'No movable joints in this model.',
    noLimit: '(no limit)',
    rangeArrow: '→',
    typeLabel: 'Type',
    modeArticulated: 'Articulated',
    modeStatic: 'Static scene',
    modeCharacter: 'Character',
    items: 'Items',
    meshes: 'Meshes',
    bones: 'Bones',
    skinMethod: 'Skinning',
    clips: 'Clips',
  },
  canvas: {
    emptyTitle: 'No model loaded',
    emptySubPrefix: 'Run the node ',
    emptySubMid1: 'pipeline',
    emptySubSuffix: ' and the model appears here automatically.',
    loadingMesh: 'Loading mesh assets…',
  },
}

const TABLE = { zh: ZH, en: EN } as const

/** Hook：随 useViewerStore.langMode 自动重渲染。 */
export function useViewerI18n(): ViewerI18nStrings {
  const langMode = useViewerStore((s) => s.langMode)
  return TABLE[langMode] ?? ZH
}

/** 同步获取（store 方法、effect 内部使用），不订阅变化。 */
export function getViewerI18n(): ViewerI18nStrings {
  return TABLE[useViewerStore.getState().langMode] ?? ZH
}
