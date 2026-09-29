const projectedRevision = new Map<string, string>()

export function noteSceneProjection(projectId: string, revision: string): void {
  projectedRevision.set(projectId, revision)
}

export function lastProjectedRevision(projectId: string): string | undefined {
  return projectedRevision.get(projectId)
}

export function clearSceneProjection(projectId: string): void {
  projectedRevision.delete(projectId)
}
