import { useCallback, useRef, useState } from 'react'
import { DragTitle } from './controlSections.js'
import { applySectionDragDelta, usePanelDragMinHeight } from './sectionDragResize.js'
import { useUIStore } from '@forgeax/node-runtime-react/editor'

const LS_KEY = 'wb-2d-scene-asset-generator.imagepreview-heights'
const LS_COLLAPSED_KEY = 'wb-2d-scene-asset-generator.imagepreview-collapsed'
const HELP_MIN = 100
const DEFAULTS = { help: 220 }

type SectionKey = 'help'
interface Heights { help: number }
const SECTION_ORDER: readonly SectionKey[] = ['help']

function minHeightFor(_key: SectionKey): number {
  return HELP_MIN
}

function loadCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY)
    if (raw) return (JSON.parse(raw) as Record<string, unknown>).help === true
  } catch { /* ignore */ }
  return false
}

function saveCollapsed(help: boolean): void {
  try { localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify({ help })) } catch { /* ignore */ }
}

function load(): Heights {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      if (typeof o.help === 'number') return { help: Math.max(HELP_MIN, o.help) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function save(h: Heights): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(h)) } catch { /* ignore */ }
}

export function ImagePreviewControlsPanel(): JSX.Element {
  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const [heights, setHeights] = useState<Heights>(load)
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed)

  const panelRef = useRef<HTMLDivElement>(null)
  const { panelStyle, onDragStart } = usePanelDragMinHeight(panelRef)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      saveCollapsed(next)
      return next
    })
  }, [])

  const onDragHelp = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'help', dy, minHeightFor) as Heights
      save(next)
      return next
    })
  }, [])

  return (
    <div className="editor-controls-panel" ref={panelRef} style={panelStyle}>
      <div
        className="editor-controls__section"
        style={collapsed ? undefined : { height: heights.help }}
      >
        <DragTitle
          label={en ? 'Help' : '帮助'}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          onDrag={onDragHelp}
          onDragStart={onDragStart}
        />
        {!collapsed && (
          <div className="editor-controls__section-content">
            <div className="scene-left-pane__help">
              {en ? (
                <>
                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Preview</div>
                    <ul>
                      <li>Live generated images render in the preview above.</li>
                      <li>The preview refreshes whenever the pipeline produces a new image.</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Inspect</div>
                    <ul>
                      <li>Controls for zooming and adjusting the preview land here.</li>
                      <li>Save a result from the preview into <b>AssetStore</b>.</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">预览</div>
                    <ul>
                      <li>实时生成的图像会在上方预览中渲染。</li>
                      <li>管线每生成一张新图像，预览都会刷新。</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">查看</div>
                    <ul>
                      <li>缩放与调整预览的控制项后续会加在这里。</li>
                      <li>可把预览中的结果保存进 <b>资产库</b>。</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
