/**
 * Example multi-storey voxel building @ 1 voxel = 1 m.
 *
 * - 16×16 m footprint, 3 occupied storeys + roof plant room
 * - Each storey is FLOOR_HEIGHT (4 m): slab @ z+0, walls/partitions @ z+1..2, ceiling @ z+3
 * - Interior: west/east wings, central corridor, stair core, columns, door + window bays
 */

export type VoxelCell = { x: number; y: number; z: number; token: string };

const W = 16;
const H = 16;
const FLOOR_HEIGHT = 4;
const FLOOR_COUNT = 3;

const STAIR = { x0: 2, y0: 2, x1: 4, y1: 4 };
const PARTITION_X = 8;
const CORRIDOR_Y = 7;
const DOOR_X = [7, 8];

function onBorder(x: number, y: number): boolean {
  return x === 0 || y === 0 || x === W - 1 || y === H - 1;
}

function inInterior(x: number, y: number): boolean {
  return x > 0 && x < W - 1 && y > 0 && y < H - 1;
}

function inStairCore(x: number, y: number): boolean {
  return x >= STAIR.x0 && x <= STAIR.x1 && y >= STAIR.y0 && y <= STAIR.y1;
}

function westWing(x: number): boolean {
  return x < PARTITION_X;
}

function eastWing(x: number): boolean {
  return x > PARTITION_X;
}

function isWindowBay(x: number, y: number, zRel: number): boolean {
  if (zRel !== 1 && zRel !== 2) return false;
  const onSouth = y === 0 && x >= 2 && x <= W - 3 && x % 2 === 0;
  const onNorth = y === H - 1 && x >= 2 && x <= W - 3 && x % 2 === 1;
  const onWest = x === 0 && y >= 2 && y <= H - 3 && y % 2 === 0;
  const onEast = x === W - 1 && y >= 2 && y <= H - 3 && y % 2 === 1;
  return onSouth || onNorth || onWest || onEast;
}

function isDoorOpening(x: number, y: number, zRel: number, floorIndex: number): boolean {
  if (floorIndex !== 0) return false;
  return y === 0 && DOOR_X.includes(x) && (zRel === 1 || zRel === 2);
}

function partitionCell(x: number, y: number, zRel: number): boolean {
  if (x !== PARTITION_X || zRel < 1 || zRel > 2) return false;
  if (y <= 0 || y >= H - 1) return false;
  // corridor opening across the building
  if (y === CORRIDOR_Y || y === CORRIDOR_Y - 1) return false;
  return inInterior(x, y) || x === PARTITION_X;
}

function columnCell(x: number, y: number): boolean {
  const cols = [
    [5, 5], [10, 5], [5, 10], [10, 10],
    [5, 13], [10, 13],
  ];
  return cols.some(([cx, cy]) => cx === x && cy === y);
}

function pushUnique(cells: VoxelCell[], seen: Set<string>, cell: VoxelCell): void {
  const key = `${cell.x},${cell.y},${cell.z},${cell.token}`;
  if (seen.has(key)) return;
  seen.add(key);
  cells.push(cell);
}

