type GuideParamCommit = (nodeId: string, key: string, value: unknown, silent?: boolean) => void
type GuideParamsCommit = (edits: Array<{ nodeId: string; key: string; value: unknown }>) => void

let _commit: GuideParamCommit | null = null
let _commitMany: GuideParamsCommit | null = null
let _resetDocument: (() => void) | null = null

export function registerGuideParamCommit(
  commit: GuideParamCommit | null,
  commitMany?: GuideParamsCommit | null,
): void {
  _commit = commit
  _commitMany = commitMany ?? null
}

export function registerDocumentReset(reset: (() => void) | null): void {
  _resetDocument = reset
}

export function requestDocumentReset(): void {
  _resetDocument?.()
}

export function commitGuideParam(nodeId: string, key: string, value: unknown, silent = false): void {
  _commit?.(nodeId, key, value, silent)
}

export function commitGuideParams(edits: Array<{ nodeId: string; key: string; value: unknown }>): void {
  if (edits.length === 0) return
  if (_commitMany) {
    _commitMany(edits)
    return
  }
  const byNode = new Map<string, Array<{ nodeId: string; key: string; value: unknown }>>()
  for (const edit of edits) {
    const list = byNode.get(edit.nodeId) ?? []
    list.push(edit)
    byNode.set(edit.nodeId, list)
  }
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) {
      const edit = list[i]!
      commitGuideParam(edit.nodeId, edit.key, edit.value, i < list.length - 1)
    }
  }
}
