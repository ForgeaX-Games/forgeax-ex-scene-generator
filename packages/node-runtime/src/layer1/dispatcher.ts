// DataTree dispatcher — the fanout/regroup engine that sits between the executor
// and an op's plain execute function. The executor hands it a single op call; the
// dispatcher uses each port's declared access (item / list / tree), the op's lacing
// mode, and its principal-path declaration to decide how many times execute runs,
// what shape each call receives, and how the returns are reassembled into per-port
// DataTrees. As a layer1 sibling of the executor it owns the entire access<->DataTree
// translation contract, so no other module reimplements item/list/tree packing.
//
// access is a symmetric boundary translator. On the input side a DataTree becomes a
// function argument: item feeds one T per branch (the fanout axis), list feeds the
// current branch's children as a readonly T[] (no fanout), tree feeds the whole
// DataTree (no fanout), and an undeclared port defaults to tree. On the output side a
// return becomes a DataTree: item appends under the principal branch, list explodes an
// array into independent child branches, tree replaces the whole port (last call wins),
// and a function that returns a DataTree directly passes through (back-compat). Control
// inputs (node.params / meta defaults) merge into every call as raw values, untouched.
//
// The output path follows the principal input port's branch, falling back to the first
// item/list port, then to [0] when there are none. Lacing only matters with two or more
// item/list inputs: longest aligns to the largest branch count (short side repeats its
// last branch), shortest truncates, cross is the Cartesian product, pairwise demands
// identical paths. '_'-prefixed engine signals are never wrapped — they accumulate with
// last-call-wins and the executor picks them out (e.g. _loopBatch). dynamicOutputs ops
// are the exception: no fanout, every input fed as the raw tree, execute called once.

import { DataTree, type DataTreeEntry, type Path, comparePaths, pathToString, pathsEqual, isPrefix } from './datatree/index.js'
import type { OpAccess, OpLacingMode, OpSpec } from './types/op-spec.js'

type OpFn = (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>

const MAX_DISPATCH_CELLS = 5000

interface ResolvedPort {
  name: string
  access: OpAccess
}

function resolvePort(name: string, op: OpSpec): ResolvedPort {
  const staticPort = op.inputs.find((p) => p.name === name)
  if (staticPort) return { name, access: staticPort.access ?? 'item' }
  if (op.dynamicInputs && name.startsWith(op.dynamicInputs.prefix)) {
    return { name, access: op.dynamicInputs.access ?? 'item' }
  }
  return { name, access: 'tree' }
}

function resolveOutputAccess(op: OpSpec, name: string): OpAccess {
  const staticOut = op.outputs.find((o) => o.name === name)
  if (staticOut) return staticOut.access ?? 'item'
  if (op.dynamicOutputs && name.startsWith(op.dynamicOutputs.prefix)) {
    return op.dynamicOutputs.access ?? 'item'
  }
  return 'item'
}

function resolvePrincipal(op: OpSpec, ports: ResolvedPort[]): string | undefined {
  if (op.principal) return op.principal
  return ports.find((p) => p.access === 'item' || p.access === 'list')?.name
}

function orderedDataKeys(op: OpSpec, dataKeys: readonly string[]): string[] {
  const remaining = new Set(dataKeys)
  const ordered: string[] = []

  for (const input of op.inputs) {
    if (remaining.delete(input.name)) ordered.push(input.name)
  }

  const rest = [...remaining]
  if (op.dynamicInputs) {
    const { prefix } = op.dynamicInputs
    rest.sort((a, b) => {
      const ai = a.startsWith(prefix) ? Number.parseInt(a.slice(prefix.length), 10) : Number.NaN
      const bi = b.startsWith(prefix) ? Number.parseInt(b.slice(prefix.length), 10) : Number.NaN
      const aDyn = Number.isInteger(ai)
      const bDyn = Number.isInteger(bi)
      if (aDyn && bDyn) return ai - bi
      if (aDyn) return -1
      if (bDyn) return 1
      return dataKeys.indexOf(a) - dataKeys.indexOf(b)
    })
  }

  ordered.push(...rest)
  return ordered
}

function ensureTree(value: unknown): DataTree<unknown> {
  if (value instanceof DataTree) return value as DataTree<unknown>
  if (DataTree.isDataTree(value)) {
    return DataTree.fromEntries((value as { toJSON(): ReadonlyArray<DataTreeEntry<unknown>> }).toJSON())
  }
  if (Array.isArray(value) && value.every(isEntryShape)) {
    return DataTree.fromJSON(value as DataTreeEntry<unknown>[])
  }
  if (value === undefined) return DataTree.empty<unknown>()
  return DataTree.fromItem(value)
}

// Pure-branch normalisation so every branch holds exactly one item, giving the
// fanout logic a uniform shape; trees that already satisfy this are returned untouched.
function normalizeTree(tree: DataTree<unknown>): DataTree<unknown> {
  const entries = tree.toJSON() as DataTreeEntry<unknown>[]
  if (!entries.some((e) => e.items.length > 1)) return tree
  const normalized: DataTreeEntry<unknown>[] = []
  for (const { path, items } of entries) {
    items.forEach((item, idx) => normalized.push({ path: [...path, idx], items: [item] }))
  }
  return DataTree.fromEntries(normalized)
}

// Branch-alignment paths for access:list ports — the unique parent path of every
// leaf, so each call receives one parent's children as its input list.
function parentPaths(leafPaths: readonly Path[]): Path[] {
  const seen = new Set<string>()
  const result: Path[] = []
  for (const path of leafPaths) {
    if (path.length === 0) continue
    const parent = path.slice(0, -1)
    const key = pathToString(parent)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(parent)
    }
  }
  return result.sort(comparePaths)
}

