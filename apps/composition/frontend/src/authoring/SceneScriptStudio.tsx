import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePipelineStore } from '@forgeax/node-runtime-react/editor'

import {
  SceneScriptRequestError,
  type HttpApiClient,
  type SceneResultLineage,
  type SceneScriptDraftRequest,
  type SceneScriptDraftResult,
  type SceneScriptDraftStatus,
  type SceneScriptDiagnostic,
  type SceneScriptDiagnosticFix,
  type SceneScriptSourceMapEntry,
  type SceneScriptSourceRange,
} from '../api/HttpApiClient.js'
import { focusSceneScriptDiagnostic, publishSceneScriptDiagnostics } from './sceneScriptDiagnosticBridge.js'
import { SceneScriptDiffPanel } from './SceneScriptDiffPanel.js'
import {
  diffSemanticGraph,
  diffTextLines,
  digestPngDataUrl,
  type PreviewCapture,
  type SceneDiffEvidence,
  type SemanticGraphDiff,
} from './sceneScriptDiff.js'
import './SceneScriptStudio.css'

type ProjectInfo = Awaited<ReturnType<HttpApiClient['getSceneScriptProjectInfo']>>
type DraftDisplayStatus = 'committed' | SceneScriptDraftStatus

interface DraftDisplayState {
  status: DraftDisplayStatus
  projectRevision: string
  previewRevision: string | null
  lastGoodPreviewRevision: string | null
}

interface QueuedDraft {
  request: SceneScriptDraftRequest
  projectId: string
}

interface SceneScriptStudioProps {
  client: HttpApiClient
  projectId: string
  capturePreview: () => Promise<PreviewCapture>
  expanded?: boolean
  onToggleExpanded?: () => void
  onClose?: () => void
}

function diagnosticLabel(diagnostic: SceneScriptDiagnostic): string {
  const source = diagnostic.source
  const end = source?.endLine
    ? `-${source.endLine}:${source.endColumn ?? source.column}`
    : ''
  const location = source
    ? `${source.file}:${source.line}:${source.column}${end} [${source.start}-${source.end}]`
    : ''
  return [diagnostic.severity, diagnostic.phase, diagnostic.code, location].filter(Boolean).join(' · ')
}

