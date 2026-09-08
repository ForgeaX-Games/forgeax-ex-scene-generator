// 💡 URDF Viewer 标题栏：导出 + 渲染选项 + 关节面板开关
//    文案走 useViewerI18n()（本地静态表，无 WS 同步）。
//    单源宿主版本：移除了 legacy 的本地文件打开 / 粘贴 URDF 输入，以及跨端口/全屏
//    postMessage（这些在后续任务里改接 workbench 协议）。模型来源由 live sync 注入。
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, FileCode2, Grid3X3, Compass, Download,
  Repeat, Play, Pause, X, PanelRight, PanelRightClose, RotateCcw, Camera,
} from 'lucide-react'
import { useViewerStore, LIGHTING_PRESETS, type LightingPresetId } from '../../store/viewerStore'
import { useViewerI18n } from '../../i18n/strings'
import './Titlebar.css'

type ExportFormat = 'obj' | 'glb' | 'glb-static' | 'glb-skinned' | 'glb-character' | 'urdf'

interface TitlebarProps {
  onResetView: () => void
  onExport: (format: ExportFormat) => void | Promise<void>
  onDirectImport: () => void
  onScreenshot: () => void | Promise<void>
  canExportUrdf: boolean
  /** 静态几何导出（obj / glb / glb-static）：URDF 或静态场景就绪即可。 */
  canExportScene: boolean
  /** 骨骼蒙皮导出（glb-skinned）：仅 URDF spec 就绪时有意义（刚性件蒙到关节骨）。 */
  canExportSkinned?: boolean
  /** 角色模式（骨架蒙皮已就绪）时可导出角色 GLB。 */
  canExportCharacter?: boolean
  canDirectImport?: boolean
}

