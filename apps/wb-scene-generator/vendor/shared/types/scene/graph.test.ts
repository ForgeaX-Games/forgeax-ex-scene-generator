import { describe, expect, it } from 'vitest';
import {
  ROOT_ID,
  addChildren,
  childId,
  childrenOf,
  createNode,
  emptyGraph,
  ensurePath,
  getAttribute,
  getNode,
  graftSubtree,
  isLiveSceneGraph,
  moveNode,
  pathOf,
  pruneToFocus,
  removeNode,
  resolvePath,
  reviveGraphFromWire,
  setAttribute,
  setContent,
  setTransform,
} from './graph.js';
import { cellCount, denseVolumeFromCells, sparseVolumeFromCells, uniformVolume } from './volume.js';

describe('childId', () => {
  it('is a pure function: same (parentId, name) always yields the same id, no counters involved', () => {
    expect(childId(ROOT_ID, 'foo')).toBe(childId(ROOT_ID, 'foo'));
  });

  it('different names under the same parent yield different ids', () => {
    expect(childId(ROOT_ID, 'foo')).not.toBe(childId(ROOT_ID, 'bar'));
  });

  it('the same name under different parents yields different ids', () => {
    expect(childId('p1', 'foo')).not.toBe(childId('p2', 'foo'));
  });

  it('two independent callers computing the same (parentId, name) agree on identity (no registry needed)', () => {
    // Simulates two batteries independently creating "the same" logical child —
    // this is the identity rule from the independence audit: they must land on
    // the same slot without any shared global counter.
    const callerA = childId('scene-root', 'decor_01');
    const callerB = childId('scene-root', 'decor_01');
    expect(callerA).toBe(callerB);
  });
});

describe('emptyGraph', () => {
  it('has exactly a root node with no children', () => {
    const g = emptyGraph();
    const root = getNode(g, ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.parent).toBeNull();
    expect(root!.children.size).toBe(0);
  });
});

describe('addChildren', () => {
  it('adds N children in one call and they are all reachable from parent', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
    expect(ids).toHaveLength(3);
    const kids = childrenOf(g1, ROOT_ID);
    expect(kids.map((k) => k.name)).toEqual(['a', 'b', 'c']);
  });

  it('assigns local order 0..N-1 within a single call, used for deterministic sibling sort', () => {
    const g0 = emptyGraph();
    const { graph: g1 } = addChildren(g0, ROOT_ID, [{ name: 'z' }, { name: 'y' }, { name: 'x' }]);
    // Inserted in z,y,x order — order field should preserve call order, not name lexical order.
    const kids = childrenOf(g1, ROOT_ID);
    expect(kids.map((k) => k.name)).toEqual(['z', 'y', 'x']);
  });

  it('does not touch unrelated siblings already present under the same parent (structural sharing)', () => {
    const g0 = emptyGraph();
    const { graph: g1 } = addChildren(g0, ROOT_ID, [{ name: 'existing' }]);
    const existingNode = getNode(g1, childId(ROOT_ID, 'existing'));
    const { graph: g2 } = addChildren(g1, ROOT_ID, [{ name: 'new1' }, { name: 'new2' }]);
    // the existing child's own record must be the exact same reference — untouched
    expect(getNode(g2, childId(ROOT_ID, 'existing'))).toBe(existingNode);
  });

  it('does not mutate the graph passed in (previous graph value keeps working)', () => {
    const g0 = emptyGraph();
    const { graph: g1 } = addChildren(g0, ROOT_ID, [{ name: 'a' }]);
    expect(childrenOf(g0, ROOT_ID)).toHaveLength(0);
    expect(childrenOf(g1, ROOT_ID)).toHaveLength(1);
  });

  it('two independent addChildren calls building the "same" child (by name) land on the same id — explicit overwrite, not silent corruption', () => {
    const g0 = emptyGraph();
    const { graph: g1 } = addChildren(g0, ROOT_ID, [{ name: 'dup', attributes: { from: 'A' } }]);
    const { graph: g2 } = addChildren(g1, ROOT_ID, [{ name: 'dup', attributes: { from: 'B' } }]);
    const kids = childrenOf(g2, ROOT_ID);
    expect(kids).toHaveLength(1);
    expect(kids[0]!.attributes).toEqual({ from: 'B' });
  });

  it('accepts content (Volume) per spec, avoiding a second setContent round-trip', () => {
    const g0 = emptyGraph();
    const vol = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 }, 'grass');
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'terrain', content: vol }]);
    const node = getNode(g1, ids[0]!);
    expect(node!.content).toBe(vol);
    expect(cellCount(node!.content!)).toBe(4);
  });
});

