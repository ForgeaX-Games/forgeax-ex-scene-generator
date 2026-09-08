import { useCallback, useRef, useState } from 'react'
import { DragTitle } from './controlSections.js'
import { applySectionDragDelta, usePanelDragMinHeight } from './sectionDragResize.js'
import { useUIStore } from '@forgeax/node-runtime-react/editor'

const LS_KEY = 'wb-2d-scene-asset-generator.assetfolders-heights'
const LS_COLLAPSED_KEY = 'wb-2d-scene-asset-generator.assetfolders-collapsed'
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

export function AssetFoldersControlsPanel(): JSX.Element {
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
                    <div className="scene-left-pane__help-title">AssetStore</div>
                    <ul>
                      <li>Browse generated and imported assets in the folders above.</li>
                      <li>Each run drops its outputs into a dated folder.</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Organise</div>
                    <ul>
                      <li>Controls for sorting, filtering and inspecting folders land here.</li>
                      <li>Right-click an asset for export and reuse options.</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">资产库</div>
                    <ul>
                      <li>在上方面板浏览已生成与导入的资产。</li>
                      <li>每次运行都会把输出落入一个按日期命名的目录。</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">整理</div>
                    <ul>
                      <li>排序、筛选与查看资产的控制项后续会加在这里。</li>
                      <li>右键点击资产可查看导出与复用选项。</li>
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
