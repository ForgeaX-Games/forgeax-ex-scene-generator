import { createSceneDiagnostic, isSceneTree, type SceneDiagnostic } from '@forgeax/scene-authoring'

import { sceneSourceKind } from './convention.js'
import type { SceneCallRecord } from './host.js'

const GEOMETRY_FNS = new Set(['point2d', 'basePlane', 'polyline2d', 'spline2d', 'polygon2d', 'network2d'])
const NEEDS_GEOMETRY_FNS = new Set(['heightfield'])
const HEIGHTFIELD_FNS = new Set(['heightfield', 'heightfieldSetMask'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function diagnostic(
  code: string,
  message: string,
  file?: string,
  call?: SceneCallRecord,
): SceneDiagnostic {
  const src = call?.source
  return createSceneDiagnostic({
    code,
    phase: 'execute',
    severity: 'warning',
    message,
    operation: 'scene-semantics',
    ...(file || src?.file
      ? {
          source: {
            file: src?.file ?? file ?? '',
            start: 0,
            end: 0,
            line: src?.line ?? 1,
            column: src?.column ?? 1,
            ...(call?.id ? { statementId: call.id } : {}),
          },
        }
      : {}),
  })
}

function lastCall(calls: readonly SceneCallRecord[], name: string): SceneCallRecord | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i]?.functionName === name) return calls[i]
  }
  return undefined
}

function lastNamed(calls: readonly SceneCallRecord[], names: ReadonlySet<string>): SceneCallRecord | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]
    if (call && names.has(call.functionName)) return call
  }
  return undefined
}

function unwrapSceneTree(value: unknown): { graph: unknown; focus: string } | null {
  if (isSceneTree(value)) return value
  if (isRecord(value) && isSceneTree(value.scene)) return value.scene
  return null
}

function lookupNode(graph: unknown, id: string): Record<string, unknown> | null {
  if (!isRecord(graph)) return null
  if (typeof graph.get === 'function') {
    const node = (graph as { get: (key: string) => unknown }).get(id)
    return isRecord(node) ? node : null
  }
  const direct = graph[id]
  if (isRecord(direct)) return direct
  const nodes = graph.nodes
  if (isRecord(nodes) && isRecord(nodes[id])) return nodes[id] as Record<string, unknown>
  return null
}

function childIdsOf(node: Record<string, unknown>): string[] {
  const children = node.children
  if (!children) return []
  if (children instanceof Map) {
    return [...children.values()].filter((id): id is string => typeof id === 'string')
  }
  if (children instanceof Set) {
    return [...children].filter((id): id is string => typeof id === 'string')
  }
  if (isRecord(children)) {
    return Object.values(children).filter((id): id is string => typeof id === 'string')
  }
  return []
}

function contentSchemaOf(node: Record<string, unknown>): 'mesh' | 'voxel' | undefined {
  if (node.schema === 'mesh' || node.schema === 'voxel') return node.schema
  const content = node.content
  if (!isRecord(content)) return undefined
  if (content.schema === 'mesh' || content.schema === 'voxel') return content.schema
  if (
    content.kind === 'empty'
    || content.kind === 'uniform'
    || content.kind === 'dense'
    || content.kind === 'sparse'
  ) {
    return 'voxel'
  }
  if (isRecord(content.mesh) || Array.isArray(content.positions)) return 'mesh'
  if (Array.isArray(content.cells) || isRecord(content.volume)) return 'voxel'
  return undefined
}

function walkSchemas(tree: { graph: unknown; focus: string }): { mesh: boolean; voxel: boolean } {
  const found = { mesh: false, voxel: false }
  const seen = new Set<string>()
  const stack = [tree.focus]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = lookupNode(tree.graph, id)
    if (!node) continue
    const schema = contentSchemaOf(node)
    if (schema === 'mesh') found.mesh = true
    if (schema === 'voxel') found.voxel = true
    if (found.mesh && found.voxel) return found
    stack.push(...childIdsOf(node))
  }
  return found
}

function assembledTree(calls: readonly SceneCallRecord[]): { graph: unknown; focus: string } | null {
  const output = lastCall(calls, 'sceneOutput')
  if (!output) return null
  return unwrapSceneTree(output.result) ?? unwrapSceneTree(output.args.scene)
}