describe('createNode', () => {
  it('is equivalent to a single-item addChildren', () => {
    const g0 = emptyGraph();
    const { graph: g1, id } = createNode(g0, ROOT_ID, 'solo');
    expect(getNode(g1, id)!.name).toBe('solo');
  });
});

describe('removeNode', () => {
  it('detaches the node from parent.children and from the map', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'a' }, { name: 'b' }]);
    const g2 = removeNode(g1, ids[0]!);
    expect(getNode(g2, ids[0]!)).toBeNull();
    expect(childrenOf(g2, ROOT_ID).map((k) => k.name)).toEqual(['b']);
  });

  it('refuses to remove the root', () => {
    const g0 = emptyGraph();
    expect(() => removeNode(g0, ROOT_ID)).toThrow();
  });
});

describe('setTransform / setAttribute / getAttribute / setContent', () => {
  it('setTransform only rewrites the target node, siblings keep their reference', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'a' }, { name: 'b' }]);
    const bBefore = getNode(g1, ids[1]!);
    const g2 = setTransform(g1, ids[0]!, { translation: [1, 2, 3] });
    expect(getNode(g2, ids[0]!)!.transform).toEqual({ translation: [1, 2, 3] });
    expect(getNode(g2, ids[1]!)).toBe(bBefore);
  });

  it('setAttribute merges into existing attributes without dropping other keys', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'a', attributes: { foo: 1 } }]);
    const g2 = setAttribute(g1, ids[0]!, 'bar', 2);
    expect(getAttribute(g2, ids[0]!, 'foo')).toEqual({ value: 1, exists: true });
    expect(getAttribute(g2, ids[0]!, 'bar')).toEqual({ value: 2, exists: true });
  });

  it('getAttribute reports exists:false for a missing key or missing node', () => {
    const g0 = emptyGraph();
    expect(getAttribute(g0, ROOT_ID, 'nope')).toEqual({ value: undefined, exists: false });
    expect(getAttribute(g0, 'missing-node', 'nope')).toEqual({ value: undefined, exists: false });
  });

  it('setContent replaces content by reference, independent of volume size', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'a' }]);
    const vol = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 9, maxY: 9, maxZ: 9 }, 'rock');
    const g2 = setContent(g1, ids[0]!, vol);
    expect(getNode(g2, ids[0]!)!.content).toBe(vol);
  });
});

describe('moveNode', () => {
  it('moves a node from one parent to another, updating both children maps', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids: rootKids } = addChildren(g0, ROOT_ID, [{ name: 'houseA' }, { name: 'houseB' }]);
    const { graph: g2, ids: leafIds } = addChildren(g1, rootKids[0]!, [{ name: 'door' }]);
    const g3 = moveNode(g2, leafIds[0]!, rootKids[1]!);
    expect(childrenOf(g3, rootKids[0]!)).toHaveLength(0);
    expect(childrenOf(g3, rootKids[1]!).map((k) => k.name)).toEqual(['door']);
    expect(getNode(g3, leafIds[0]!)!.parent).toBe(rootKids[1]!);
  });

  it('refuses to move the root', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids } = addChildren(g0, ROOT_ID, [{ name: 'a' }]);
    expect(() => moveNode(g1, ROOT_ID, ids[0]!)).toThrow();
  });
});

describe('resolvePath / pathOf', () => {
  it('round-trip: pathOf(resolvePath(p)) === p for a nested path', () => {
    const g0 = emptyGraph();
    const { graph: g1, ids: l1 } = addChildren(g0, ROOT_ID, [{ name: 'Houses' }]);
    const { graph: g2, ids: l2 } = addChildren(g1, l1[0]!, [{ name: 'House01' }]);
    const { graph: g3 } = addChildren(g2, l2[0]!, [{ name: 'Walls' }]);
    const id = resolvePath(g3, ROOT_ID, '/Houses/House01/Walls');
    expect(id).not.toBeNull();
    expect(pathOf(g3, id!)).toBe('/Houses/House01/Walls');
  });

  it('resolvePath returns null (not a throw) for a non-existent path', () => {
    const g0 = emptyGraph();
    expect(resolvePath(g0, ROOT_ID, '/nope/at/all')).toBeNull();
  });

  it('root path is "/"', () => {
    const g0 = emptyGraph();
    expect(pathOf(g0, ROOT_ID)).toBe('/');
    expect(resolvePath(g0, ROOT_ID, '/')).toBe(ROOT_ID);
  });
});

