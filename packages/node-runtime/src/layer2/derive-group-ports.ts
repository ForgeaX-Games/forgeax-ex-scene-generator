// Shared, side-effect-free derivation of a group's boundary: classify edges
// into internal / boundary-in / boundary-out, mint stable sequential port names
// (in_0, out_0, …), and report how each boundary edge must be rewritten to
// reference the group shadow node. Imported by BOTH the kernel (applyCreateGroup)
// and the editor (useCanvasGroup) so the two never drift. Wiring authority only —
// presentation overlay (hidden/order/customLabel) is layered on by callers.

import type { GraphEdge, ExposedPort } from '../layer1/types/graph.js'
import type { OpAccess } from '../layer1/types/op-spec.js'

export interface DeriveGroupPortsInput {
  memberNodeIds: readonly string[]
  nodes: ReadonlyMap<string, { id: string; opId: string }>
  edges: readonly GraphEdge[]
  /** Resolve a member port's wiring tier. Injected so this fn is registry-agnostic. */
  resolvePortTier: (nodeId: string, port: string, dir: 'in' | 'out') => { portType: string; access?: OpAccess }
}

export interface BoundaryRewrite {
  edgeId: string
  endpoint: 'source' | 'target'
  portName: string
}

export interface DerivedGroupPorts {
  exposedInputs: ExposedPort[]
  exposedOutputs: ExposedPort[]
  internalEdgeIds: string[]
  boundaryRewrites: BoundaryRewrite[]
}

export function deriveGroupPorts(input: DeriveGroupPortsInput): DerivedGroupPorts {
  const members = new Set(input.memberNodeIds)
  const exposedInputs: ExposedPort[] = []
  const exposedOutputs: ExposedPort[] = []
  const internalEdgeIds: string[] = []
  const boundaryRewrites: BoundaryRewrite[] = []

  // Stable name allocation keyed by the boundary mapping so a fan-out reuses one name.
  const inNameByKey = new Map<string, string>()
  const outNameByKey = new Map<string, string>()
  let nextIn = 0
  let nextOut = 0

  for (const e of input.edges) {
    const srcIn = members.has(e.source.nodeId)
    const tgtIn = members.has(e.target.nodeId)
    if (srcIn && tgtIn) {
      internalEdgeIds.push(e.id)
    } else if (!srcIn && tgtIn) {
      const key = `${e.target.nodeId}\0${e.target.port}`
      let name = inNameByKey.get(key)
      if (name === undefined) {
        name = `in_${nextIn++}`
        inNameByKey.set(key, name)
        const tier = input.resolvePortTier(e.target.nodeId, e.target.port, 'in')
        exposedInputs.push({
          portName: name,
          portType: tier.portType,
          ...(tier.access !== undefined ? { access: tier.access } : {}),
          sourceNodeId: e.target.nodeId,
          sourcePortName: e.target.port,
        })
      }
      boundaryRewrites.push({ edgeId: e.id, endpoint: 'target', portName: name })
    } else if (srcIn && !tgtIn) {
      const key = `${e.source.nodeId}\0${e.source.port}`
      let name = outNameByKey.get(key)
      if (name === undefined) {
        name = `out_${nextOut++}`
        outNameByKey.set(key, name)
        const tier = input.resolvePortTier(e.source.nodeId, e.source.port, 'out')
        exposedOutputs.push({
          portName: name,
          portType: tier.portType,
          ...(tier.access !== undefined ? { access: tier.access } : {}),
          sourceNodeId: e.source.nodeId,
          sourcePortName: e.source.port,
        })
      }
      boundaryRewrites.push({ edgeId: e.id, endpoint: 'source', portName: name })
    }
  }

  return { exposedInputs, exposedOutputs, internalEdgeIds, boundaryRewrites }
}
