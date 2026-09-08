import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DragTitle, SectionTitle } from './controlSections.js'
import { applySectionDragDelta, usePanelDragMinHeight } from './sectionDragResize.js'
import { useEditorMirror } from './useEditorMirror.js'
import {
  SettingsDataTypesPanel,
  SettingsHistoryPanel,
  getPortTypeColor,
  useProjectStore,
} from '@forgeax/node-runtime-react/editor'
import { sceneT, useSceneLocale } from '../sceneI18n.js'
import type {
  EditorMirrorSnapshot,
  SelectedNodeView,
  SelectedPortView,
} from '@forgeax/node-runtime-react/editor'
import type { DomainPortTypes } from '@forgeax/node-runtime-react/editor'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import { useSceneScriptDiagnosticCodes } from './sceneScriptDiagnosticBridge.js'
import { Box, ChevronDown, ChevronRight, CircleHelp, Folder, History, ListTree } from '../surfaces/icons.js'

interface Props {
  syncKey: string
  domainPortTypes?: DomainPortTypes
  client?: HttpApiClient
}

const LS_KEY = 'wb-scene-generator.controls-heights'
const LS_COLLAPSED_KEY = 'wb-scene-generator.controls-collapsed'
const MIN_H = 48
const HELP_MIN = 100
const DEFAULTS = { nodeInfo: 170, history: 180, dataTypes: 180, help: 160 }

type SectionKey = 'nodeInfo' | 'history' | 'dataTypes' | 'help'
interface Heights { nodeInfo: number; history: number; dataTypes: number; help: number }
interface Collapsed { nodeInfo: boolean; history: boolean; dataTypes: boolean; help: boolean }

const SECTION_ORDER: readonly SectionKey[] = ['nodeInfo', 'history', 'dataTypes', 'help']

type DashboardTabId = 'nodeInfo' | 'project' | 'history' | 'dataTypes' | 'help'
type SceneProjectInfo = Awaited<ReturnType<HttpApiClient['getSceneScriptProjectInfo']>>