describe('pruneToFocus', () => {
  function buildSample() {
    // root
    //  ├─ branchA (kept: this is the focus)
    //  │    └─ leafA
    //  └─ branchB (dropped: sibling of the focus)
    let g = emptyGraph();
    const rA = addChildren(g, ROOT_ID, [{ name: 'branchA', attributes: { role: 'kept' } }]);
    g = rA.graph;
    const rB = addChildren(g, ROOT_ID, [{ name: 'branchB', attributes: { role: 'dropped' } }]);
    g = rB.graph;
    const vol = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 4, maxZ: 0 }, 'grass');
    const rLeaf = addChildren(g, rA.ids[0]!, [{ name: 'leafA', content: vol }]);
    g = rLeaf.graph;
    return { g, focusId: rA.ids[0]!, leafId: rLeaf.ids[0]!, siblingId: rB.ids[0]!, vol };
  }

  it('keeps the focus node and every descendant', () => {
    const { g, focusId, leafId } = buildSample();
    const { graph: pruned } = pruneToFocus(g, focusId);
    expect(getNode(pruned, focusId)).not.toBeNull();
    expect(getNode(pruned, leafId)).not.toBeNull();
    expect(getNode(pruned, leafId)!.name).toBe('leafA');
  });

  it('drops the root, the focus\u2019s siblings, and their subtrees entirely (not just unreachable-but-present)', () => {
    const { g, focusId, siblingId } = buildSample();
    const { graph: pruned } = pruneToFocus(g, focusId);
    expect(getNode(pruned, ROOT_ID)).toBeNull();
    expect(getNode(pruned, siblingId)).toBeNull();
  });

  it('rewrites the focus node\u2019s parent to null — it becomes the pruned graph\u2019s local root', () => {
    const { g, focusId } = buildSample();
    const { graph: pruned } = pruneToFocus(g, focusId);
    expect(getNode(pruned, focusId)!.parent).toBeNull();
    expect(pathOf(pruned, focusId)).toBe('/');
  });

  it('records the pre-prune absolute path as originPath, computed against the ORIGINAL graph', () => {
    const { g, focusId } = buildSample();
    const { originPath } = pruneToFocus(g, focusId);
    expect(originPath).toBe('/branchA');
  });

  it('reuses descendant node object references by identity — no deep copy of content/attributes', () => {
    const { g, focusId, leafId, vol } = buildSample();
    const before = getNode(g, leafId)!;
    const { graph: pruned } = pruneToFocus(g, focusId);
    const after = getNode(pruned, leafId)!;
    expect(after).toBe(before); // leaf itself untouched — only the focus node's record is rewritten
    expect(after.content).toBe(vol);
  });

  it('pruning at the true root is a no-op in content: same reachable set, originPath "/"', () => {
    const { g } = buildSample();
    const { graph: pruned, originPath } = pruneToFocus(g, ROOT_ID);
    expect(originPath).toBe('/');
    expect(childrenOf(pruned, ROOT_ID).map((n) => n.name).sort()).toEqual(['branchA', 'branchB']);
  });

  it('does not mutate the input graph', () => {
    const { g, focusId } = buildSample();
    pruneToFocus(g, focusId);
    expect(getNode(g, ROOT_ID)).not.toBeNull();
    expect(childrenOf(g, ROOT_ID)).toHaveLength(2);
  });

  it('throws for a non-existent focus id', () => {
    const g0 = emptyGraph();
    expect(() => pruneToFocus(g0, 'does-not-exist')).toThrow();
  });
});

describe('ensurePath', () => {
  it('creates missing intermediate container nodes and is idempotent', () => {
    const g0 = emptyGraph();
    const { graph: g1, id } = ensurePath(g0, ROOT_ID, ['district', 'building']);
    expect(pathOf(g1, id)).toBe('/district/building');
    const { graph: g2, id: id2 } = ensurePath(g1, ROOT_ID, ['district', 'building']);
    expect(id2).toBe(id);
    expect(getNode(g2, id2)).toBe(getNode(g1, id)); // no rewrite when already present
  });
});

