import { describe, expect, it } from 'vitest';
import {
  ROOT_ID,
  addChildren,
  emptyGraph,
  getNode,
  pathOf,
  removeNode,
  resolvePath,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';
import { scenePruneToFocus } from '../scene_prune_to_focus/index.js';
import { sceneMergeSubtrees } from './index.js';

/**
 * Shared fixture: root -> district -> { buildingA, buildingB }, each building
 * gets its own room added on an independent branch. Mirrors the real
 * fanout-then-merge shape (scene_focus_children -> per-branch edits ->
 * scene_merge_subtrees) that this battery exists to converge.
 */
function buildFixture() {
  let g = emptyGraph();
  let r = addChildren(g, ROOT_ID, [{ name: 'district' }]);
  g = r.graph;
  const districtId = r.ids[0]!;
  r = addChildren(g, districtId, [{ name: 'buildingA' }, { name: 'buildingB' }]);
  g = r.graph;
  const [buildingAId, buildingBId] = r.ids as [string, string];

  const addRoomA = addChildren(g, buildingAId, [{ name: 'room1' }]);
  const branchA: ScenePortValue = { graph: addRoomA.graph, focus: buildingAId };
  const room1Id = addRoomA.ids[0]!;

  const addRoomB = addChildren(g, buildingBId, [{ name: 'room2' }]);
  const branchB: ScenePortValue = { graph: addRoomB.graph, focus: buildingBId };
  const room2Id = addRoomB.ids[0]!;

  return { districtId, buildingAId, buildingBId, branchA, branchB, room1Id, room2Id };
}

describe('scene_merge_subtrees + a pruned (scene_prune_to_focus) branch', () => {
  it('re-embeds a pruned branch at its recorded focusOrigin, regardless of merge order', () => {
    const { districtId, buildingAId, branchA, branchB, room1Id } = buildFixture();
    const prunedA = scenePruneToFocus({ scene: branchA }).scene as ScenePortValue;
    expect(getNode(prunedA.graph, ROOT_ID)).toBeNull(); // sanity: really pruned

    for (const scenes of [[branchB, prunedA], [prunedA, branchB]]) {
      const result = sceneMergeSubtrees({ scenes });
      expect(result.error).toBeUndefined();
      const mg = result.scene!.graph;
      expect(resolvePath(mg, ROOT_ID, '/district/buildingA/room1')).not.toBeNull();
      expect(pathOf(mg, room1Id)).toBe('/district/buildingA/room1');
      expect(getNode(mg, buildingAId)!.parent).toBe(districtId);
    }
  });

  it('heals the reattached node well enough that removeNode cleans up the parent link (no dangling child reference)', () => {
    const { districtId, buildingAId, branchA, branchB } = buildFixture();
    const prunedA = scenePruneToFocus({ scene: branchA }).scene as ScenePortValue;

    const merged = sceneMergeSubtrees({ scenes: [prunedA, branchB] });
    const afterRemove = removeNode(merged.scene!.graph, buildingAId);
    expect(getNode(afterRemove, districtId)!.children.has('buildingA')).toBe(false);
  });

  it('a pruned scene can be scenes[0] — master gets a synthesized real root and the branch lands at its recorded path', () => {
    const { branchA, room1Id } = buildFixture();
    const prunedA = scenePruneToFocus({ scene: branchA }).scene as ScenePortValue;

    const result = sceneMergeSubtrees({ scenes: [prunedA] });
    expect(result.error).toBeUndefined();
    const mg = result.scene!.graph;
    expect(getNode(mg, ROOT_ID)).not.toBeNull();
    expect(resolvePath(mg, ROOT_ID, '/district/buildingA/room1')).not.toBeNull();
    expect(pathOf(mg, room1Id)).toBe('/district/buildingA/room1');
  });

  it('merging two independently-pruned sibling branches (neither carries a real root) still converges to one consistent tree', () => {
    const { branchA, branchB, room1Id, room2Id } = buildFixture();
    const prunedA = scenePruneToFocus({ scene: branchA }).scene as ScenePortValue;
    const prunedB = scenePruneToFocus({ scene: branchB }).scene as ScenePortValue;

    const result = sceneMergeSubtrees({ scenes: [prunedA, prunedB] });
    expect(result.error).toBeUndefined();
    const mg = result.scene!.graph;
    expect(pathOf(mg, room1Id)).toBe('/district/buildingA/room1');
    expect(pathOf(mg, room2Id)).toBe('/district/buildingB/room2');
  });

  it('a pruned ScenePortValue with focusOrigin stripped off still merges without throwing (falls back to the pre-fix floating-root behavior — reachable by id, not by path)', () => {
    const { branchB, branchA } = buildFixture();
    const pruned = scenePruneToFocus({ scene: branchA }).scene as ScenePortValue;
    const strippedOrigin: ScenePortValue = { graph: pruned.graph, focus: pruned.focus }; // no focusOrigin
    expect(() => sceneMergeSubtrees({ scenes: [branchB, strippedOrigin] })).not.toThrow();
  });
});