function buildStorey(floorIndex: number, zBase: number): {
  slab: VoxelCell[];
  structure: VoxelCell[];
  westZone: VoxelCell[];
  eastZone: VoxelCell[];
  stairCore: VoxelCell[];
} {
  const slab: VoxelCell[] = [];
  const structure: VoxelCell[] = [];
  const westZone: VoxelCell[] = [];
  const eastZone: VoxelCell[] = [];
  const stairCore: VoxelCell[] = [];
  const seen = new Set<string>();

  const slabToken = floorIndex === 0 ? 'foundation_slab' : 'floor_slab';
  const ceilingToken = floorIndex === FLOOR_COUNT - 1 ? 'roof_slab' : 'ceiling_slab';

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      // z+0 — floor / foundation slab
      if (onBorder(x, y)) {
        pushUnique(slab, seen, { x, y, z: zBase, token: floorIndex === 0 ? 'foundation' : 'edge_slab' });
      } else {
        pushUnique(slab, seen, { x, y, z: zBase, token: slabToken });
      }

      for (let zRel = 1; zRel <= 2; zRel += 1) {
        const z = zBase + zRel;

        if (inStairCore(x, y) && inInterior(x, y)) {
          pushUnique(stairCore, seen, { x, y, z, token: 'stair' });
          continue;
        }

        if (columnCell(x, y) && inInterior(x, y)) {
          pushUnique(structure, seen, { x, y, z, token: 'column' });
          continue;
        }

        if (onBorder(x, y)) {
          if (isDoorOpening(x, y, zRel, floorIndex)) continue;
          if (isWindowBay(x, y, zRel)) {
            pushUnique(structure, seen, { x, y, z, token: 'window' });
          } else {
            pushUnique(structure, seen, { x, y, z, token: 'exterior_wall' });
          }
          continue;
        }

        if (partitionCell(x, y, zRel)) {
          pushUnique(structure, seen, { x, y, z, token: 'partition_wall' });
          continue;
        }

        // wing-specific infill (low furniture / mezzanine hints at z+2)
        if (inInterior(x, y) && !inStairCore(x, y)) {
          const token = zRel === 2 ? 'interior_fill' : 'interior_low';
          if (westWing(x)) pushUnique(westZone, seen, { x, y, z, token });
          else if (eastWing(x)) pushUnique(eastZone, seen, { x, y, z, token });
        }
      }

      // z+3 — ceiling / roof slab
      const zCeil = zBase + 3;
      if (floorIndex === FLOOR_COUNT - 1) {
        // top storey: inset roof deck + parapet ring
        const inset = x >= 1 && x <= W - 2 && y >= 1 && y <= H - 2;
        if (inset) {
          pushUnique(structure, seen, { x, y, z: zCeil, token: 'roof_slab' });
        } else if (onBorder(x, y)) {
          pushUnique(structure, seen, { x, y, z: zCeil, token: 'parapet' });
        }
      } else if (inInterior(x, y) || onBorder(x, y)) {
        pushUnique(structure, seen, { x, y, z: zCeil, token: ceilingToken });
      }
    }
  }

  // L1 east wing: add a small mezzanine office box (extra partition box)
  if (floorIndex === 1) {
    for (let y = 10; y <= 13; y += 1) {
      for (let x = 10; x <= 13; x += 1) {
        if (x === 10 || x === 13 || y === 13) {
          pushUnique(eastZone, seen, { x, y, z: zBase + 2, token: 'office_partition' });
        }
      }
    }
  }

  // L0 west wing: retail counter strip
  if (floorIndex === 0) {
    for (let x = 2; x <= 6; x += 1) {
      pushUnique(westZone, seen, { x, y: 5, z: zBase + 1, token: 'counter' });
      pushUnique(westZone, seen, { x, y: 5, z: zBase + 2, token: 'counter' });
    }
  }

  return { slab, structure, westZone, eastZone, stairCore };
}

function buildRoofPlant(zBase: number): VoxelCell[] {
  const cells: VoxelCell[] = [];
  const seen = new Set<string>();
  // 3×3 m plant room above main roof
  for (let y = 11; y <= 13; y += 1) {
    for (let x = 11; x <= 13; x += 1) {
      for (let z = zBase; z <= zBase + 2; z += 1) {
        const onShell = x === 11 || x === 13 || y === 11 || y === 13 || z === zBase + 2;
        pushUnique(cells, seen, {
          x, y, z,
          token: onShell ? 'mech_shell' : 'mech_equipment',
        });
      }
    }
  }
  return cells;
}

export function buildExampleVoxelBuildingDocument() {
  const nodes: Array<{ name: string; cells: VoxelCell[] }> = [];

  for (let fi = 0; fi < FLOOR_COUNT; fi += 1) {
    const zBase = fi * FLOOR_HEIGHT;
    const prefix = `L${fi}`;
    const storey = buildStorey(fi, zBase);
    nodes.push(
      { name: `${prefix}_slab`, cells: storey.slab },
      { name: `${prefix}_structure`, cells: storey.structure },
      { name: `${prefix}_west_wing`, cells: storey.westZone },
      { name: `${prefix}_east_wing`, cells: storey.eastZone },
      { name: `${prefix}_stair_core`, cells: storey.stairCore },
    );
  }

  const roofZ = FLOOR_COUNT * FLOOR_HEIGHT;
  nodes.push({ name: 'L3_mech_plant', cells: buildRoofPlant(roofZ) });

  return {
    schema: 'voxel-mass',
    root: 'CityBlock',
    meta: {
      unit: '1m',
      floorHeight: FLOOR_HEIGHT,
      footprint: { width: W, height: H },
      storeys: FLOOR_COUNT,
      totalHeight: roofZ + 3,
    },
    nodes,
  };
}

export const EXAMPLE_VOXEL_BUILDING_JSON = JSON.stringify(buildExampleVoxelBuildingDocument());
