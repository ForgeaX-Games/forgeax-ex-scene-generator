import { useSyncExternalStore } from 'react'

import type {
  SceneScriptDiagnostic,
  SceneResultLineage,
  SceneScriptSourceMapEntry,
} from '../api/HttpApiClient.js'
import {
  layerKeysForSceneNodePointers,
  type DisplayIndex,
  type SceneNodePointer,
} from '../renderer/framework/displayIndex.js'
import { commitStageSelect } from '../renderer/bridge/stageSelectBridge.js'

const STORAGE_KEY = 'scene-generator.scene-script-diagnostics'
const CHANGE_EVENT = 'scene-generator:scene-script-diagnostics'
const FOCUS_EVENT = 'scene-generator:scene-script-diagnostic-focus'

export interface SceneScriptDiagnosticEntry {
  statementId: string
  entityIds: string[]
  codes: string[]
  items: SceneScriptDiagnostic[]
  sceneNodes: SceneNodePointer[]
}

export interface SceneScriptDiagnosticIndex {
  projectId: string
  projectRevision?: string
  entries: SceneScriptDiagnosticEntry[]
}

const EMPTY_INDEX: SceneScriptDiagnosticIndex = { projectId: '', entries: [] }

function readStoredIndex(): SceneScriptDiagnosticIndex {
  if (typeof localStorage === 'undefined') return EMPTY_INDEX
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SceneScriptDiagnosticIndex | null
    return parsed?.projectId && Array.isArray(parsed.entries) ? parsed : EMPTY_INDEX
  } catch {
    return EMPTY_INDEX
  }
}

let currentIndex = readStoredIndex()
let boundRevision: { projectId: string; projectRevision: string } | null = null
let currentDisplayIndex: DisplayIndex = { drawables: [] }
let focusedLayerKey: string | null = null

export function sceneNodePointersForDiagnostic(
  diagnostic: SceneScriptDiagnostic,
  lineage: readonly SceneResultLineage[],
): SceneNodePointer[] {
  const statementId =
    diagnostic.graph?.authoringNodeId
    ?? diagnostic.source?.statementId
    ?? diagnostic.statementId
  const runtimeIds = new Set(diagnostic.graph?.runtimeNodeIds ?? [])
  const sceneIds = new Set(diagnostic.graph?.sceneNodeIds ?? [])
  const pointers = lineage
    .filter((entry) =>
      (statementId !== undefined && entry.authoring.statementId === statementId)
      || runtimeIds.has(entry.runtime.nodeId))
    .flatMap((entry) => entry.sceneNodes)
    .filter((node) => sceneIds.size === 0 || sceneIds.has(node.id))
  return [...new Map(pointers.map((node) => [
    `${node.graphIndex ?? 0}\0${node.id}\0${node.path}`,
    { id: node.id, path: node.path, ...(node.graphIndex === undefined ? {} : { graphIndex: node.graphIndex }) },
  ])).values()]
}