function assembledSchemas(calls: readonly SceneCallRecord[]): { mesh: boolean; voxel: boolean } {
  const tree = assembledTree(calls)
  return tree ? walkSchemas(tree) : { mesh: false, voxel: false }
}

function sceneNodeHungMesh(calls: readonly SceneCallRecord[]): boolean {
  for (const call of calls) {
    if (call.functionName !== 'sceneNode') continue
    if (isRecord(call.result) && call.result.schema === 'mesh') return true
    const tree = unwrapSceneTree(call.result)
    if (tree && walkSchemas(tree).mesh) return true
  }
  return false
}

function isHeightfieldPacket(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.type === 'heightfield') return true
  return isRecord(value.heightfield) && value.heightfield.type === 'heightfield'
}

function traceHasHeightfield(calls: readonly SceneCallRecord[]): boolean {
  return calls.some((call) => (
    HEIGHTFIELD_FNS.has(call.functionName)
    || isHeightfieldPacket(call.result)
  ))
}

function locateUnusedHeightfield(calls: readonly SceneCallRecord[]): SceneCallRecord | undefined {
  return lastCall(calls, 'heightfieldMesh')
    ?? lastNamed(calls, HEIGHTFIELD_FNS)
}

/**
 * Scene-semantic reports from a TypeScript run.
 * These tell the agent what to do next. They are not graph topology gates.
 */
export function diagnoseSceneSemantics(input: {
  files: Record<string, string>
  entryFile: string
  trace: readonly SceneCallRecord[]
}): SceneDiagnostic[] {
  const diagnostics: SceneDiagnostic[] = []
  const byFile = new Map<string, SceneCallRecord[]>()
  for (const call of input.trace) {
    const file = call.source?.file ?? input.entryFile
    const list = byFile.get(file) ?? []
    list.push(call)
    byFile.set(file, list)
  }

  for (const [file, calls] of byFile) {
    if (sceneSourceKind(file) !== 'scene') continue
    const names = calls.map((call) => call.functionName)
    const needsGeometry = names.some((name) => NEEDS_GEOMETRY_FNS.has(name))
    const hasGeometry = names.some((name) => GEOMETRY_FNS.has(name))
      || calls.some((call) => call.argRefs.some((ref) => ref.port === 'geometry' || ref.arg === 'geometry'))
    if (needsGeometry && !hasGeometry) {
      const first = calls.find((call) => NEEDS_GEOMETRY_FNS.has(call.functionName))
      diagnostics.push(diagnostic(
        'SCENE_OPERATING_GEOMETRY',
        `${file} expands structure before selecting operating geometry. Call basePlane (or import a scene that already has Geometry) first.`,
        file,
        first,
      ))
    }
  }

  if (sceneSourceKind(input.entryFile) === 'scene') {
    const entryCalls = byFile.get(input.entryFile) ?? input.trace.filter((call) => (
      (call.source?.file ?? input.entryFile) === input.entryFile
    ))
    const outputCall = lastCall(entryCalls, 'sceneOutput')
    const assembled = assembledSchemas(entryCalls)
    const hangable = assembled.mesh || assembled.voxel
    if (!outputCall) {
      diagnostics.push(diagnostic(
        'SCENE_OUTPUT_INCOMPLETE',
        `Run finished, but the scene is not assembled. Task is not complete until ${input.entryFile} builds a SceneTree (voxel or mesh nodes) and calls sceneOutput.`,
        input.entryFile,
      ))
    } else if (!hangable) {
      diagnostics.push(diagnostic(
        'SCENE_OUTPUT_INCOMPLETE',
        `Run finished, but sceneOutput assembled an empty SceneTree. Hang mesh or voxel Geometry (heightfieldMesh → sceneNode, or voxel) then pass that tree to sceneOutput.`,
        input.entryFile,
        outputCall,
      ))
    }

    const terrainHung = assembled.mesh || sceneNodeHungMesh(input.trace)
    if (traceHasHeightfield(input.trace) && !terrainHung) {
      const locate = locateUnusedHeightfield(input.trace)
      diagnostics.push(diagnostic(
        'SCENE_HEIGHTFIELD_NOT_IN_SCENE',
        'Heightfield packet is not hung in the SceneTree. Weave with heightfieldMesh, hang with sceneNode, then sceneOutput. The packet is not scene content.',
        locate?.source?.file ?? input.entryFile,
        locate,
      ))
    }
  }
  return diagnostics
}