function DashboardTabIcon({ id }: { id: DashboardTabId }): JSX.Element {
  const props = { size: 15, 'aria-hidden': true as const }
  switch (id) {
    case 'nodeInfo': return <ListTree {...props} />
    case 'project': return <Folder {...props} />
    case 'history': return <History {...props} />
    case 'dataTypes': return <Box {...props} />
    case 'help': return <CircleHelp {...props} />
  }
}

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
  const locale = useSceneLocale()
  const en = locale === 'en'

  const { mirror, bridgeRef } = useEditorMirror(syncKey)
  const [heights, setHeights] = useState<Heights>(load)
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed)

  const panelRef = useRef<HTMLDivElement>(null)
  const { panelStyle, onDragStart } = usePanelDragMinHeight(panelRef)

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
          label={sceneT('controls.nodeInfo')}
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
          label={sceneT('controls.history')}
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
          label={sceneT('controls.dataTypes')}
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

      {/* Help */}
      <div
        className="editor-controls__section"
        style={collapsed.help ? undefined : { height: heights.help }}
      >
        <DragTitle
          label={sceneT('controls.help')}
          collapsed={collapsed.help}
          onToggle={() => toggleCollapsed('help')}
          onDrag={onDragHelp}
          onDragStart={onDragStart}
        />
        {!collapsed.help && (
          <div className="editor-controls__section-content">
            <div className="scene-left-pane__help">
              <div className="scene-left-pane__help-group">
                <div className="scene-left-pane__help-title">{sceneT('controls.help.buildTitle')}</div>
                <ol>
                  <li>{sceneT('controls.help.build1')}</li>
                  <li>{sceneT('controls.help.build2')}</li>
                  <li>{sceneT('controls.help.build3')}</li>
                </ol>
              </div>

              <div className="scene-left-pane__help-group">
                <div className="scene-left-pane__help-title">{sceneT('controls.help.inspectTitle')}</div>
                <ul>
                  <li>{sceneT('controls.help.inspect1')}</li>
                  <li>{sceneT('controls.help.inspect2')}</li>
                  <li>{sceneT('controls.help.inspect3')}</li>
                </ul>
              </div>

              <div className="scene-left-pane__help-group">
                <div className="scene-left-pane__help-title">{sceneT('controls.help.previewTitle')}</div>
                <ul>
                  <li>{sceneT('controls.help.preview1')}</li>
                  <li>{sceneT('controls.help.preview2')}</li>
                </ul>
              </div>

              <div className="scene-left-pane__help-group">
                <div className="scene-left-pane__help-title">{sceneT('controls.help.projectsTitle')}</div>
                <ul>
                  <li>{sceneT('controls.help.projects1')}</li>
                  <li>{sceneT('controls.help.projects2')}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Page-sidebar Node Info surface. Kept separate from the legacy controls stack
 * so the sidebar can present current graph context without exposing History,
 * Data Types, and Help as always-on panes.
 */
export function NodeInfoDashboard({ syncKey, domainPortTypes, client }: Props): JSX.Element {
  const locale = useSceneLocale()
  const { mirror, bridgeRef } = useEditorMirror(syncKey)
  const viewingProjectId = useProjectStore((state) => state.viewingProjectId)
  const viewingProjectName = useProjectStore(
    (state) => state.projects?.find((project) => project.id === state.viewingProjectId)?.name ?? null,
  )
  const [projectInfo, setProjectInfo] = useState<SceneProjectInfo | null>(null)
  const [projectInfoError, setProjectInfoError] = useState<string | null>(null)
  const [projectInfoLoading, setProjectInfoLoading] = useState(false)
  const [projectInfoRetry, setProjectInfoRetry] = useState(0)

  useEffect(() => {
    if (!client || !viewingProjectId) {
      setProjectInfo(null)
      setProjectInfoError(null)
      setProjectInfoLoading(false)
      return
    }
    let disposed = false
    setProjectInfoLoading(true)
    setProjectInfoError(null)
    void client.getSceneScriptProjectInfo(viewingProjectId)
      .then((next) => {
        if (disposed) return
        setProjectInfo(next)
        setProjectInfoError(null)
      })
      .catch((reason: unknown) => {
        if (!disposed) setProjectInfoError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!disposed) setProjectInfoLoading(false)
      })
    return () => { disposed = true }
  }, [client, projectInfoRetry, viewingProjectId])

  const [tab, setTab] = useState<DashboardTabId>('project')
  const tabs = [
    ['project', locale === 'en' ? 'Project' : '项目'],
    ['nodeInfo', sceneT('controls.nodeInfo')],
    ['history', sceneT('controls.history')],
    ['dataTypes', sceneT('controls.dataTypes')],
    ['help', sceneT('controls.help')],
  ] as const
  return (
    <section className="scene-node-dashboard" aria-label={sceneT('controls.nodeInfo')}>
      <div className="scene-node-dashboard__tabs" role="tablist" aria-label={sceneT('leftPane.controlGroup')}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-label={label}
            title={label}
            className={`scene-node-dashboard__tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <DashboardTabIcon id={id} />
          </button>
        ))}
      </div>
      <div className="scene-node-dashboard__content" role="tabpanel">
        {tab === 'nodeInfo' && (
          <NodeInfoPanel
            mirror={mirror}
            domainPortTypes={domainPortTypes}
            en={locale === 'en'}
            projectId={viewingProjectId}
          />
        )}
        {tab === 'project' && (
          <ProjectDetailsPanel
            projectId={viewingProjectId}
            projectName={viewingProjectName}
            info={projectInfo}
            loading={projectInfoLoading}
            error={projectInfoError}
            onRetry={() => setProjectInfoRetry((value) => value + 1)}
          />
        )}
        {tab === 'history' && (
          <SettingsHistoryPanel
            mirror={mirror?.history}
            onClear={() => bridgeRef.current?.sendCommand({ type: 'clear-history' })}
          />
        )}
        {tab === 'dataTypes' && <SettingsDataTypesPanel domainPortTypes={domainPortTypes} />}
        {tab === 'help' && <DashboardHelp />}
      </div>
    </section>
  )
}

type SceneProjectFile = Awaited<ReturnType<HttpApiClient['getSceneScriptProjectInfo']>>['files'][number]

interface ProjectFileTreeNode {
  name: string
  path: string
  kind?: SceneProjectFile['kind']
  bytes?: number
  children: Map<string, ProjectFileTreeNode>
}

function normalizeProjectFilePath(filePath: string): string[] {
  const parts: string[] = []
  for (const part of filePath.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts
}

function buildProjectFileTree(files: readonly SceneProjectFile[]): ProjectFileTreeNode[] {
  const roots = new Map<string, ProjectFileTreeNode>()

  for (const file of files) {
    const parts = normalizeProjectFilePath(file.path)
    if (parts.length === 0) continue
    let level = roots
    let node: ProjectFileTreeNode | undefined
    let path = ''

    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part
      node = level.get(part)
      if (!node) {
        node = { name: part, path, children: new Map() }
        level.set(part, node)
      }
      if (index === parts.length - 1) {
        node.kind = file.kind
        node.bytes = file.bytes
      }
      level = node.children
    })
  }

  const sortNodes = (nodes: Iterable<ProjectFileTreeNode>): ProjectFileTreeNode[] => (
    [...nodes].sort((a, b) => {
      const aIsFolder = a.children.size > 0
      const bIsFolder = b.children.size > 0
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  )

  const sortChildren = (node: ProjectFileTreeNode): ProjectFileTreeNode => {
    node.children = new Map(sortNodes(node.children.values()).map((child) => [child.name, sortChildren(child)]))
    return node
  }

  return sortNodes(roots.values()).map(sortChildren)
}

function projectFileKindLabel(kind: SceneProjectFile['kind']): string {
  switch (kind) {
    case 'module': return 'Scene'
    case 'generator': return 'Generator'
    case 'helper': return 'Helper'
    case 'material': return 'Material'
    case 'state': return 'State'
    case 'layout': return 'Layout'
  }
}

function ProjectFileTreeNodeView({ node }: { node: ProjectFileTreeNode }): JSX.Element {
  const isFolder = node.children.size > 0
  const [expanded, setExpanded] = useState(true)
  const children = [...node.children.values()]

  return (
    <li className={`scene-project-info__tree-item${isFolder ? ' is-folder' : ' is-file'}`} role="treeitem" aria-expanded={isFolder ? expanded : undefined}>
      {isFolder ? (
        <button
          type="button"
          className="scene-project-info__tree-row scene-project-info__tree-row--folder"
          onClick={() => setExpanded((value) => !value)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
          title={node.path}
        >
          <span className="scene-project-info__tree-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <Folder className="scene-project-info__tree-icon" size={15} aria-hidden="true" />
          <span className="scene-project-info__tree-name">{node.name}</span>
          <small className="scene-project-info__tree-count">{children.length}</small>
        </button>
      ) : (
        <div className="scene-project-info__tree-row scene-project-info__tree-row--file" title={node.path}>
          <span className="scene-project-info__tree-chevron" aria-hidden="true" />
          <span className="scene-project-info__tree-file-icon" aria-hidden="true" />
          <code className="scene-project-info__tree-name">{node.name}</code>
          <span className="scene-project-info__tree-meta">
            <span className={`scene-project-info__tree-kind scene-project-info__tree-kind--${node.kind ?? 'file'}`}>
              {node.kind ? projectFileKindLabel(node.kind) : 'File'}
            </span>
            <small>{node.bytes ?? 0} B</small>
          </span>
        </div>
      )}
      {isFolder && expanded && (
        <ul className="scene-project-info__tree-children" role="group">
          {children.map((child) => <ProjectFileTreeNodeView key={child.path} node={child} />)}
        </ul>
      )}
    </li>
  )
}

function ProjectFileTree({ files }: { files: readonly SceneProjectFile[] }): JSX.Element {
  const tree = useMemo(() => buildProjectFileTree(files), [files])
  return (
    <ul className="scene-project-info__tree-list" role="tree">
      {tree.map((node) => <ProjectFileTreeNodeView key={node.path} node={node} />)}
    </ul>
  )
}

function ProjectDetailsPanel({
  projectId,
  projectName,
  info,
  loading,
  error,
  onRetry,
}: {
  projectId: string | null
  projectName?: string | null
  info: SceneProjectInfo | null
  loading: boolean
  error: string | null
  onRetry: () => void
}): JSX.Element {
  if (error) {
    return (
      <div className="scene-project-info__empty">
        <span>Project details unavailable: {error}</span>
        <button type="button" className="scene-project-info__retry" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (!projectId) return <div className="scene-project-info__empty">Select or create a project to view its files.</div>
  if (loading || !info) return <div className="scene-project-info__empty">Loading project details…</div>
  return (
    <div className="scene-project-info">
      <header>
        <div>
          <strong>{projectName || info.projectId}</strong>
          <small>{info.projectId}</small>
        </div>
        <span>{info.moduleCount} modules</span>
      </header>
      <div className="scene-project-info__metrics">
        <span><b>{info.sourceMapEntries}</b> mapped entities</span>
        <span><b>{info.canonicalModule}</b> canonical entry</span>
      </div>
      <div className="scene-project-info__tree">
        <div className="scene-project-info__tree-header">
          <small>Project file structure</small>
          <span>{info.files.length} files</span>
        </div>
        <ProjectFileTree files={info.files} />
      </div>
    </div>
  )
}

function DashboardHelp(): JSX.Element {
  return (
    <div className="scene-left-pane__help">
      <div className="scene-left-pane__help-group">
        <div className="scene-left-pane__help-title">{sceneT('controls.help.buildTitle')}</div>
        <ol>
          <li>{sceneT('controls.help.build1')}</li>
          <li>{sceneT('controls.help.build2')}</li>
          <li>{sceneT('controls.help.build3')}</li>
        </ol>
      </div>
      <div className="scene-left-pane__help-group">
        <div className="scene-left-pane__help-title">{sceneT('controls.help.inspectTitle')}</div>
        <ul>
          <li>{sceneT('controls.help.inspect1')}</li>
          <li>{sceneT('controls.help.inspect2')}</li>
          <li>{sceneT('controls.help.inspect3')}</li>
        </ul>
      </div>
      <div className="scene-left-pane__help-group">
        <div className="scene-left-pane__help-title">{sceneT('controls.help.previewTitle')}</div>
        <ul>
          <li>{sceneT('controls.help.preview1')}</li>
          <li>{sceneT('controls.help.preview2')}</li>
        </ul>
      </div>
      <div className="scene-left-pane__help-group">
        <div className="scene-left-pane__help-title">{sceneT('controls.help.projectsTitle')}</div>
        <ul>
          <li>{sceneT('controls.help.projects1')}</li>
          <li>{sceneT('controls.help.projects2')}</li>
        </ul>
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
  projectId = null,
}: {
  mirror: EditorMirrorSnapshot | null
  domainPortTypes?: DomainPortTypes
  en: boolean
  projectId?: string | null
}): JSX.Element {
  const stats = mirror?.stats
  const node = mirror?.selectedNode ?? null
  const diagnosticCodes = useSceneScriptDiagnosticCodes(projectId, node?.id ?? null)
  return (
    <div className="scene-node-info">
      <div className="scene-node-info__stats">
        <NodeInfoStat label={sceneT('controls.stats.batteries')} value={stats?.batteryCount ?? 0} />
        <NodeInfoStat label={sceneT('controls.stats.links')} value={stats?.edgeCount ?? 0} />
        <NodeInfoStat label={sceneT('controls.stats.notes')} value={stats?.annotationCount ?? 0} />
        <NodeInfoStat label={sceneT('controls.stats.groups')} value={stats?.groupCount ?? 0} />
        <NodeInfoStat label={sceneT('controls.stats.frames')} value={stats?.frameCount ?? 0} />
        <NodeInfoStat label={sceneT('controls.stats.selected')} value={stats?.selectedCount ?? 0} />
      </div>
      {node ? (
        <>
          <SelectedBatteryDiagram node={node} domainPortTypes={domainPortTypes} en={en} />
          {diagnosticCodes.length > 0 && (
            <div className="scene-node-info__diagnostics" aria-label="Selected node Scene Script diagnostics">
              <small>Scene Script</small>
              {diagnosticCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
          )}
        </>
      ) : (
        <div className="scene-node-info__empty">
          {sceneT('controls.noSelection')}
        </div>
      )}
    </div>
  )
}

function contentSchemaFromPorts(node: SelectedNodeView): string | null {
  const types = new Set([...node.outputs, ...node.inputs].map((port) => port.type))
  if (types.has('mesh')) return 'mesh'
  if (types.has('scene') || types.has('voxel_layers')) return 'voxel'
  if (types.has('grid')) return 'grid'
  return null
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

  const contentSchema = contentSchemaFromPorts(node)

  return (
    <div className="scene-node-info__diagram">
      <div className="ni-node">
        <div className="ni-node__title" title={node.name}>
          {en ? node.batteryNameEn || node.batteryName || node.name : node.batteryName || node.name}
        </div>
        <div className="ni-node__ports" ref={portsRef}>
          <div className="ni-node__col ni-node__col--in">
            {node.inputs.length === 0 ? (
              <div className="ni-node__empty">{sceneT('controls.noInputs')}</div>
            ) : (
              node.inputs.map((port) => (
                <PortRow key={`in:${port.name}`} port={port} side="in" en={en} domainPortTypes={domainPortTypes} />
              ))
            )}
          </div>
          <div className="ni-node__col ni-node__col--out">
            {node.outputs.length === 0 ? (
              <div className="ni-node__empty">{sceneT('controls.noOutputs')}</div>
            ) : (
              node.outputs.map((port) => (
                <PortRow key={`out:${port.name}`} port={port} side="out" en={en} domainPortTypes={domainPortTypes} />
              ))
            )}
          </div>
        </div>
      </div>
      <section className="scene-node-info__details" aria-label="Selected node details">
        <header className="scene-node-info__details-heading">
          <span>Node details</span>
          {node.sceneScriptStatus && node.sceneScriptStatus !== 'legacy' && (
            <strong className={`scene-node-info__status-chip scene-node-info__status-chip--${node.sceneScriptStatus}`}>
              {node.sceneScriptStatus === 'equivalence-verified' ? 'Equivalent' : 'Scene Script'}
            </strong>
          )}
        </header>
        <div className="scene-node-info__provenance">
          <div><small>Identity</small><span title={node.id}>{node.id}</span></div>
          <div><small>Runtime</small><span title={node.batteryId}>{node.batteryId}</span></div>
          {contentSchema && (
            <div>
              <small>Schema</small>
              <code data-content-schema={contentSchema}>schema: {contentSchema}</code>
            </div>
          )}
          {node.sceneScriptFunctionName && <div><small>Contract</small><span>{node.sceneScriptFunctionName}()</span></div>}
          {node.sourcePath && <div><small>Source</small><span title={node.sourcePath}>{node.sourcePath}</span></div>}
        </div>
        {node.sceneScriptStatus && node.sceneScriptStatus !== 'legacy' && (
          <div className="scene-node-info__scene-status">
            {node.sceneScriptMissingGates?.length ? (
              <small>Pending acceptance: {node.sceneScriptMissingGates.join(', ')}</small>
            ) : (
              <small>All acceptance gates passed</small>
            )}
          </div>
        )}
        {node.sourceFiles?.length ? (
          <div className="scene-node-info__source-tree" aria-label="Local source files">
            <small>Local file structure</small>
            <div className="scene-node-info__source-files">
              {node.sourceFiles.map((entry) => {
                const [kind, ...name] = entry.split(':')
                return <span key={entry}>{kind === 'dir' ? '▸ ' : '· '}{name.join(':')}</span>
              })}
            </div>
          </div>
        ) : null}
      </section>
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
    return { label: sceneT('controls.gridLabel'), detail: m ? m[1] : text }
  }
  return { label: sceneT('controls.valueLabel'), detail: text }
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