function isImmediateChild(path: Path, parent: Path): boolean {
  return path.length === parent.length + 1 && parent.every((v, i) => v === path[i])
}

function isEntryShape(v: unknown): v is DataTreeEntry<unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    Array.isArray((v as DataTreeEntry<unknown>).path) &&
    Array.isArray((v as DataTreeEntry<unknown>).items)
  )
}

function alignBranches(
  branchPaths: Map<string, readonly Path[]>,
  lacing: OpLacingMode,
): Array<Map<string, number>> {
  const ports = Array.from(branchPaths.keys())
  if (ports.length === 0) return [new Map()]

  const counts = ports.map((p) => branchPaths.get(p)!.length)
  if (counts.some((c) => c === 0)) return []

  if (lacing === 'cross') {
    const result: Array<Map<string, number>> = []
    const walk = (depth: number, picks: Map<string, number>): void => {
      if (depth === ports.length) {
        result.push(new Map(picks))
        return
      }
      const port = ports[depth]
      for (let i = 0; i < branchPaths.get(port)!.length; i++) {
        picks.set(port, i)
        walk(depth + 1, picks)
        picks.delete(port)
      }
    }
    walk(0, new Map())
    return result
  }

  if (lacing === 'pairwise') {
    const minCount = Math.min(...counts)
    const maxCount = Math.max(...counts)
    if (minCount !== maxCount) {
      throw new Error(`pairwise lacing: branch counts mismatch ${counts.join(' vs ')}`)
    }
    for (let i = 0; i < minCount; i++) {
      const refPath = branchPaths.get(ports[0])![i]
      for (const port of ports) {
        if (!pathsEqual(branchPaths.get(port)![i], refPath)) {
          throw new Error(
            `pairwise lacing: path mismatch at index ${i} (${ports[0]}=${pathToString(refPath)}, ${port}=${pathToString(branchPaths.get(port)![i])})`,
          )
        }
      }
    }
    return Array.from({ length: minCount }, (_, i) => {
      const indices = new Map<string, number>()
      for (const p of ports) indices.set(p, i)
      return indices
    })
  }

  if (lacing === 'shortest') {
    const target = Math.min(...counts)
    return Array.from({ length: target }, (_, i) => {
      const indices = new Map<string, number>()
      for (const p of ports) indices.set(p, Math.min(i, branchPaths.get(p)!.length - 1))
      return indices
    })
  }

  // longest (default): hierarchy-aware. The driving axis ("spine") is the port
  // with the most branches (ties broken by the deepest paths). A port with FEWER
  // branches than the spine is treated as a broadcasting parent: for each spine
  // branch it selects the branch whose path is the longest prefix of the spine
  // path, so a per-building {b} value broadcasts across its descendant per-room
  // {b;r} spine branches. A port with the SAME branch count as the spine is a
  // peer list and zips POSITIONALLY (element i ↔ spine i) — never prefix-matched.
  //
  // The equal-count positional rule is essential: prefix matching would collapse
  // equal-length siblings onto one element. E.g. spine rooms {0;0},{0;1},{0;2}
  // (three siblings under one parent) laced with a flat list [0],[1],[2] — only
  // [0] is a prefix of every {0;k}, so prefix matching would feed element 0 to
  // all three (duplicates). Positional zip correctly pairs k↔k. Prefix broadcast
  // is reserved for the genuine fewer-than-spine parent case (e.g. grid2node's
  // 3-building zRange broadcasting onto 12 rooms).
  const target = Math.max(...counts)
  let spine = ports[0]
  let spineCount = -1
  let spineDepth = -1
  for (const p of ports) {
    const paths = branchPaths.get(p)!
    const cnt = paths.length
    const depth = paths.reduce((m, pa) => Math.max(m, pa.length), 0)
    if (cnt > spineCount || (cnt === spineCount && depth > spineDepth)) {
      spineCount = cnt
      spineDepth = depth
      spine = p
    }
  }
  const spinePaths = branchPaths.get(spine)!

  return Array.from({ length: target }, (_, i) => {
    const sp = spinePaths[Math.min(i, spinePaths.length - 1)]
    const indices = new Map<string, number>()
    for (const p of ports) {
      if (p === spine) {
        indices.set(p, Math.min(i, spineCount - 1))
        continue
      }
      const paths = branchPaths.get(p)!
      // Equal-cardinality peer list: positional zip (preserves element-wise
      // pairing). Only a strictly-shorter port is a broadcasting parent.
      if (paths.length >= spineCount) {
        indices.set(p, Math.min(i, paths.length - 1))
        continue
      }
      let bestIdx = -1
      let bestLen = -1
      for (let k = 0; k < paths.length; k++) {
        const pp = paths[k]
        if (pp.length > bestLen && isPrefix(pp, sp)) {
          bestLen = pp.length
          bestIdx = k
        }
      }
      indices.set(p, bestIdx >= 0 ? bestIdx : Math.min(i, paths.length - 1))
    }
    return indices
  })
}

