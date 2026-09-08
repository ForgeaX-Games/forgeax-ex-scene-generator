import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DragTitle, SectionTitle } from './controlSections.js'
import { applySectionDragDelta, usePanelDragMinHeight } from './sectionDragResize.js'
import {
  SettingsDataTypesPanel,
  SettingsHistoryPanel,
  createEditorBridge,
  getPortTypeColor,
  useUIStore,
} from '@forgeax/node-runtime-react/editor'
import type {
  EditorBridge,
  EditorMirrorSnapshot,
  SelectedNodeView,
  SelectedPortView,
} from '@forgeax/node-runtime-react/editor'
import type { DomainPortTypes } from '@forgeax/node-runtime-react/editor'

interface Props {
  syncKey: string
  domainPortTypes?: DomainPortTypes
}

const LS_KEY = 'wb-2d-scene-asset-generator.controls-heights'
const LS_COLLAPSED_KEY = 'wb-2d-scene-asset-generator.controls-collapsed'
const MIN_H = 48
const HELP_MIN = 100
const DEFAULTS = { nodeInfo: 170, history: 180, dataTypes: 180, help: 160 }

type SectionKey = 'nodeInfo' | 'history' | 'dataTypes' | 'help'
interface Heights { nodeInfo: number; history: number; dataTypes: number; help: number }
interface Collapsed { nodeInfo: boolean; history: boolean; dataTypes: boolean; help: boolean }

const SECTION_ORDER: readonly SectionKey[] = ['nodeInfo', 'history', 'dataTypes', 'help']

function minHeightFor(key: SectionKey): number {
  return key === 'help' ? HELP_MIN : MIN_H
}

function loadCollapsed(): Collapsed {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      return {
        nodeInfo: o.nodeInfo === true,
        history: o.history === true,
        dataTypes: o.dataTypes === true,
        help: o.help === true,
      }
    }
  } catch { /* ignore */ }
  return { nodeInfo: false, history: false, dataTypes: false, help: false }
}

