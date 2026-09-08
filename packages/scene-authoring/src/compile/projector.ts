import type { GraphEdge, GraphNode, KernelGraphV1, NodeGroup, Op } from '@forgeax/node-runtime'

export function compiledOpsToKernelGraph(ops: readonly Op[]): KernelGraphV1 {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const groups = new Map<string, NodeGroup>()
  for (const op of ops) {
    if (op.type === 'createNode') {
      nodes.set(op.nodeId, {
        id: op.nodeId,
        opId: op.opId,
        position: op.position ?? { x: 0, y: 0 },
        params: { ...op.params },
        ...(op.name ? { name: op.name } : {}),
      })
      continue
    }
    if (op.type === 'connect') {
      if (!op.edgeId) continue
      edges.set(op.edgeId, {
        id: op.edgeId,
        source: { ...op.source },
        target: { ...op.target },
      })
      continue
    }
    if (op.type === 'updateNode') {
      const node = nodes.get(op.nodeId)
      if (node) {
        if (op.params) node.params = { ...node.params, ...op.params }
        if (op.name !== undefined) node.name = op.name
        if (op.position !== undefined) node.position = { ...op.position }
      }
      continue
    }
    if (op.type !== 'createGroup') continue
    const members = op.memberNodeIds.map((id) => nodes.get(id)).filter((node): node is GraphNode => Boolean(node))
    const memberIds = new Set(members.map((node) => node.id))
    const innerEdges = [...edges.values()].filter(
      (edge) => memberIds.has(edge.source.nodeId) && memberIds.has(edge.target.nodeId),
    )
    for (const node of members) nodes.delete(node.id)
    for (const edge of innerEdges) edges.delete(edge.id)
    const position = op.position ?? { x: 0, y: 0 }
    const convertPorts = (
      ports: NonNullable<Extract<Op, { type: 'createGroup' }>['exposedPorts']>['inputs'] | undefined,
    ) =>
      (ports ?? []).map((port) => ({
        portName: port.portName,
        portType: port.portType ?? 'any',
        sourceNodeId: port.sourceNodeId,
        sourcePortName: port.sourcePortName,
        ...(port.access ? { access: port.access } : {}),
        ...(port.hidden !== undefined ? { hidden: port.hidden } : {}),
        ...(port.order !== undefined ? { order: port.order } : {}),
        ...(port.customLabel ? { customLabel: port.customLabel } : {}),
        ...(port.customLabelEn ? { customLabelEn: port.customLabelEn } : {}),
      }))
    const group: NodeGroup = {
      id: op.groupId,
      name: op.name,
      ...(op.nameEn ? { nameEn: op.nameEn } : {}),
      nodes: members,
      edges: innerEdges,
      position,
      exposedInputs: convertPorts(op.exposedPorts?.inputs),
      exposedOutputs: convertPorts(op.exposedPorts?.outputs),
    }
    groups.set(group.id, group)
    nodes.set(op.groupId, {
      id: op.groupId,
      opId: '__group__',
      name: op.name,
      position,
      params: { groupId: op.groupId },
    })
  }
  const childGroupIds = new Set<string>()
  for (const group of groups.values()) {
    for (const node of group.nodes) {
      if (node.opId === '__group__') childGroupIds.add(String(node.params.groupId ?? node.id))
    }
  }
  const embedGroup = (group: NodeGroup, visiting = new Set<string>()): NodeGroup => {
    if (visiting.has(group.id)) return group
    const nextVisiting = new Set(visiting).add(group.id)
    const nested = group.nodes
      .filter((node) => node.opId === '__group__')
      .map((node) => groups.get(String(node.params.groupId ?? node.id)))
      .filter((item): item is NodeGroup => Boolean(item))
      .map((item) => embedGroup(item, nextVisiting))
    return { ...group, ...(nested.length ? { _nestedGroups: nested } : {}) }
  }
  const rootGroups = [...groups.values()]
    .filter((group) => !childGroupIds.has(group.id))
    .map((group) => embedGroup(group))
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    groups: rootGroups,
  }
}