async function callOnce(
  fn: OpFn,
  controlInputs: Record<string, unknown>,
  trees: Map<string, DataTree<unknown>>,
  ports: ResolvedPort[],
  branchIndices: Map<string, number>,
  listParentPaths: Map<string, readonly Path[]>,
): Promise<Record<string, unknown>> {
  const cellInput: Record<string, unknown> = { ...controlInputs }
  for (const port of ports) {
    const tree = trees.get(port.name)!
    if (port.access === 'tree') {
      cellInput[port.name] = tree
      continue
    }
    if (port.access === 'list') {
      // Pure-branch model: access:list collects all immediate children of the
      // current parent path as the input list.
      const parents = listParentPaths.get(port.name) ?? []
      const parentPath = parents[branchIndices.get(port.name) ?? 0]
      if (parentPath === undefined) {
        cellInput[port.name] = []
        continue
      }
      cellInput[port.name] = Array.from(tree.branches())
        .filter((b) => isImmediateChild(b.path, parentPath))
        .map((b) => b.items[0])
      continue
    }
    // access:item — after normalisation each branch holds exactly one item.
    const branches = Array.from(tree.branches())
    if (branches.length === 0) {
      cellInput[port.name] = undefined
      continue
    }
    const branch = branches[branchIndices.get(port.name) ?? 0]
    cellInput[port.name] = branch && branch.items.length > 0 ? branch.items[0] : undefined
  }
  return await Promise.resolve(fn(cellInput))
}