describe('graftSubtree', () => {
  it('grafts a single-node source under a new parent, recomputing its id for the new position', () => {
    const src0 = emptyGraph();
    const vol = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 }, 'grass');
    const { graph: srcGraph, id: srcId } = createNode(src0, ROOT_ID, 'Standalone', { content: vol, schema: 'voxel-mass' });

    const target0 = emptyGraph();
    const { graph: target1, id: parentId } = createNode(target0, ROOT_ID, 'Parent');
    const { graph: target2, id: graftedId } = graftSubtree(target1, parentId, 'Standalone', srcGraph, srcId);

    expect(graftedId).toBe(childId(parentId, 'Standalone')); // id reflects NEW position, not old
    expect(graftedId).not.toBe(srcId);
    const graftedNode = getNode(target2, graftedId)!;
    expect(graftedNode.content).toBe(vol);
    expect(graftedNode.schema).toBe('voxel-mass');
    expect(graftedNode.parent).toBe(parentId);
  });

  it('recursively recomputes descendant ids so lineage stays consistent after reparenting', () => {
    const src0 = emptyGraph();
    const { graph: g1, id: houseId } = createNode(src0, ROOT_ID, 'House');
    const { graph: srcGraph, id: doorId } = createNode(g1, houseId, 'Door');

    const target0 = emptyGraph();
    const { graph: target1, id: districtId } = createNode(target0, ROOT_ID, 'District');
    const { graph: target2, id: newHouseId } = graftSubtree(target1, districtId, 'House', srcGraph, houseId);

    const newDoorId = childrenOf(target2, newHouseId)[0]!.id;
    expect(newDoorId).not.toBe(doorId); // descendant id changed too — old id would be stale
    expect(newDoorId).toBe(childId(newHouseId, 'Door'));
    expect(getNode(target2, newDoorId)!.parent).toBe(newHouseId);
  });

  it('refuses to graft onto a name that already exists at the destination', () => {
    const src0 = emptyGraph();
    const { graph: srcGraph, id: srcId } = createNode(src0, ROOT_ID, 'X');
    const target0 = emptyGraph();
    const { graph: target1, id: parentId } = createNode(target0, ROOT_ID, 'Parent');
    const { graph: target2 } = createNode(target1, parentId, 'dup');
    expect(() => graftSubtree(target2, parentId, 'dup', srcGraph, srcId)).toThrow();
  });

  it('does not mutate the source graph', () => {
    const src0 = emptyGraph();
    const { graph: srcGraph, id: srcId } = createNode(src0, ROOT_ID, 'X');
    const srcNodeBefore = getNode(srcGraph, srcId);
    const target0 = emptyGraph();
    const { graph: target1, id: parentId } = createNode(target0, ROOT_ID, 'Parent');
    graftSubtree(target1, parentId, 'X', srcGraph, srcId);
    expect(getNode(srcGraph, srcId)).toBe(srcNodeBefore);
  });
});

describe('purity / independence regression', () => {
  it('running the same sequence of ops in a different order (independent branches) yields identical per-branch results', () => {
    // Branch A and Branch B are built by two "batteries" that never see each
    // other's NodeIds — only their own focus. Interleaving their calls must not
    // change either branch's own subtree, regardless of call order.
    const g0 = emptyGraph();
    const { graph: gA0, ids: aIds } = addChildren(g0, ROOT_ID, [{ name: 'branchA' }]);
    const { graph: gB0, ids: bIds } = addChildren(gA0, ROOT_ID, [{ name: 'branchB' }]);

    // sequential: A fully built, then B fully built
    let seq = gB0;
    seq = addChildren(seq, aIds[0]!, [{ name: 'a1' }, { name: 'a2' }]).graph;
    seq = addChildren(seq, bIds[0]!, [{ name: 'b1' }, { name: 'b2' }]).graph;

    // interleaved: alternate calls between A and B
    let inter = gB0;
    const stepA1 = addChildren(inter, aIds[0]!, [{ name: 'a1' }]);
    inter = stepA1.graph;
    const stepB1 = addChildren(inter, bIds[0]!, [{ name: 'b1' }]);
    inter = stepB1.graph;
    const stepA2 = addChildren(inter, aIds[0]!, [{ name: 'a2' }]);
    inter = stepA2.graph;
    const stepB2 = addChildren(inter, bIds[0]!, [{ name: 'b2' }]);
    inter = stepB2.graph;

    expect(childrenOf(seq, aIds[0]!).map((n) => n.name)).toEqual(childrenOf(inter, aIds[0]!).map((n) => n.name));
    expect(childrenOf(seq, bIds[0]!).map((n) => n.name)).toEqual(childrenOf(inter, bIds[0]!).map((n) => n.name));
  });
});