function saveCollapsed(c: Collapsed): void {
  try { localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

function load(): Heights {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      if (
        typeof o.history === 'number' &&
        typeof o.dataTypes === 'number' &&
        typeof o.help === 'number'
      ) {
        return {
          nodeInfo: Math.max(MIN_H, typeof o.nodeInfo === 'number' ? o.nodeInfo : DEFAULTS.nodeInfo),
          history: Math.max(MIN_H, o.history),
          dataTypes: Math.max(MIN_H, o.dataTypes),
          help: Math.max(HELP_MIN, o.help),
        }
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function save(h: Heights): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(h)) } catch { /* ignore */ }
}

export function SceneGeneratorControlsPanel({ syncKey, domainPortTypes }: Props): JSX.Element {
  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const [mirror, setMirror] = useState<EditorMirrorSnapshot | null>(null)
  const bridgeRef = useRef<EditorBridge | null>(null)
  const [heights, setHeights] = useState<Heights>(load)
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed)

  const panelRef = useRef<HTMLDivElement>(null)
  const { panelStyle, onDragStart } = usePanelDragMinHeight(panelRef)

  useEffect(() => {
    const bridge = createEditorBridge(syncKey)
    bridgeRef.current = bridge
    const off = bridge.onState(setMirror)
    bridge.sendCommand({ type: 'request-state' })
    return () => { off(); bridge.close(); bridgeRef.current = null }
  }, [syncKey])

  const toggleCollapsed = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveCollapsed(next)
      return next
    })
  }, [])

  // Each draggable section title resizes the section directly above it.
  const onDragHistory = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'nodeInfo', dy, minHeightFor) as Heights
      save(next)
      return next
    })
  }, [])

  const onDragDataTypes = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'history', dy, minHeightFor) as Heights
      save(next)
      return next
    })
  }, [])

  const onDragHelp = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'dataTypes', dy, minHeightFor) as Heights
      save(next)
      return next
    })
  }, [])

  return (
    <div className="editor-controls-panel" ref={panelRef} style={panelStyle}>
      {/* Node Info — whole-canvas tallies + the selected battery's wiring. */}
      <div
        className="editor-controls__section"
        style={collapsed.nodeInfo ? undefined : { height: heights.nodeInfo }}
      >
        <SectionTitle
          label={en ? 'Node Info' : '节点信息'}
          collapsed={collapsed.nodeInfo}
          onToggle={() => toggleCollapsed('nodeInfo')}
        />
        {!collapsed.nodeInfo && (
          <div className="editor-controls__section-content">
            <NodeInfoPanel mirror={mirror} domainPortTypes={domainPortTypes} en={en} />
          </div>
        )}
      </div>

      {/* History */}
      <div
        className="editor-controls__section"
        style={collapsed.history ? undefined : { height: heights.history }}
      >
        <DragTitle
          label={en ? 'History' : '操作历史'}
          collapsed={collapsed.history}
          onToggle={() => toggleCollapsed('history')}
          onDrag={onDragHistory}
          onDragStart={onDragStart}
        />
        {!collapsed.history && (
          <div className="editor-controls__section-content">
            <SettingsHistoryPanel
              mirror={mirror?.history}
              onClear={() => bridgeRef.current?.sendCommand({ type: 'clear-history' })}
            />
          </div>
        )}
      </div>

      {/* Data Types */}
      <div
        className="editor-controls__section"
        style={collapsed.dataTypes ? undefined : { height: heights.dataTypes }}
      >
        <DragTitle
          label={en ? 'Data Types' : '数据类型'}
          collapsed={collapsed.dataTypes}
          onToggle={() => toggleCollapsed('dataTypes')}
          onDrag={onDragDataTypes}
          onDragStart={onDragStart}
        />
        {!collapsed.dataTypes && (
          <div className="editor-controls__section-content">
            <SettingsDataTypesPanel domainPortTypes={domainPortTypes} />
          </div>
        )}
      </div>

      {/* Help — last section: size to its natural content height (not a fixed
          pixel box) so the whole help text shows and the outer pane scrolls,
          matching wb-scene-generator. */}
      <div
        className="editor-controls__section editor-controls__section--help"
        style={collapsed.help ? undefined : { minHeight: heights.help }}
      >
        <DragTitle
          label={en ? 'Help' : '帮助'}
          collapsed={collapsed.help}
          onToggle={() => toggleCollapsed('help')}
          onDrag={onDragHelp}
          onDragStart={onDragStart}
        />
        {!collapsed.help && (
          <div className="editor-controls__section-content">
            <div className="scene-left-pane__help">
              {en ? (
                <>
                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Build an asset graph</div>
                    <ol>
                      <li>Drag a battery from the left catalog onto the canvas.</li>
                      <li>Drag from an output port to an input port to wire nodes.</li>
                      <li>Run the pipeline to generate the 2D asset output.</li>
                    </ol>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Inspect &amp; edit</div>
                    <ul>
                      <li>Click a battery to see its ports and links in <b>Node Info</b>.</li>
                      <li>Use <b>History</b> to review or undo recent edits.</li>
                      <li><b>Data Types</b> lists every port colour and its aliases.</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Preview &amp; assets</div>
                    <ul>
                      <li><b>Preview</b> embeds the live generated image output.</li>
                      <li><b>AssetStore</b> browses generated and imported assets.</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">Projects</div>
                    <ul>
                      <li>Use <b>+</b> to start a project; the folder icon opens one.</li>
                      <li><b>Save</b> on a card exports that project as JSON.</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">搭建资产图</div>
                    <ol>
                      <li>从左侧电池库把节点拖到画布上。</li>
                      <li>从输出端口拖到输入端口即可连线。</li>
                      <li>运行管线以生成 2D 资产输出。</li>
                    </ol>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">查看与编辑</div>
                    <ul>
                      <li>点击节点，在 <b>节点信息</b> 中查看其端口与连线。</li>
                      <li>在 <b>操作历史</b> 中回顾或撤销最近的改动。</li>
                      <li><b>数据类型</b> 列出每种端口颜色及其别名。</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">预览与资产</div>
                    <ul>
                      <li><b>预览</b> 标签内嵌实时生成的图像输出。</li>
                      <li><b>资产库</b> 用于浏览已生成与导入的资产。</li>
                    </ul>
                  </div>

                  <div className="scene-left-pane__help-group">
                    <div className="scene-left-pane__help-title">项目管理</div>
                    <ul>
                      <li>用 <b>+</b> 新建项目，文件夹图标用于打开项目。</li>
                      <li>卡片上的 <b>Save</b> 把该项目导出为 JSON。</li>
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

// Node Info — top of the controls stack. Shows whole-canvas tallies and, when a
// battery is selected on the canvas, a miniature of it: ports draw a short wire
// out to the peer they connect to, inputs on the left and outputs on the right.
function NodeInfoPanel({
  mirror,
  domainPortTypes,
  en,
}: {
  mirror: EditorMirrorSnapshot | null
  domainPortTypes?: DomainPortTypes
  en: boolean
}): JSX.Element {
  const stats = mirror?.stats
  const node = mirror?.selectedNode ?? null
  return (
    <div className="scene-node-info">
      <div className="scene-node-info__stats">
        <NodeInfoStat label={en ? 'Batteries' : '电池'} value={stats?.batteryCount ?? 0} />
        <NodeInfoStat label={en ? 'Links' : '连接'} value={stats?.edgeCount ?? 0} />
        <NodeInfoStat label={en ? 'Notes' : '注释'} value={stats?.annotationCount ?? 0} />
        <NodeInfoStat label={en ? 'Groups' : '组合'} value={stats?.groupCount ?? 0} />
        <NodeInfoStat label={en ? 'Frames' : '包围盒'} value={stats?.frameCount ?? 0} />
        <NodeInfoStat label={en ? 'Selected' : '选中'} value={stats?.selectedCount ?? 0} />
      </div>
      {node ? (
        <SelectedBatteryDiagram node={node} domainPortTypes={domainPortTypes} en={en} />
      ) : (
        <div className="scene-node-info__empty">
          {en
            ? 'Click a battery on the canvas to inspect its connections.'
            : '单击画布上的电池查看其连线情况。'}
        </div>
      )}
    </div>
  )
}

function NodeInfoStat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <span className="ni-stat">
      <b>{value}</b> {label}
    </span>
  )
}

// Faithful miniature of the selected battery: a node card (title + ports on
// left/right edges), each connected port drawing a short wire out to the peer
// it links to, rendered as plain text (upstream for inputs, downstream for
// outputs).
function SelectedBatteryDiagram({
  node,
  domainPortTypes,
  en,
}: {
  node: SelectedNodeView
  domainPortTypes?: DomainPortTypes
  en: boolean
}): JSX.Element {
  const portsRef = useRef<HTMLDivElement>(null)

  // Adapt to the available width and keep rows from overlapping:
  //  - the node card grows to use the pane width, leaving fixed side gutters
  //    just wide enough for the values (so names get more room and wrap less);
  //  - each value box fills its gutter (`--ni-value-w`);
  //  - lead-outs sit absolutely in the gutters and don't add row height on their
  //    own, so we measure each and grow its port row to fit (2–3 line values
  //    spread the ports apart instead of overlapping).
  // Re-runs on selection/lang change and whenever the pane is resized.
  useLayoutEffect(() => {
    const root = portsRef.current
    if (!root) return
    const card = root.parentElement
    const diagram = card?.parentElement ?? null

    const measure = (): void => {
      if (card && diagram) {
        const avail = diagram.clientWidth
        if (avail > 0) {
          // Side gutters take ~26% of the width (bounded), the card the rest;
          // the value box fills the gutter minus the wire slot.
          const gutter = Math.max(56, Math.min(110, Math.round(avail * 0.26)))
          const cardW = Math.max(120, avail - gutter * 2)
          card.style.width = `${cardW}px`
          root.style.setProperty('--ni-value-w', `${Math.max(40, gutter - 18)}px`)
        }
      }
      root.querySelectorAll<HTMLElement>('.ni-port').forEach((port) => {
        port.style.minHeight = ''
        const lead = port.querySelector<HTMLElement>('.ni-lead')
        const h = lead?.offsetHeight ?? 0
        if (h) port.style.minHeight = `${h}px`
      })
    }

    measure()
    const ro = diagram ? new ResizeObserver(measure) : null
    if (ro && diagram) ro.observe(diagram)
    return () => ro?.disconnect()
  }, [node, en])

  return (
    <div className="scene-node-info__diagram">
      <div className="ni-node">
        <div className="ni-node__title" title={node.name}>
          {en ? node.batteryNameEn || node.batteryName || node.name : node.batteryName || node.name}
        </div>
        <div className="ni-node__ports" ref={portsRef}>
          <div className="ni-node__col ni-node__col--in">
            {node.inputs.length === 0 ? (
              <div className="ni-node__empty">{en ? 'no inputs' : '无输入'}</div>
            ) : (
              node.inputs.map((port) => (
                <PortRow key={`in:${port.name}`} port={port} side="in" en={en} domainPortTypes={domainPortTypes} />
              ))
            )}
          </div>
          <div className="ni-node__col ni-node__col--out">
            {node.outputs.length === 0 ? (
              <div className="ni-node__empty">{en ? 'no outputs' : '无输出'}</div>
            ) : (
              node.outputs.map((port) => (
                <PortRow key={`out:${port.name}`} port={port} side="out" en={en} domainPortTypes={domainPortTypes} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Insert zero-width break opportunities at camelCase / digit boundaries so a
// long port name wraps between its words (mainRoadGrid → mainRoad​Grid) instead
// of being chopped mid-word.
function breakableName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1\u200B$2')
}

// Split a port's formatted value into a short kind label + the value itself, so
// each renders on its own line: grids show "grid" / "979×979", everything else
// shows "Value" / the value.
function valueParts(port: SelectedPortView): { label: string; detail: string } {
  const text = port.valueText ?? ''
  if (port.type === 'grid') {
    const m = text.match(/^grid\s+(.+)$/i)
    return { label: 'grid', detail: m ? m[1] : text }
  }
  return { label: 'Value', detail: text }
}

function PortRow({
  port,
  side,
  en,
  domainPortTypes,
}: {
  port: SelectedPortView
  side: 'in' | 'out'
  en: boolean
  domainPortTypes?: DomainPortTypes
}): JSX.Element {
  const color = getPortTypeColor(port.type, domainPortTypes)
  const displayName = en ? port.labelEn ?? port.name : port.label ?? port.name
  const connected = port.peers.length > 0
  const hasValue = !!port.valueText
  const dot = <span className="ni-dot" style={{ background: color, borderColor: color }} />
  const name = (
    <span className="ni-name" title={`${displayName} · ${port.type}`}>
      {breakableName(displayName)}
    </span>
  )
  const parts = hasValue ? valueParts(port) : null
  // The wire slot is always reserved (so wired and unwired values stay aligned)
  // but only painted when the port is actually connected. The value renders for
  // every port that has one, as a kind label + value on separate lines.
  const lead =
    connected || hasValue ? (
      <span className="ni-lead">
        <span
          className={`ni-wire${connected ? '' : ' ni-wire--ghost'}`}
          style={connected ? { background: color } : undefined}
        />
        {parts ? (
          <span className="ni-peers">
            <span className="ni-peer" title={port.valueText}>
              <span className="ni-peer__kind">{parts.label}</span>
              <span className="ni-peer__node">{parts.detail}</span>
            </span>
          </span>
        ) : null}
      </span>
    ) : null

  return (
    <div className={`ni-port ni-port--${side}${connected || hasValue ? '' : ' ni-port--idle'}`}>
      {side === 'in' ? (
        <>
          {dot}
          {name}
        </>
      ) : (
        <>
          {name}
          {dot}
        </>
      )}
      {lead}
    </div>
  )
}