interface OutputCollector {
  branches: Map<string, { path: Path; items: unknown[] }>
}

// Append one return value to an output port's branch. On multi-call fanout each item
// gets its own sub-branch so concurrent calls stay independent; single calls keep the path.
function appendToOutput(
  outputs: Map<string, OutputCollector>,
  portName: string,
  path: Path,
  itemIndex: number,
  value: unknown,
  callsThisTuple: number,
): void {
  const branchPath = callsThisTuple > 1 ? [...path, itemIndex] : path
  const slotIndex = callsThisTuple > 1 ? 0 : itemIndex

  let collector = outputs.get(portName)
  if (!collector) {
    collector = { branches: new Map() }
    outputs.set(portName, collector)
  }
  const key = pathToString(branchPath)
  let branch = collector.branches.get(key)
  if (!branch) {
    branch = { path: branchPath, items: [] }
    collector.branches.set(key, branch)
  }
  branch.items[slotIndex] = value
}

// The single home of the item / list / tree output logic: translate one call's raw
// return into the per-port output containers per declared access, so callers never
// reimplement output packing. callsThisTuple carries the tuple's total fanout so list-
// spawned cells place their items in sub-branches and stay independent.
function wrapOutputs(
  op: OpSpec,
  raw: Record<string, unknown>,
  signalOutputs: Record<string, unknown>,
  treeOutputs: Map<string, DataTree<unknown>>,
  dataOutputs: Map<string, OutputCollector>,
  principalPath: Path,
  itemIndex: number,
  callsThisTuple: number,
): void {
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue

    // Engine signal: last call wins; never wrapped in a DataTree.
    if (key.startsWith('_')) {
      signalOutputs[key] = value
      continue
    }

    // Function returned a DataTree directly: pass through (back-compat).
    // Dynamic imports yield independent module instances which break
    // instanceof across boundaries; duck-typing identifies foreign trees,
    // and we rebuild them through this module's DataTree.fromEntries so
    // downstream `instanceof DataTree` checks still work.
    if (DataTree.isDataTree(value)) {
      const tree =
        value instanceof DataTree
          ? (value as DataTree<unknown>)
          : DataTree.fromEntries((value as { toJSON(): DataTreeEntry<unknown>[] }).toJSON())
      treeOutputs.set(key, tree)
      continue
    }

    const access = resolveOutputAccess(op, key)

    if (access === 'tree') {
      // Wrap a scalar return as a single-item tree; last call wins.
      treeOutputs.set(key, DataTree.fromItem(value))
      continue
    }

    if (access === 'list') {
      // Pure-branch model: each list element becomes its own child branch
      // under principalPath, regardless of call count.
      if (!Array.isArray(value)) {
        throw new Error(
          `output port "${key}" is declared access:list but function returned ${typeof value} — expected array`,
        )
      }
      for (let idx = 0; idx < value.length; idx++) {
        appendToOutput(dataOutputs, key, [...principalPath, idx], 0, value[idx], 1)
      }
      // Empty list still registers the port (mapping to DataTree.empty()).
      if (!dataOutputs.has(key)) dataOutputs.set(key, { branches: new Map() })
      continue
    }

    // access:item (default): append T as items[itemIndex] (sub-branch on multi-fanout).
    appendToOutput(dataOutputs, key, principalPath, itemIndex, value, callsThisTuple)
  }
}

function assembleResult(
  signalOutputs: Record<string, unknown>,
  treeOutputs: Map<string, DataTree<unknown>>,
  dataOutputs: Map<string, OutputCollector>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...signalOutputs }
  for (const [port, collector] of dataOutputs) result[port] = collectorToTree(collector)
  for (const [port, tree] of treeOutputs) result[port] = tree
  return result
}

