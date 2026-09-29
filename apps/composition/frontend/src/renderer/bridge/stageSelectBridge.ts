import { useRenderStore } from '../store.js'

type StageSelectCommit = (nodeIds: string[]) => void

let _commit: StageSelectCommit | null = null

/** Layer keys are `nodeId:port`. The kernel editor only understands graph ids. */
export function hostGraphNodeIds(ids: readonly string[]): string[] {
  return ids.filter((id) => typeof id === 'string' && !id.includes(':'))
}

/**
 * Keep a Stage layerKey selection when the editor echoes empty / nothing
 * useful. That echo is what made Control pins vanish after a mesh click.
 */
export function mergeIncomingEditorSelection(
  current: readonly string[],
  incoming: readonly string[],
): string[] | null {
  const stageKeys = current.filter((id) => id.includes(':'))
  if (stageKeys.length > 0 && incoming.length === 0) return null
  return [...incoming]
}

export function registerStageSelect(commit: StageSelectCommit | null): void {
  _commit = commit
}

export function commitStageSelect(nodeIds: string[]): void {
  useRenderStore.getState().setSelectedEditorNodeIds(nodeIds)
  const graphIds = hostGraphNodeIds(nodeIds)
  if (graphIds.length === 0 && nodeIds.length > 0) return
  _commit?.(graphIds)
}