function Titlebar({ onResetView, onExport, onDirectImport, onScreenshot, canExportUrdf, canExportScene, canExportSkinned = false, canExportCharacter = false, canDirectImport = false }: TitlebarProps) {
  // Selected field-by-field — a bare `useViewerStore()` subscribes to the
  // whole store and re-renders the titlebar on every unrelated viewer update.
  const sourceLabel = useViewerStore((s) => s.sourceLabel)
  const render = useViewerStore((s) => s.render)
  const toggleRenderOption = useViewerStore((s) => s.toggleRenderOption)
  const sectionHeight = useViewerStore((s) => s.sectionHeight)
  const setSectionHeight = useViewerStore((s) => s.setSectionHeight)
  const lighting = useViewerStore((s) => s.lighting)
  const setLightIntensity = useViewerStore((s) => s.setLightIntensity)
  const setBackgroundColor = useViewerStore((s) => s.setBackgroundColor)
  const applyLightingPreset = useViewerStore((s) => s.applyLightingPreset)
  const sidePanelOpen = useViewerStore((s) => s.sidePanelOpen)
  const toggleSidePanel = useViewerStore((s) => s.toggleSidePanel)
  const clearSource = useViewerStore((s) => s.clearSource)
  const t = useViewerI18n()

  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [directImportMode, setDirectImportMode] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showExportMenu) return
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExportMenu])

  useEffect(() => {
    if (!showSettings) return
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettings])

  const handleExportFormat = (format: ExportFormat) => {
    setShowExportMenu(false)
    void onExport(format)
  }

  const handleDirectImport = () => {
    setShowExportMenu(false)
    onDirectImport()
  }

  return (
    <div className="viewer-titlebar">
      <div className="viewer-titlebar-left">
        <span className="viewer-logo-text">{t.titlebar.productName}</span>
        {sourceLabel && (
          <span className="viewer-source-badge" title={sourceLabel}>
            <FileCode2 size={11} />
            <span>{sourceLabel}</span>
            <button
              className="viewer-source-clear"
              title={t.titlebar.clearModelTooltip}
              onClick={() => { clearSource() }}
            >
              <X size={11} />
            </button>
          </span>
        )}
      </div>

      <div className="viewer-titlebar-right">
        <div className="viewer-dropdown-container" ref={exportMenuRef}>
          <button
            className={`viewer-tb-btn${showExportMenu ? ' active' : ''}`}
            title={t.titlebar.exportTooltip}
            disabled={!canExportUrdf && !canExportScene && !canExportCharacter}
            onClick={(e) => { e.stopPropagation(); setShowSettings(false); setShowExportMenu((v) => !v) }}
          >
            <Download size={14} />
            <span>{t.titlebar.export}</span>
            <ChevronDown size={12} />
          </button>
          {showExportMenu && (
            <div className="viewer-dropdown">
              <div className="viewer-dropdown-header">{directImportMode ? t.titlebar.directImportHeader : t.titlebar.exportHeader}</div>
              <label className="viewer-dropdown-switch">
                <span className="viewer-dropdown-switch-copy">
                  <span className="viewer-dropdown-item-title">{t.titlebar.directImportToggle}</span>
                  <span className="viewer-dropdown-item-sub">{t.titlebar.directImportToggleSub}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={directImportMode}
                  onChange={(event) => setDirectImportMode(event.target.checked)}
                  aria-label={t.titlebar.directImportToggle}
                />
              </label>
              <div className="viewer-dropdown-divider" />
              {directImportMode ? (
                <button
                  className="viewer-dropdown-item"
                  disabled={!canDirectImport}
                  onClick={handleDirectImport}
                >
                  <span className="viewer-dropdown-item-title">{t.titlebar.directImportAction}</span>
                  <span className="viewer-dropdown-item-sub">{t.titlebar.directImportActionSub}</span>
                </button>
              ) : (
                <>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportScene}
                    onClick={() => handleExportFormat('obj')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportObj}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportObjSub}</span>
                  </button>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportScene}
                    onClick={() => handleExportFormat('glb')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportGlb}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbSub}</span>
                  </button>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportScene}
                    onClick={() => handleExportFormat('glb-static')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportGlbStatic}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbStaticSub}</span>
                  </button>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportSkinned}
                    onClick={() => handleExportFormat('glb-skinned')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportGlbSkinned}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbSkinnedSub}</span>
                  </button>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportCharacter}
                    onClick={() => handleExportFormat('glb-character')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportGlbCharacter}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbCharacterSub}</span>
                  </button>
                  <button
                    className="viewer-dropdown-item"
                    disabled={!canExportUrdf}
                    onClick={() => handleExportFormat('urdf')}
                  >
                    <span className="viewer-dropdown-item-title">{t.titlebar.exportUrdf}</span>
                    <span className="viewer-dropdown-item-sub">{t.titlebar.exportUrdfSub}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <span className="viewer-tb-divider" />

        <button
          className={`viewer-tb-icon-btn${render.showGrid ? ' active' : ''}`}
          title={t.titlebar.toggleGrid}
          onClick={() => toggleRenderOption('showGrid')}
        >
          <Grid3X3 size={16} />
        </button>
        <button
          className={`viewer-tb-icon-btn${render.showAxis ? ' active' : ''}`}
          title={t.titlebar.toggleAxis}
          onClick={() => toggleRenderOption('showAxis')}
        >
          <Compass size={16} />
        </button>
        <button
          className={`viewer-tb-icon-btn${render.autoAnimate ? ' active' : ''}`}
          title={render.autoAnimate ? t.titlebar.stopAnimation : t.titlebar.playAnimation}
          onClick={() => toggleRenderOption('autoAnimate')}
        >
          {render.autoAnimate ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="viewer-tb-icon-btn"
          title={t.titlebar.screenshot}
          onClick={() => { void onScreenshot() }}
        >
          <Camera size={16} />
        </button>

        <div className="viewer-dropdown-container" ref={settingsMenuRef}>
          <button
            className={`viewer-tb-icon-btn${showSettings ? ' active' : ''}`}
            title={t.titlebar.moreOptions}
            onClick={(e) => { e.stopPropagation(); setShowExportMenu(false); setShowSettings((v) => !v) }}
          >
            <Repeat size={16} />
          </button>
          {showSettings && (
            <div className="viewer-dropdown">
              <div className="viewer-dropdown-header">{t.titlebar.viewOptions}</div>
              <label className="viewer-dropdown-check">
                <input
                  type="checkbox"
                  checked={render.showCollisions}
                  onChange={() => toggleRenderOption('showCollisions')}
                />
                <span>{t.titlebar.showCollision}</span>
              </label>
              <label className="viewer-dropdown-check">
                <input
                  type="checkbox"
                  checked={render.doubleSided}
                  onChange={() => toggleRenderOption('doubleSided')}
                />
                <span>{t.titlebar.renderBothSides}</span>
              </label>
              <label className="viewer-dropdown-check">
                <input
                  type="checkbox"
                  checked={render.wireframe}
                  onChange={() => toggleRenderOption('wireframe')}
                />
                <span>{t.titlebar.wireframe}</span>
              </label>
              <label className="viewer-dropdown-check" title={t.titlebar.sectionViewHint}>
                <input
                  type="checkbox"
                  checked={render.sectionView}
                  onChange={() => toggleRenderOption('sectionView')}
                />
                <span>{t.titlebar.sectionView}</span>
              </label>
              {render.sectionView && (
                <div className="viewer-dropdown-slider">
                  <span className="viewer-dropdown-slider-label">
                    {t.titlebar.sectionHeightLabel} · {Math.round(sectionHeight * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sectionHeight}
                    onChange={(e) => setSectionHeight(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="viewer-dropdown-divider" />
              <div className="viewer-dropdown-header">{t.titlebar.lightingHeader}</div>
              <div className="viewer-dropdown-presets">
                {(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`viewer-dropdown-preset-btn${lighting.preset === id ? ' active' : ''}`}
                    onClick={() => applyLightingPreset(id)}
                  >
                    {t.titlebar.lightingPreset[id]}
                  </button>
                ))}
              </div>
              <div className="viewer-dropdown-slider">
                <span className="viewer-dropdown-slider-label">
                  {t.titlebar.lightIntensityLabel} · {Math.round(lighting.intensity * 100)}%
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={1.8}
                  step={0.05}
                  value={lighting.intensity}
                  onChange={(e) => setLightIntensity(Number(e.target.value))}
                />
              </div>
              <label className="viewer-dropdown-check viewer-dropdown-color-row">
                <span>{t.titlebar.backgroundColorLabel}</span>
                <input
                  type="color"
                  className="viewer-dropdown-color-input"
                  value={lighting.backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                />
              </label>
              <div className="viewer-dropdown-divider" />
              <button className="viewer-dropdown-item" onClick={() => { onResetView(); setShowSettings(false) }}>
                <span className="viewer-dropdown-item-title">
                  <RotateCcw size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {t.titlebar.resetCamera}
                </span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.resetCameraSub}</span>
              </button>
            </div>
          )}
        </div>

        <span className="viewer-tb-divider" />

        <button
          className={`viewer-tb-icon-btn${sidePanelOpen ? ' active' : ''}`}
          title={sidePanelOpen ? t.titlebar.hideJointPanel : t.titlebar.showJointPanel}
          onClick={() => toggleSidePanel()}
        >
          {sidePanelOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
        </button>
      </div>
    </div>
  )
}

export default Titlebar