function collectorToTree(collector: OutputCollector): DataTree<unknown> {
  const entries: DataTreeEntry<unknown>[] = Array.from(collector.branches.values())
    .map((b) => ({ path: b.path, items: b.items.filter((v) => v !== undefined) }))
    .filter((e) => e.items.length > 0)
    .sort((a, b) => comparePaths(a.path, b.path))
  if (entries.length === 0) return DataTree.empty<unknown>()
  return DataTree.fromEntries(entries)
}

// Pick the principal output path for a tuple. The output must follow the FANOUT AXIS —
// the port whose branch varies per tuple — so each call lands on its own output branch.
// That axis is the port with the most branches (mirroring alignBranches' spine choice),
// so branch count is the PRIMARY criterion. Depth is only a tiebreak between ports of
// equal count (prefer the more precise/deeper address), then the declared principal,
// then iteration order.
//
// Count must beat depth, not the other way around: a single-branch input can sit at a
// DEEPER path than the multi-branch fanout port (e.g. a `region` grafted to [0,0,0]
// laced with a flattened `point` list at [0,k]). Depth-first would pick the deep but
// CONSTANT region path for every tuple and collapse all results onto it (last-call-wins);
// count-first correctly follows `point`'s distinct [0,k] branches.
function computePrincipalPath(
  principalName: string | undefined,
  branchIndices: Map<string, number>,
  branchPaths: Map<string, readonly Path[]>,
): Path {
  let bestPath: Path | undefined
  let bestCount = -1
  let bestDepth = -1
  let bestIsPrincipal = false

  for (const [port, paths] of branchPaths) {
    const idx = branchIndices.get(port)
    if (idx === undefined) continue
    const path = paths[idx]
    const count = paths.length
    const depth = path.length
    const isPrincipal = port === principalName
    const better =
      count > bestCount ||
      (count === bestCount &&
        (depth > bestDepth ||
          (depth === bestDepth && isPrincipal && !bestIsPrincipal)))
    if (better) {
      bestCount = count
      bestDepth = depth
      bestIsPrincipal = isPrincipal
      bestPath = path
    }
  }

  // Empty paths (access:list parent at the tree root []) collapse to [0].
  // DataTree paths must have length ≥ 1; [0] is the canonical root branch.
  return bestPath && bestPath.length > 0 ? bestPath : [0]
}

