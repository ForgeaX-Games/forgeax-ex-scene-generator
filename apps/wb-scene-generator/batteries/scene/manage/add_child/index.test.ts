import { describe, expect, it } from 'vitest';
import {
  ROOT_ID,
  addChildren,
  emptyGraph,
  getNode,
  makeScenePort,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';
import { addChild } from './index.js';

/** A single-node scene (as produced by e.g. grid2node) named `name`, floating in its own graph. */
function namedNode(name: string): ScenePortValue {
  const g = emptyGraph();
  const { graph, ids } = addChildren(g, ROOT_ID, [{ name }]);
  return { graph, focus: ids[0]! };
}

describe('add_child — sibling name collisions (scene v3 Map<name,id> children)', () => {
  it('auto-suffixes a second same-named node in the same batch instead of erroring (PlaceOneDecoration count>1 shape)', () => {
    const parent = makeScenePort(emptyGraph(), ROOT_ID);
    const result = addChild({
      scene: parent,
      nodes: [namedNode('路边驿亭'), namedNode('路边驿亭')],
    });

    expect(result.error).toBeUndefined();
    expect(result.childPaths).toEqual(['/路边驿亭', '/路边驿亭_2']);

    const g = result.scene!.graph;
    const root = getNode(g, ROOT_ID)!;
    expect(root.children.size).toBe(2);
    const secondId = root.children.get('路边驿亭_2')!;
    expect(getNode(g, secondId)!.name).toBe('路边驿亭_2');
  });

  it('keeps suffixing (_2, _3, ...) across more than two duplicates', () => {
    const parent = makeScenePort(emptyGraph(), ROOT_ID);
    const result = addChild({
      scene: parent,
      nodes: [namedNode('石柱'), namedNode('石柱'), namedNode('石柱')],
    });

    expect(result.error).toBeUndefined();
    expect(result.childPaths).toEqual(['/石柱', '/石柱_2', '/石柱_3']);
  });

  it('also dedupes against a name the parent already has from a prior add_child call', () => {
    let parent = makeScenePort(emptyGraph(), ROOT_ID);
    const first = addChild({ scene: parent, nodes: [namedNode('里程石碑')] });
    expect(first.error).toBeUndefined();
    parent = first.scene!;

    const second = addChild({ scene: parent, nodes: [namedNode('里程石碑')] });
    expect(second.error).toBeUndefined();
    expect(second.childPaths).toEqual(['/里程石碑_2']);
  });

  it('leaves genuinely distinct names untouched', () => {
    const parent = makeScenePort(emptyGraph(), ROOT_ID);
    const result = addChild({
      scene: parent,
      nodes: [namedNode('废弃哨站'), namedNode('里程石碑')],
    });

    expect(result.error).toBeUndefined();
    expect(result.childPaths).toEqual(['/废弃哨站', '/里程石碑']);
  });

  it('still errors on structurally invalid input (not a duplicate-name concern)', () => {
    const parent = makeScenePort(emptyGraph(), ROOT_ID);
    const result = addChild({ scene: parent, nodes: ['not-a-scene-port'] });
    expect(result.error).toBe('nodes[0] is not a valid ScenePortValue');
  });
});
