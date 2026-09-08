import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  parsePoint2dList,
  pointsContent,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js'

export function pointsToNode(input: Record<string, unknown>): {
  scene?: ScenePortValue
  points: ReturnType<typeof parsePoint2dList>
  pointCount: number
  error?: string
} {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { points: [], pointCount: 0, error: 'name is required' }
  const points = parsePoint2dList(input.points)
  if (points.length === 0) return { points: [], pointCount: 0, error: 'points are required' }
  const style = typeof input.style === 'string' ? input.style.trim() : ''
  const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
    {
      name: rawName,
      schema: 'points',
      content: pointsContent(points),
      ...(style ? { attributes: { guideStyle: style } } : {}),
    },
  ])
  return { scene: makeScenePort(graph, ids[0]!), points, pointCount: points.length }
}