// Main entry: dispatch one op according to its access / lacing / principal config and
// return a per-port bag where data ports hold a DataTree and '_'-prefixed keys pass
// through as raw engine signals for the executor to recognise.
export async function executeWithDataTreeDispatch(
  op: OpSpec,
  dataInputs: Record<string, unknown>,
  controlInputs: Record<string, unknown>,
  fn: OpFn,
): Promise<Record<string, unknown>> {
  const dataKeys = orderedDataKeys(op, Object.keys(dataInputs))
  const ports: ResolvedPort[] = dataKeys.map((k) => resolvePort(k, op))

  // Pure-branch model: access:item/list ports get normalised; access:tree
  // keeps the original tree (the op needs the full structure).
  const rawTrees = new Map<string, DataTree<unknown>>()
  const trees = new Map<string, DataTree<unknown>>()
  for (const port of ports) {
    const raw = ensureTree(dataInputs[port.name])
    rawTrees.set(port.name, raw)
    trees.set(port.name, port.access === 'tree' ? raw : normalizeTree(raw))
  }

  // dynamicOutputs ops: no fanout. Every data input passes through as the raw
  // tree (the op does its own unpacking) and the function runs exactly once.
  if (op.dynamicOutputs) {
    const cellInput: Record<string, unknown> = { ...controlInputs }
    for (const port of ports) cellInput[port.name] = rawTrees.get(port.name)!
    const raw = await Promise.resolve(fn(cellInput))
    const signalOutputs: Record<string, unknown> = {}
    const treeOutputs = new Map<string, DataTree<unknown>>()
    const dataOutputs = new Map<string, OutputCollector>()
    wrapOutputs(op, raw, signalOutputs, treeOutputs, dataOutputs, [0], 0, 1)
    return assembleResult(signalOutputs, treeOutputs, dataOutputs)
  }

  const alignPorts = ports.filter((p) => p.access === 'item' || p.access === 'list')
  const principalName = resolvePrincipal(op, ports)

  // access:list ports align by parent path (children become the input list);
  // access:item ports align by leaf path.
  const branchPaths = new Map<string, readonly Path[]>()
  const listParentPaths = new Map<string, readonly Path[]>()
  for (const p of alignPorts) {
    const leafPaths = Array.from(trees.get(p.name)!.branches()).map((b) => b.path)
    if (p.access === 'list') {
      const pp = parentPaths(leafPaths)
      branchPaths.set(p.name, pp)
      listParentPaths.set(p.name, pp)
    } else {
      branchPaths.set(p.name, leafPaths)
    }
  }

  const lacing: OpLacingMode = op.lacing ?? 'longest'
  const tuples = alignBranches(branchPaths, lacing)
  if (tuples.length === 0) {
    // Zero tuples means at least one aligned input has an empty tree (no
    // branches). If EVERY aligned input is empty, the node is simply not wired
    // yet — stay a silent no-op (the editor recomputes nodes mid-edit). But if
    // SOME aligned input has data while a REQUIRED one is empty, that is a real
    // missing-input bug: a multi-input op (e.g. atlas compose: terrain +
    // template) whose upstream produced nothing would otherwise vanish — no
    // outputs AND no error, leaving every output port stuck on "no result".
    // Surface it explicitly so the operator can run the missing upstream.
    const anyHasBranches = alignPorts.some((p) => branchPaths.get(p.name)!.length > 0)
    if (anyHasBranches) {
      const requiredOf = (name: string): boolean =>
        op.inputs.find((i) => i.name === name)?.required ?? true
      const emptyRequired = alignPorts
        .filter((p) => branchPaths.get(p.name)!.length === 0 && requiredOf(p.name))
        .map((p) => p.name)
      if (emptyRequired.length > 0) {
        throw new Error(
          `${op.id}: required input${emptyRequired.length > 1 ? 's' : ''} ` +
            `"${emptyRequired.join('", "')}" ${emptyRequired.length > 1 ? 'have' : 'has'} ` +
            `no value (upstream produced nothing) — run the upstream node or the full pipeline first`,
        )
      }
    }
    return {}
  }

  // After normalisation, every branch holds exactly one item; fanout is always 1.
  const totalCells = tuples.length
  if (totalCells > MAX_DISPATCH_CELLS) {
    throw new Error(`dispatch cell count ${totalCells} exceeds limit ${MAX_DISPATCH_CELLS} for ${op.id}`)
  }

  const dataOutputs = new Map<string, OutputCollector>()
  const treeOutputs = new Map<string, DataTree<unknown>>()
  const signalOutputs: Record<string, unknown> = {}

  for (const tuple of tuples) {
    const principalPath = computePrincipalPath(principalName, tuple, branchPaths)
    const raw = await callOnce(fn, controlInputs, trees, ports, tuple, listParentPaths)
    // A returned `error` only aborts the cell when it carries a non-empty
    // message. Image/IO batteries (processImage et al.) conventionally surface
    // their `error` output port as '' on success; treating '' as a failure
    // would discard the whole node's outputs even though the work succeeded.
    if (raw.error !== undefined && String(raw.error) !== '') {
      throw new Error(`cell ${pathToString(principalPath)}[0] returned error: ${String(raw.error)}`)
    }
    wrapOutputs(op, raw, signalOutputs, treeOutputs, dataOutputs, principalPath, 0, 1)
  }

  return assembleResult(signalOutputs, treeOutputs, dataOutputs)
}