function evidence(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isSafeFix(fix: SceneScriptDiagnosticFix): boolean {
  return fix.edits.length > 0 && fix.edits.every((edit) => edit.type === 'ReplaceReference')
}

function entryAt(
  sourceMap: readonly SceneScriptSourceMapEntry[],
  file: string,
  offset: number,
): SceneScriptSourceMapEntry | undefined {
  return sourceMap
    .filter((entry) => entry.source.file === file && entry.source.start <= offset && offset <= entry.source.end)
    .sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
}

function layoutRangeMark(textarea: HTMLTextAreaElement, range: SceneScriptSourceRange): { top: number; height: number } {
  const styles = getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 19
  const paddingTop = Number.parseFloat(styles.paddingTop) || 14
  const startLine = textarea.value.slice(0, range.start).split("\n").length - 1
  const endLine = Math.max(startLine, textarea.value.slice(0, range.end).split("\n").length - 1)
  return {
    top: paddingTop + startLine * lineHeight - textarea.scrollTop,
    height: Math.max(lineHeight, (endLine - startLine + 1) * lineHeight),
  }
}

export function SceneScriptStudio({
  client,
  projectId,
  capturePreview,
  expanded = false,
  onToggleExpanded,
  onClose,
}: SceneScriptStudioProps): JSX.Element {
  const selectedNodeIds = usePipelineStore((state) => state.selectedNodeIds)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionFromCodeRef = useRef<string | null>(null)
  const highlightedRangeRef = useRef<SceneScriptSourceRange | null>(null)
  const [rangeMark, setRangeMark] = useState<{ top: number; height: number } | null>(null)
  const draftIdRef = useRef(`studio-${projectId}-${Math.random().toString(36).slice(2)}`)
  const draftGenerationRef = useRef(0)
  const draftInFlightRef = useRef(false)
  const queuedDraftRef = useRef<QueuedDraft | null>(null)
  const lastGoodPreviewRevisionRef = useRef<string | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [file, setFile] = useState('')
  const [source, setSource] = useState('')
  const [revision, setRevision] = useState('')
  const [savedSource, setSavedSource] = useState('')
  const [sourceMap, setSourceMap] = useState<SceneScriptSourceMapEntry[]>([])
  const [resultLineage, setResultLineage] = useState<SceneResultLineage[]>([])
  const [diagnostics, setDiagnostics] = useState<SceneScriptDiagnostic[]>([])
  const [diagnosticsReady, setDiagnosticsReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyingFix, setApplyingFix] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ expected?: string; actual?: string } | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [draftGraphDiff, setDraftGraphDiff] = useState<SemanticGraphDiff | null>(null)
  const [acceptedEvidence, setAcceptedEvidence] = useState<SceneDiffEvidence | null>(null)
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(true)
  const [remoteStale, setRemoteStale] = useState(false)
  const [draftState, setDraftState] = useState<DraftDisplayState>({
    status: 'committed',
    projectRevision: '',
    previewRevision: null,
    lastGoodPreviewRevision: null,
  })

  const dirty = source !== savedSource
  const validating = draftState.status === 'compiling'
  const dirtyRef = useRef(dirty)
  const fileRef = useRef(file)
  const loadingRef = useRef(loading)
  const pendingGraphReloadRef = useRef(false)
  dirtyRef.current = dirty
  fileRef.current = file
  loadingRef.current = loading
  const draftTextDiff = useMemo(() => diffTextLines(savedSource, source), [savedSource, source])
  const moduleFiles = useMemo(
    () => projectInfo?.files.filter((item) => item.kind === 'module' || item.kind === 'generator' || item.kind === 'helper' || item.kind === 'material') ?? [],
    [projectInfo],
  )
  useEffect(() => {
    if (!diagnosticsReady) return
    publishSceneScriptDiagnostics(projectId, diagnostics, sourceMap, resultLineage)
  }, [diagnosticsReady, projectId, resultLineage, sourceMap, diagnostics])

  const selectRange = useCallback((range: SceneScriptSourceRange, opts?: { takeFocus?: boolean }) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      // Canvas Delete is bound to the React Flow pane. Focusing this projection
      // after a node click ate Delete and only removed the highlighted text.
      if (opts?.takeFocus) textarea.focus()
      else if (document.activeElement === textarea) textarea.blur()
      textarea.setSelectionRange(range.start, range.end)
      const before = textarea.value.slice(0, range.start)
      const line = before.split('\n').length - 1
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 19
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3)
      highlightedRangeRef.current = range
      setRangeMark(layoutRangeMark(textarea, range))
    })
  }, [])

  const clearRangeMark = useCallback(() => {
    highlightedRangeRef.current = null
    setRangeMark(null)
  }, [])

  const syncRangeMark = useCallback(() => {
    const textarea = textareaRef.current
    const range = highlightedRangeRef.current
    if (!textarea || !range) return
    setRangeMark(layoutRangeMark(textarea, range))
  }, [])

  const loadFile = useCallback(async (
    nextFile: string,
    range?: SceneScriptSourceRange,
    opts?: { silent?: boolean; takeFocus?: boolean },
  ) => {
    draftGenerationRef.current += 1
    queuedDraftRef.current = null
    if (!opts?.silent) setLoading(true)
    setNotice(null)
    setConflict(null)
    setRemoteStale(false)
    try {
      const module = await client.getSceneScriptModule(nextFile, projectId)
      setFile(module.file)
      setSource(module.source)
      setSavedSource(module.source)
      setRevision(module.revision)
      const nextSourceMap = module.state?.sourceMap ?? []
      setResultLineage(module.state?.resultLineage ?? [])
      setSourceMap(nextSourceMap)
      setDiagnostics([])
      setDiagnosticsReady(false)
      setDraftGraphDiff(null)
      setAcceptedEvidence(null)
      setDraftState((current) => ({
        status: 'committed',
        projectRevision: current.projectRevision,
        previewRevision: null,
        lastGoodPreviewRevision: current.lastGoodPreviewRevision,
      }))
      if (range) selectRange(range, { takeFocus: opts?.takeFocus ?? true })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [client, projectId, selectRange])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProjectInfo(null)
    setFile('')
    setSource('')
    setSavedSource('')
    setRevision('')
    setSourceMap([])
    setResultLineage([])
    setDiagnostics([])
    setDiagnosticsReady(false)
    setConflict(null)
    setNotice(null)
    setDraftGraphDiff(null)
    setAcceptedEvidence(null)
    draftIdRef.current = `studio-${projectId}-${Math.random().toString(36).slice(2)}`
    draftGenerationRef.current += 1
    queuedDraftRef.current = null
    lastGoodPreviewRevisionRef.current = null
    setDraftState({
      status: 'committed',
      projectRevision: '',
      previewRevision: null,
      lastGoodPreviewRevision: null,
    })
    void client.getSceneScriptProjectInfo(projectId)
      .then(async (info) => {
        if (cancelled) return
        setProjectInfo(info)
        setDraftState((current) => ({
          ...current,
          projectRevision: info.projectRevision ?? info.revision,
        }))
        await loadFile(info.canonicalModule)
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : String(error))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [client, loadFile, projectId])

  useEffect(() => {
    if (loading || !file || dirty || !pendingGraphReloadRef.current) return
    pendingGraphReloadRef.current = false
    void loadFile(file, undefined, { silent: true })
    void client.getSceneScriptProjectInfo(projectId).then(setProjectInfo).catch(() => undefined)
  }, [client, dirty, file, loadFile, loading, projectId])

  useEffect(() => {
    // Visual canvas edits rewrite canonical source through the authoring
    // adapter. Reload the open file from that write instead of waiting for
    // the panel to unmount. Debounce so slider ticks collapse to one fetch.
    let timer: ReturnType<typeof setTimeout> | null = null
    if (typeof client.subscribe !== 'function') return
    const unsub = client.subscribe('graph', (event) => {
      if (event.kind !== 'graph:applied') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const currentFile = fileRef.current
        if (!currentFile || loadingRef.current) {
          pendingGraphReloadRef.current = true
          return
        }
        if (dirtyRef.current) {
          setRemoteStale(true)
          setNotice('Canvas edits updated the saved Scene Script. Local unsaved text was kept.')
          return
        }
        void loadFile(currentFile, undefined, { silent: true })
        void client.getSceneScriptProjectInfo(projectId).then(setProjectInfo).catch(() => undefined)
      }, 400)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [client, loadFile, projectId])

  const applyDraftResult = useCallback((
    request: SceneScriptDraftRequest,
    result: SceneScriptDraftResult,
  ) => {
    if (request.generation !== draftGenerationRef.current) return
    const projectRevision =
      result.projectRevision ?? result.sync?.projectRevision ?? request.expectedProjectRevision
    const previewRevision = result.previewRevision ?? result.sync?.previewRevision ?? null
    const responseLastGood = result.lastGood?.previewRevision ?? null
    if (result.status === 'visible' && result.valid && previewRevision) {
      lastGoodPreviewRevisionRef.current = previewRevision
    } else if (responseLastGood) {
      lastGoodPreviewRevisionRef.current = responseLastGood
    }
    setDiagnostics(result.diagnostics)
    setDiagnosticsReady(true)
    setDraftState({
      status: result.status,
      projectRevision,
      previewRevision,
      lastGoodPreviewRevision: lastGoodPreviewRevisionRef.current,
    })
    setNotice(result.valid ? null : 'Scene Script draft failed. The last good preview remains visible.')
  }, [])

  const submitDraft = useCallback(async (initial: SceneScriptDraftRequest, targetProjectId: string) => {
    if (draftInFlightRef.current) {
      queuedDraftRef.current = { request: initial, projectId: targetProjectId }
      return
    }
    draftInFlightRef.current = true
    let job: QueuedDraft | null = { request: initial, projectId: targetProjectId }
    try {
      while (job) {
        queuedDraftRef.current = null
        const { request, projectId: requestProjectId } = job
        if (request.generation === draftGenerationRef.current) {
          setDraftState((current) => ({ ...current, status: 'compiling' }))
        }
        try {
          const result = await client.executeSceneScriptDraft(request, requestProjectId)
          applyDraftResult(request, result)
        } catch (error) {
          if (request.generation === draftGenerationRef.current) {
            setDraftState((current) => ({
              ...current,
              status: 'failed',
              lastGoodPreviewRevision: lastGoodPreviewRevisionRef.current,
            }))
            setNotice(
              `Draft failed; the last good preview remains visible. ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }
        }
        job = queuedDraftRef.current
      }
    } finally {
      draftInFlightRef.current = false
    }
  }, [applyDraftResult, client])

  const executeDraft = useCallback((nextSource = source, requestedGeneration?: number) => {
    if (!file || !projectInfo) return
    if (requestedGeneration !== undefined && requestedGeneration !== draftGenerationRef.current) return
    const request: SceneScriptDraftRequest = {
      files: [{ file, source: nextSource }],
      entryFile: projectInfo.canonicalModule,
      expectedProjectRevision: projectInfo.projectRevision ?? projectInfo.revision,
      execute: true,
      draftId: draftIdRef.current,
      generation: requestedGeneration ?? ++draftGenerationRef.current,
    }
    if (draftInFlightRef.current) {
      queuedDraftRef.current = { request, projectId }
      setDraftState((current) => ({ ...current, status: 'compiling' }))
      return
    }
    void submitDraft(request, projectId)
  }, [file, projectInfo, source, submitDraft])

  useEffect(() => {
    if (!file || loading || !dirty) return
    // Invalidate any older response as soon as text changes, not 450 ms later
    // when this generation is actually submitted.
    const generation = ++draftGenerationRef.current
    setDraftState((current) => ({ ...current, status: 'compiling' }))
    const timer = setTimeout(() => { executeDraft(source, generation) }, 450)
    return () => clearTimeout(timer)
  }, [dirty, executeDraft, file, loading, source])

  const save = useCallback(async () => {
    if (!file || saving) return
    setSaving(true)
    setNotice(null)
    setConflict(null)
    const transactionId = `save-${Date.now().toString(36)}`
    const beforeRevision = revision
    const beforeSource = savedSource
    let beforeGraph: Awaited<ReturnType<HttpApiClient['getSceneGraphSample']>>
    let beforePreview: PreviewCapture
    try {
      ;[beforeGraph, beforePreview] = await Promise.all([
        client.getSceneGraphSample(projectId),
        capturePreview(),
      ])
    } catch (error) {
      setNotice(`Save not started: unable to capture baseline evidence — ${error instanceof Error ? error.message : String(error)}`)
      setSaving(false)
      return
    }
    try {
      const result = await client.saveSceneScript({
        file,
        source,
        expectedRevision: revision,
        label: `Edit ${file} in Code`,
      }, projectId)
      setSource(result.canonicalSource)
      setSavedSource(result.canonicalSource)
      setRevision(result.revision)
      setProjectInfo((current) => current ? {
        ...current,
        revision: result.revision,
        projectRevision: result.projectRevision ?? result.revision,
      } : current)
      setSourceMap(result.sourceMap)
      setDiagnostics(result.diagnostics)
      setDiagnosticsReady(true)
      setDraftGraphDiff(null)
      draftGenerationRef.current += 1
      queuedDraftRef.current = null
      setDraftState((current) => ({
        ...current,
        status: 'committed',
        projectRevision: result.projectRevision ?? result.revision,
        previewRevision: null,
      }))
      const executed = await client.execute({ quietErrors: true })
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const info = await client.getRendererInfo().catch(() => null)
        const sync = info?.sync
        if (
          sync?.executionId === executed.executionId
          || (sync?.executionStatus === 'completed' && attempt > 1)
        ) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      try {
        const [afterGraph, afterPreview] = await Promise.all([
          client.getSceneGraphSample(projectId),
          capturePreview(),
        ])
        const beforeDigest = digestPngDataUrl(beforePreview.dataUrl)
        const afterDigest = digestPngDataUrl(afterPreview.dataUrl)
        setAcceptedEvidence({
          transactionId,
          file,
          beforeRevision,
          afterRevision: result.revision,
          acceptedAt: new Date().toISOString(),
          text: diffTextLines(beforeSource, result.canonicalSource),
          graph: diffSemanticGraph(beforeGraph, afterGraph, result.sourceMap),
          preview: {
            before: { ...beforePreview, digest: beforeDigest },
            after: { ...afterPreview, digest: afterDigest },
            status: beforeDigest === afterDigest ? 'unchanged' : 'changed',
          },
        })
        setDiffOpen(true)
        setNotice('Saved, executed, and captured transaction evidence.')
      } catch (error) {
        setNotice(
          `Saved as ${result.revision.slice(0, 8)}, but evidence capture failed; the previous accepted evidence was kept. ` +
          (error instanceof Error ? error.message : String(error)),
        )
      }
    } catch (error) {
      if (error instanceof SceneScriptRequestError) {
        setDiagnostics(error.diagnostics)
        setDiagnosticsReady(true)
        if (error.status === 409) {
          setConflict({ expected: error.expectedRevision, actual: error.actualRevision })
          setNotice('Save conflict: the remote file changed. Your local edits were kept and were not uploaded.')
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }, [capturePreview, client, file, projectId, revision, savedSource, saving, source])

  useEffect(() => {
    const selected = selectedNodeIds[0]
    if (!selected) {
      selectionFromCodeRef.current = null
      clearRangeMark()
      return
    }
    if (selected === selectionFromCodeRef.current) {
      selectionFromCodeRef.current = null
      return
    }
    const entry = sourceMap.find(
      (candidate) => candidate.entityId === selected || candidate.runtimeNodeIds.includes(selected),
    )
    if (!entry) {
      clearRangeMark()
      return
    }
    if (entry.source.file !== file) {
      if (dirty) {
        setNotice(`Selected node is in ${entry.source.file}. Save or discard local edits before switching files.`)
        return
      }
      void loadFile(entry.source.file, entry.source, { takeFocus: false })
      return
    }
    selectRange(entry.source)
  }, [clearRangeMark, dirty, file, loadFile, selectRange, selectedNodeIds, sourceMap])

  const selectNodeFromCursor = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const entry = entryAt(sourceMap, file, textarea.selectionStart)
    if (!entry) return
    selectionFromCodeRef.current = entry.entityId
    usePipelineStore.getState().requestSelectNodes([entry.entityId])
  }, [file, sourceMap])

  const chooseFile = useCallback((nextFile: string) => {
    if (nextFile === file) return
    if (dirty && !window.confirm(`Discard unsaved changes in ${file}?`)) return
    void loadFile(nextFile)
  }, [dirty, file, loadFile])

  const openDiagnostic = useCallback((diagnostic: SceneScriptDiagnostic) => {
    focusSceneScriptDiagnostic(diagnostic, resultLineage)
    const statementId =
      diagnostic.graph?.authoringNodeId ??
      diagnostic.source?.statementId ??
      diagnostic.statementId
    const mapped = statementId
      ? sourceMap.find((entry) => entry.statementId === statementId)
      : undefined
    const nodeIds = mapped
      ? [mapped.entityId]
      : (diagnostic.graph?.runtimeNodeIds ?? [])
    if (nodeIds.length) {
      selectionFromCodeRef.current = nodeIds[0]
      usePipelineStore.getState().requestSelectNodes(nodeIds)
    }
    if (!diagnostic.source) return
    const range = diagnostic.source
    if (range.file !== file) {
      if (dirty && !window.confirm(`Discard unsaved changes in ${file}?`)) return
      void loadFile(range.file, range, { takeFocus: true })
    } else {
      selectRange(range, { takeFocus: true })
    }
  }, [dirty, file, loadFile, resultLineage, selectRange, sourceMap])

  const applyFix = useCallback(async (fix: SceneScriptDiagnosticFix) => {
    if (!file || applyingFix || !isSafeFix(fix)) return
    setApplyingFix(fix.fixId)
    setConflict(null)
    setNotice(null)
    try {
      const result = await client.applySceneScriptFix({
        file,
        expectedRevision: revision,
        fix,
      }, projectId)
      setSource(result.canonicalSource)
      setSavedSource(result.canonicalSource)
      setRevision(result.revision)
      setSourceMap(result.sourceMap)
      setDiagnostics(result.diagnostics)
      setDiagnosticsReady(true)
      setDraftGraphDiff(null)
      setNotice(`Applied fix: ${fix.title}`)
    } catch (error) {
      if (error instanceof SceneScriptRequestError) {
        setDiagnostics(error.diagnostics)
        setDiagnosticsReady(true)
        if (error.status === 409) {
          setConflict({ expected: error.expectedRevision, actual: error.actualRevision })
          setNotice('Fix conflict: the remote file changed. Your local edits were kept and were not overwritten.')
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setApplyingFix(null)
    }
  }, [applyingFix, client, file, projectId, revision])

  return (
    <aside
      className={`scene-script-studio${diagnosticsCollapsed ? ' has-collapsed-diagnostics' : ''}`}
      aria-label="Code editor"
    >
      <header className="scene-script-studio__header">
        <div>
          <strong>Code</strong>
          <span className="scene-script-studio__revision" title={revision}>
            Read-only · {dirty ? 'Draft' : 'Committed'}
            {revision ? ` · rev ${revision.slice(0, 8)}` : ''}
          </span>
        </div>
        <div className="scene-script-studio__actions">
          {onToggleExpanded && (
            <button
              type="button"
              aria-label={expanded ? 'Restore compact Code editor' : 'Expand Code editor'}
              title={expanded ? 'Restore the compact code dock' : 'Use the full Scene Script window'}
              onClick={onToggleExpanded}
            >
              {expanded ? 'Compact' : 'Expand'}
            </button>
          )}
          <button type="button" onClick={() => executeDraft()} disabled={!file}>
            Check
          </button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {onClose && <button type="button" aria-label="Close Code editor" onClick={onClose}>×</button>}
        </div>
      </header>

      <label className="scene-script-studio__file">
        <span>Project file</span>
        <select
          aria-label="Scene Script project file"
          value={file}
          disabled={loading}
          onChange={(event) => chooseFile(event.currentTarget.value)}
        >
          {moduleFiles.map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
        </select>
      </label>

      <div className="scene-script-studio__status">
        <div className="scene-script-studio__status-bar">
          <div className="scene-script-studio__notice" role="status">
            {dirty ? 'Draft' : 'Committed'} · {draftState.status}
            {draftState.previewRevision ? ` · preview ${draftState.previewRevision.slice(0, 8)}` : ''}
            {draftState.projectRevision ? ` · project ${draftState.projectRevision.slice(0, 8)}` : ''}
            {draftState.status === 'failed' && draftState.lastGoodPreviewRevision
              ? ` · last good ${draftState.lastGoodPreviewRevision.slice(0, 8)} still visible`
              : ''}
          </div>
          <SceneScriptDiffPanel
            className="scene-diff--status"
            open={diffOpen}
            draftRevision={revision}
            draftText={draftTextDiff}
            draftGraph={draftGraphDiff}
            evidence={acceptedEvidence}
            onToggle={() => setDiffOpen((open) => !open)}
          />
        </div>
        {remoteStale && (
          <div className="scene-script-studio__conflict" role="status">
            Canvas edits updated the saved Scene Script. Local unsaved text was kept.
            <button type="button" onClick={() => {
              if (!dirty || window.confirm('Discard local edits and load the canvas version?')) void loadFile(file)
            }}>
              Reload
            </button>
          </div>
        )}
        {conflict && (
          <div className="scene-script-studio__conflict" role="alert">
            Remote revision {conflict.actual?.slice(0, 8) || 'changed'} conflicts with local base{' '}
            {conflict.expected?.slice(0, 8) || revision.slice(0, 8)}. Local text is preserved.
            <button type="button" onClick={() => {
              if (!dirty || window.confirm('Discard local edits and load the remote revision?')) void loadFile(file)
            }}>
              Load remote
            </button>
          </div>
        )}
        {notice && <div className="scene-script-studio__notice" role="status">{notice}</div>}
      </div>

      <div className="scene-script-studio__editor-shell">
        {rangeMark && (
          <div
            className="scene-script-studio__range-mark"
            style={{ top: rangeMark.top, height: rangeMark.height }}
            aria-hidden
          />
        )}
        <textarea
          ref={textareaRef}
          className="scene-script-studio__editor"
          aria-label="Scene Script source"
          aria-readonly="true"
          value={source}
          readOnly
          disabled={loading}
          spellCheck={false}
          onScroll={syncRangeMark}
          onChange={(event) => {
            setSource(event.currentTarget.value)
            setConflict(null)
            setNotice(null)
            setDraftGraphDiff(null)
          }}
          onClick={selectNodeFromCursor}
          onKeyUp={selectNodeFromCursor}
          onSelect={selectNodeFromCursor}
        />
      </div>

      <section
        className={`scene-script-studio__diagnostics${diagnosticsCollapsed ? ' is-collapsed' : ''}`}
        aria-label="Scene Script diagnostics"
      >
        <button
          type="button"
          className="scene-script-studio__diagnostics-title"
          aria-expanded={!diagnosticsCollapsed}
          onClick={() => setDiagnosticsCollapsed((collapsed) => !collapsed)}
        >
          <span>Diagnostics</span>
          <span>{validating ? '…' : diagnostics.length} · {diagnosticsCollapsed ? 'Show' : 'Hide'}</span>
        </button>
        <div className="scene-script-studio__diagnostics-body">
          {diagnostics.length === 0 ? (
            <p>No parse or compile diagnostics.</p>
          ) : (
            <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.source?.start ?? index}`} data-severity={diagnostic.severity}>
                <button className="scene-script-studio__diagnostic-open" type="button" onClick={() => openDiagnostic(diagnostic)}>
                  <span>{diagnosticLabel(diagnostic)}</span>
                  {diagnostic.message}
                </button>
                <dl className="scene-script-studio__diagnostic-details">
                  {diagnostic.expected !== undefined && <><dt>Expected</dt><dd>{evidence(diagnostic.expected)}</dd></>}
                  {diagnostic.actual !== undefined && <><dt>Actual</dt><dd>{evidence(diagnostic.actual)}</dd></>}
                  {diagnostic.transaction && (
                    <>
                      <dt>Transaction</dt>
                      <dd>
                        applied={String(diagnostic.transaction.applied)} · rolledBack={String(diagnostic.transaction.rolledBack)}
                        {diagnostic.transaction.undoToken ? ` · undo ${diagnostic.transaction.undoToken}` : ''}
                      </dd>
                    </>
                  )}
                  {diagnostic.retryable !== undefined && <><dt>Retryable</dt><dd>{String(diagnostic.retryable)}</dd></>}
                  {diagnostic.escalation && <><dt>Escalation</dt><dd>{diagnostic.escalation}</dd></>}
                  {diagnostic.debugAttachment && <><dt>Debug Attachment</dt><dd><code>{diagnostic.debugAttachment}</code></dd></>}
                </dl>
                {(diagnostic.fixes ?? []).slice(0, 3).map((fix) => (
                  <button
                    className="scene-script-studio__fix"
                    type="button"
                    key={fix.fixId}
                    disabled={!isSafeFix(fix) || applyingFix !== null}
                    title={isSafeFix(fix) ? `Apply ${fix.title}` : 'This fix requires manual source review.'}
                    onClick={() => void applyFix(fix)}
                  >
                    {applyingFix === fix.fixId ? 'Applying…' : `Fix: ${fix.title}`}
                  </button>
                ))}
              </li>
            ))}
            </ul>
          )}
        </div>
      </section>
    </aside>
  )
}