export function publishSceneScriptDiagnostics(
  projectId: string,
  diagnostics: readonly SceneScriptDiagnostic[],
  sourceMap: readonly SceneScriptSourceMapEntry[],
  lineage: readonly SceneResultLineage[] = [],
): void {
  const diagnosticsByStatement = new Map<string, {
    codes: string[]
    items: SceneScriptDiagnostic[]
    sceneNodes: SceneNodePointer[]
  }>()
  for (const diagnostic of diagnostics) {
    const statementId =
      diagnostic.graph?.authoringNodeId ??
      diagnostic.source?.statementId ??
      diagnostic.statementId ??
      diagnostic.graph?.runtimeNodeIds?.[0] ??
      `__project__:${diagnostic.code}`
    const entry = diagnosticsByStatement.get(statementId) ?? { codes: [], items: [], sceneNodes: [] }
    const codes = entry.codes
    if (!codes.includes(diagnostic.code)) codes.push(diagnostic.code)
    entry.items.push(diagnostic)
    const pointers = sceneNodePointersForDiagnostic(diagnostic, lineage)
    const seen = new Set(entry.sceneNodes.map((node) => `${node.graphIndex ?? 0}\0${node.id}\0${node.path ?? ''}`))
    for (const pointer of pointers) {
      const key = `${pointer.graphIndex ?? 0}\0${pointer.id}\0${pointer.path ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        entry.sceneNodes.push(pointer)
      }
    }
    diagnosticsByStatement.set(statementId, entry)
  }
  const projectRevision = boundRevision?.projectId === projectId
    ? boundRevision.projectRevision
    : currentIndex.projectId === projectId
      ? currentIndex.projectRevision
      : undefined
  currentIndex = {
    projectId,
    ...(projectRevision ? { projectRevision } : {}),
    entries: [...diagnosticsByStatement].map(([statementId, diagnosticEntry]) => {
      const sourceEntry = sourceMap.find((entry) => entry.statementId === statementId)
      const fallbackIds = [
        statementId,
        ...(diagnosticEntry.items.flatMap((item) => item.graph?.runtimeNodeIds ?? [])),
      ]
      return {
        statementId,
        codes: diagnosticEntry.codes,
        items: diagnosticEntry.items,
        sceneNodes: diagnosticEntry.sceneNodes,
        entityIds: [...new Set(
          sourceEntry
            ? [sourceEntry.entityId, ...sourceEntry.runtimeNodeIds, statementId]
            : fallbackIds,
        )],
      }
    }),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIndex))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Diagnostics remain available in this frame even when storage is disabled.
  }
}

/** Drop dock rows that belong to a previous Scene Script revision. */
export function bindSceneScriptDiagnosticRevision(projectId: string, projectRevision: string): void {
  boundRevision = { projectId, projectRevision }
  const stored = currentIndex.projectId ? currentIndex : readStoredIndex()
  if (stored.projectId === projectId && stored.projectRevision === projectRevision) return
  publishSceneScriptDiagnostics(projectId, [], [])
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const refresh = (): void => {
    currentIndex = readStoredIndex()
    listener()
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener('storage', refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener('storage', refresh)
  }
}

function getSnapshot(): SceneScriptDiagnosticIndex {
  return currentIndex
}

export function readSceneScriptDiagnosticIndex(): SceneScriptDiagnosticIndex {
  return currentIndex
}

export function useSceneScriptDiagnosticCodes(
  projectId: string | null,
  entityId: string | null,
): string[] {
  return useSceneScriptDiagnosticItems(projectId, entityId).map((item) => item.code)
}

export function useSceneScriptDiagnosticItems(
  projectId: string | null,
  entityId: string | null,
): SceneScriptDiagnostic[] {
  const index = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_INDEX)
  if (!projectId || !entityId || index.projectId !== projectId) return []
  return index.entries.find((entry) => entry.entityIds.includes(entityId))?.items ?? []
}

export function useAllSceneScriptDiagnostics(projectId: string | null): SceneScriptDiagnostic[] {
  const index = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_INDEX)
  if (!projectId || index.projectId !== projectId) return []
  return index.entries.flatMap((entry) => entry.items)
}

export function registerSceneScriptDiagnosticDisplayIndex(index: DisplayIndex): void {
  currentDisplayIndex = index
}

export function useSceneScriptDiagnosticLayerKeys(index: DisplayIndex): string[] {
  const diagnosticIndex = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_INDEX)
  return layerKeysForSceneNodePointers(index, diagnosticIndex.entries.flatMap((entry) => entry.sceneNodes ?? []))
}

export function focusSceneScriptDiagnostic(
  diagnostic: SceneScriptDiagnostic,
  lineage: readonly SceneResultLineage[] = [],
): string | undefined {
  const direct = sceneNodePointersForDiagnostic(diagnostic, lineage)
  const statementId =
    diagnostic.graph?.authoringNodeId
    ?? diagnostic.source?.statementId
    ?? diagnostic.statementId
  const pointers = direct.length > 0
    ? direct
    : currentIndex.entries
        .filter((entry) =>
          entry.codes.includes(diagnostic.code)
          && (statementId === undefined || entry.statementId === statementId))
        .flatMap((entry) => entry.sceneNodes ?? [])
  const layerKey = layerKeysForSceneNodePointers(currentDisplayIndex, pointers)[0]
  if (!layerKey) return undefined
  focusedLayerKey = layerKey
  commitStageSelect([layerKey])
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FOCUS_EVENT))
  return layerKey
}

function subscribeFocus(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(FOCUS_EVENT, listener)
  return () => window.removeEventListener(FOCUS_EVENT, listener)
}

export function useSceneScriptDiagnosticFocusLayerKey(): string | null {
  return useSyncExternalStore(subscribeFocus, () => focusedLayerKey, () => null)
}
