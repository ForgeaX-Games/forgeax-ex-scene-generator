import { describe, it, expect } from 'vitest';
import {
  cellCount,
  childrenOf,
  getNode,
  resolvePath,
  ROOT_ID,
  type SceneGraph,
} from '../../vendor/dist/shared/types/index.js';
import { json2Voxels } from '../../batteries/scene/bridge/json2voxels/index.js';
import { voxels2Scene } from '../../batteries/scene/bridge/voxels2scene/index.js';
import { buildVoxelCityDocument } from '../../examples/voxel-city.build.js';

function findNode(graph: SceneGraph, path: string) {
  const id = resolvePath(graph, ROOT_ID, path);
  return id === null ? null : getNode(graph, id);
}

const SEED = 42;

describe('voxel city (terrain + districts + landmarks)', () => {
  it('is deterministic and varied per seed', () => {
    const a = buildVoxelCityDocument(SEED);
    const b = buildVoxelCityDocument(SEED);
    expect(a.meta.voxelCount).toBe(b.meta.voxelCount);
    const c = buildVoxelCityDocument(SEED + 1);
    expect(c.meta.voxelCount).not.toBe(a.meta.voxelCount);
    expect(a.meta.buildingCount).toBeGreaterThan(20);
    expect(a.meta.landmarkCount).toBeGreaterThanOrEqual(1);
    expect(a.meta.propCount).toBeGreaterThan(30);
    expect(a.meta.maxElevation).toBeGreaterThan(0);
    expect(a.meta.coreCount).toBeGreaterThanOrEqual(1);
  });

  it('scales up to a larger polycentric metropolis', () => {
    const base = buildVoxelCityDocument(SEED);
    const big = buildVoxelCityDocument(SEED, { scale: 5 });
    expect(big.meta.area.width).toBeGreaterThan(base.meta.area.width * 2);
    expect(big.meta.voxelCount).toBeGreaterThan(base.meta.voxelCount * 3);
    expect(big.meta.coreCount).toBeGreaterThanOrEqual(base.meta.coreCount);
    // deterministic per (seed, scale)
    expect(buildVoxelCityDocument(SEED, { scale: 5 }).meta.voxelCount).toBe(big.meta.voxelCount);
    // still grouped by feature
    const groups = new Set(big.nodes.map((n) => n.name.split('/')[0]));
    expect(groups.has('terrain')).toBe(true);
    expect(groups.has('street')).toBe(true);
  });

  it('places street furniture (lamps, stalls, trees, props) beside roads', () => {
    const doc = buildVoxelCityDocument(SEED);
    const street = doc.nodes.filter((n) => n.name.startsWith('street/'));
    const names = street.map((n) => n.name);
    expect(names).toContain('street/lamps');
    expect(names).toContain('street/greenery');
    for (const n of street) expect(n.cells.length).toBeGreaterThan(0);

    // every lamp sits directly next to a road cell
    const roadNode = doc.nodes.find((n) => n.name === 'terrain/road')!;
    const roadXY = new Set(roadNode.cells.map((c) => `${c.x},${c.y}`));
    const lamps = doc.nodes.find((n) => n.name === 'street/lamps')!;
    const bases = new Map<string, boolean>();
    for (const c of lamps.cells) {
      const key = `${c.x},${c.y}`;
      const near =
        roadXY.has(`${c.x - 1},${c.y}`) || roadXY.has(`${c.x + 1},${c.y}`) ||
        roadXY.has(`${c.x},${c.y - 1}`) || roadXY.has(`${c.x},${c.y + 1}`);
      bases.set(key, (bases.get(key) ?? false) || near);
    }
    expect([...bases.values()].every(Boolean)).toBe(true);
  });

  it('has a continuous terrain base with roads and water', () => {
    const doc = buildVoxelCityDocument(SEED);
    const land = doc.nodes.find((n) => n.name === 'terrain/land');
    const road = doc.nodes.find((n) => n.name === 'terrain/road');
    expect(land).toBeTruthy();
    expect(road).toBeTruthy();
    expect(land!.cells.length).toBeGreaterThan(5000);
    expect(road!.cells.length).toBeGreaterThan(0);
    // terrain has elevation variation (multiple distinct surface heights)
    const zs = new Set(land!.cells.map((c) => c.z));
    expect(zs.size).toBeGreaterThan(2);
    // continuous base: land coverage over the full area footprint
    const xy = new Set(land!.cells.concat(road!.cells).map((c) => `${c.x},${c.y}`));
    expect(xy.size).toBeGreaterThan(doc.meta.area.width * doc.meta.area.height * 0.6);
  });

  it('staggers building heights and includes a tall landmark', () => {
    const doc = buildVoxelCityDocument(SEED);
    const tops: number[] = [];
    for (const n of doc.nodes) {
      if (n.name.startsWith('terrain/')) continue;
      let maxZ = 0;
      for (const c of n.cells) if (c.z > maxZ) maxZ = c.z;
      tops.push(maxZ);
    }
    expect(new Set(tops).size).toBeGreaterThan(8);
    // landmark should overtop typical buildings
    const landmarkTops = doc.nodes
      .filter((n) => n.name.startsWith('landmarks/'))
      .map((n) => n.cells.reduce((m, c) => Math.max(m, c.z), 0));
    expect(Math.max(...landmarkTops)).toBe(doc.meta.maxHeight);
  });

  it('builds a hierarchical scene grouped by terrain / district / landmarks', () => {
    const doc = buildVoxelCityDocument(SEED);
    const parsed = json2Voxels({ json: JSON.stringify(doc) });
    expect(parsed.error).toBeUndefined();
    expect((parsed.nodes as unknown[]).length).toBe(doc.nodes.length);

    const built = voxels2Scene({ nodes: parsed.nodes, root: parsed.root, schema: parsed.schema });
    expect(built.error).toBeUndefined();
    expect(built.voxelCount).toBe(doc.meta.voxelCount);

    const graph = built.scene!.graph;
    const city = findNode(graph, '/VoxelCity');
    expect(city).not.toBeNull();
    const groups = childrenOf(graph, city!.id).map((c) => c.name);
    expect(groups).toContain('terrain');

    const terrain = findNode(graph, '/VoxelCity/terrain');
    const terrainChildNames = childrenOf(graph, terrain!.id).map((c) => c.name);
    expect(terrainChildNames).toContain('land');
    expect(terrainChildNames).toContain('road');

    // at least three of the four districts / landmarks materialise
    const featureGroups = groups.filter((g) => g !== 'terrain');
    expect(featureGroups.length).toBeGreaterThanOrEqual(3);

    // a building leaf carries voxels
    const firstFeature = findNode(graph, `/VoxelCity/${featureGroups[0]}`);
    const child = childrenOf(graph, firstFeature!.id)[0];
    const leaf = findNode(graph, `/VoxelCity/${featureGroups[0]}/${child.name}`);
    expect(leaf?.content ? cellCount(leaf.content) : 0).toBeGreaterThan(0);
  });
});