describe('JSON wire round-trip (serialize via JSON.stringify, revive via reviveGraphFromWire)', () => {
  it('a live graph is not wire-shaped (has real .get/.set)', () => {
    const g = emptyGraph();
    expect(isLiveSceneGraph(g)).toBe(true);
  });

  it('round-trips topology, order, transform, attributes, schema through JSON.stringify + JSON.parse', () => {
    let g = emptyGraph();
    const r1 = addChildren(g, ROOT_ID, [
      { name: 'House', attributes: { asset_name: 'house_a' }, schema: 'building' },
      { name: 'Tree' },
    ]);
    g = r1.graph;
    g = setTransform(g, r1.ids[0]!, { translation: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const r2 = addChildren(g, r1.ids[0]!, [{ name: 'Roof' }]);
    g = r2.graph;

    const wire = JSON.parse(JSON.stringify({ graph: g, focus: ROOT_ID })) as { graph: Record<string, unknown>; focus: string };
    expect(isLiveSceneGraph(wire.graph)).toBe(false);
    const revived = reviveGraphFromWire(wire.graph);

    expect(childrenOf(revived, ROOT_ID).map((n) => n.name)).toEqual(childrenOf(g, ROOT_ID).map((n) => n.name));
    const houseId = resolvePath(revived, ROOT_ID, '/House');
    expect(houseId).not.toBeNull();
    expect(getNode(revived, houseId!)!.attributes).toEqual({ asset_name: 'house_a' });
    expect(getNode(revived, houseId!)!.schema).toBe('building');
    expect(getNode(revived, houseId!)!.transform).toEqual({ translation: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(childrenOf(revived, houseId!).map((n) => n.name)).toEqual(['Roof']);
  });

  it('round-trips dense Volume content (Uint16Array survives as equivalent typed data)', () => {
    let g = emptyGraph();
    const vol = denseVolumeFromCells(
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 },
      [
        { x: 0, y: 0, z: 0, token: 'grass' },
        { x: 1, y: 1, z: 0, token: 'rock' },
      ],
    );
    const r = addChildren(g, ROOT_ID, [{ name: 'terrain', content: vol }]);
    g = r.graph;

    const wire = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    const revived = reviveGraphFromWire(wire);
    const node = getNode(revived, r.ids[0]!)!;
    expect(cellCount(node.content!)).toBe(2);
    expect([...(node.content as { data: Uint16Array }).data]).toEqual([...(vol as unknown as { data: Uint16Array }).data]);
  });

  it('round-trips sparse Volume content (Map survives as an equivalent Map)', () => {
    let g = emptyGraph();
    const vol = sparseVolumeFromCells([
      { x: 5, y: 5, z: 0, token: 'shrub', state: { rot: 1 } },
      { x: -3, y: 2, z: 0, token: 'rock' },
    ]);
    const r = addChildren(g, ROOT_ID, [{ name: 'scatter', content: vol }]);
    g = r.graph;

    const wire = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    const revived = reviveGraphFromWire(wire);
    const node = getNode(revived, r.ids[0]!)!;
    expect(cellCount(node.content!)).toBe(2);
    expect((node.content as { kind: string; cells: Map<string, unknown> }).cells).toBeInstanceOf(Map);
    expect((node.content as { kind: string; cells: Map<string, unknown> }).cells.get('5,5,0')).toEqual({ token: 'shrub', state: { rot: 1 } });
  });

  it('parseScenePort-equivalent detection: a JSON-round-tripped ScenePortValue is still recognizable and queryable', () => {
    let g = emptyGraph();
    const r = addChildren(g, ROOT_ID, [{ name: 'A' }]);
    g = r.graph;
    const port = { graph: g, focus: r.ids[0]! };
    const wirePort = JSON.parse(JSON.stringify(port)) as { graph: Record<string, unknown>; focus: string };
    expect(isLiveSceneGraph(wirePort.graph)).toBe(false);
    const revivedGraph = reviveGraphFromWire(wirePort.graph);
    expect(getNode(revivedGraph, wirePort.focus)!.name).toBe('A');
  });
});
