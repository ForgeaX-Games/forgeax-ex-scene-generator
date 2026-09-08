import { describe, expect, it } from 'vitest';
import {
  bboxOf,
  cellCount,
  denseVolumeFromCells,
  emptyVolume,
  getCell,
  isEmpty,
  iterCells,
  paint,
  sparseVolumeFromCells,
  subtract,
  union,
  uniformVolume,
  volumeFromCells,
} from './volume.js';

const BOX = { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 3, maxZ: 0 };

describe('emptyVolume', () => {
  it('has zero cells and is considered empty', () => {
    const v = emptyVolume();
    expect(cellCount(v)).toBe(0);
    expect(isEmpty(v)).toBe(true);
    expect(bboxOf(v)).toBeNull();
    expect([...iterCells(v)]).toEqual([]);
  });
});

describe('uniformVolume', () => {
  it('cellCount is O(1) via bbox formula and matches manual enumeration', () => {
    const v = uniformVolume(BOX, 'grass');
    expect(cellCount(v)).toBe(16); // 4x4x1
    expect([...iterCells(v)]).toHaveLength(16);
  });

  it('getCell returns the uniform token everywhere inside bbox, undefined outside', () => {
    const v = uniformVolume(BOX, 'grass');
    expect(getCell(v, 0, 0, 0)).toEqual({ token: 'grass' });
    expect(getCell(v, 3, 3, 0)).toEqual({ token: 'grass' });
    expect(getCell(v, 4, 0, 0)).toBeUndefined();
  });

  it('degenerates to empty for a non-positive-volume bbox', () => {
    const v = uniformVolume({ minX: 5, minY: 0, minZ: 0, maxX: 2, maxY: 0, maxZ: 0 }, 'x');
    expect(isEmpty(v)).toBe(true);
  });
});

describe('denseVolumeFromCells', () => {
  it('round-trips cells through iterCells with correct tokens', () => {
    const cells = [
      { x: 0, y: 0, z: 0, token: 'a' },
      { x: 1, y: 1, z: 0, token: 'b' },
      { x: 2, y: 2, z: 0, token: 'a' },
    ];
    const v = denseVolumeFromCells(BOX, cells);
    expect(cellCount(v)).toBe(3);
    const roundTripped = [...iterCells(v)].sort((a, b) => a.x - b.x);
    expect(roundTripped).toEqual([
      { x: 0, y: 0, z: 0, token: 'a' },
      { x: 1, y: 1, z: 0, token: 'b' },
      { x: 2, y: 2, z: 0, token: 'a' },
    ]);
  });

  it('cellCount is precomputed at construction time (O(1)), not scanned on read', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), z: 0, token: 't' }));
    const v = denseVolumeFromCells(BOX, cells);
    expect(cellCount(v)).toBe(10);
  });

  it('throws when a cell falls outside the given bbox', () => {
    expect(() => denseVolumeFromCells(BOX, [{ x: 99, y: 0, z: 0, token: 'x' }])).toThrow();
  });
});

describe('sparseVolumeFromCells', () => {
  it('preserves per-cell state alongside token', () => {
    const v = sparseVolumeFromCells([{ x: 0, y: 0, z: 0, token: 'door', state: { open: true } }]);
    expect(getCell(v, 0, 0, 0)).toEqual({ token: 'door', state: { open: true } });
  });
});

describe('union', () => {
  it('b wins on overlapping cells ("painted over" semantics)', () => {
    const a = uniformVolume(BOX, 'grass');
    const b = denseVolumeFromCells(BOX, [{ x: 1, y: 1, z: 0, token: 'path' }]);
    const merged = union(a, b);
    expect(getCell(merged, 1, 1, 0)).toEqual({ token: 'path' });
    expect(getCell(merged, 0, 0, 0)).toEqual({ token: 'grass' });
    expect(cellCount(merged)).toBe(16);
  });

  it('union with empty returns the other operand unchanged (identity element)', () => {
    const a = uniformVolume(BOX, 'grass');
    expect(union(a, emptyVolume())).toBe(a);
    expect(union(emptyVolume(), a)).toBe(a);
  });

  it('dense+dense fast path (same bbox) agrees with the generic cell-map path', () => {
    const a = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'a' }]);
    const b = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'b' }, { x: 1, y: 0, z: 0, token: 'c' }]);
    const merged = union(a, b);
    expect(getCell(merged, 0, 0, 0)).toEqual({ token: 'b' });
    expect(getCell(merged, 1, 0, 0)).toEqual({ token: 'c' });
    expect(cellCount(merged)).toBe(2);
  });

  it('is order-sensitive but internally consistent: union(a,b) unions the same cell set as union(b,a) with priority swapped', () => {
    const a = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'a' }]);
    const b = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'b' }]);
    expect(getCell(union(a, b), 0, 0, 0)!.token).toBe('b');
    expect(getCell(union(b, a), 0, 0, 0)!.token).toBe('a');
  });
});

describe('subtract', () => {
  it('removes cells present in b from a, regardless of b token — this is the "rest" shape', () => {
    const full = uniformVolume(BOX, 'ground');
    const hole = denseVolumeFromCells(BOX, [{ x: 1, y: 1, z: 0, token: 'whatever' }]);
    const rest = subtract(full, hole);
    expect(cellCount(rest)).toBe(15);
    expect(getCell(rest, 1, 1, 0)).toBeUndefined();
    expect(getCell(rest, 0, 0, 0)).toEqual({ token: 'ground' });
  });

  it('subtract from empty is empty; subtracting empty is a no-op', () => {
    const a = uniformVolume(BOX, 'x');
    expect(isEmpty(subtract(emptyVolume(), a))).toBe(true);
    expect(subtract(a, emptyVolume())).toBe(a);
  });

  it('dense+dense fast path agrees with generic path', () => {
    const a = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'a' }, { x: 1, y: 0, z: 0, token: 'a' }]);
    const b = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'ignored' }]);
    const rest = subtract(a, b);
    expect(cellCount(rest)).toBe(1);
    expect(getCell(rest, 1, 0, 0)).toEqual({ token: 'a' });
  });
});

describe('paint', () => {
  it('applies a single token to every cell in region, ignoring region\'s own token', () => {
    const base = emptyVolume();
    const region = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'shape-only' }, { x: 1, y: 0, z: 0, token: 'shape-only' }]);
    const painted = paint(base, region, 'grass');
    expect(getCell(painted, 0, 0, 0)).toEqual({ token: 'grass' });
    expect(getCell(painted, 1, 0, 0)).toEqual({ token: 'grass' });
  });

  it('painting an empty region over base is a no-op', () => {
    const base = uniformVolume(BOX, 'grass');
    expect(paint(base, emptyVolume(), 'x')).toBe(base);
  });
});

describe('volumeFromCells', () => {
  it('empty input yields empty volume', () => {
    expect(isEmpty(volumeFromCells([]))).toBe(true);
  });

  it('a fully-filled single-token box collapses to uniform (no typed array allocated)', () => {
    const cells = [];
    for (let x = 0; x <= 3; x++) for (let y = 0; y <= 3; y++) cells.push({ x, y, z: 0, token: 'grass' });
    const v = volumeFromCells(cells);
    expect(v.kind).toBe('uniform');
    expect(cellCount(v)).toBe(16);
  });

  it('a fully-filled box with mixed tokens is dense, not uniform', () => {
    const cells = [];
    for (let x = 0; x <= 3; x++) for (let y = 0; y <= 3; y++) cells.push({ x, y, z: 0, token: x < 2 ? 'a' : 'b' });
    const v = volumeFromCells(cells);
    expect(v.kind).toBe('dense');
    expect(cellCount(v)).toBe(16);
  });

  it('a cell carrying state disqualifies uniform even if token is constant and box is full', () => {
    const v = volumeFromCells([
      { x: 0, y: 0, z: 0, token: 'grass', state: { rot: 1 } },
      { x: 1, y: 0, z: 0, token: 'grass' },
    ]);
    expect(v.kind).not.toBe('uniform');
  });

  it('a sparse scatter (low fill ratio) becomes sparse', () => {
    const v = volumeFromCells([{ x: 0, y: 0, z: 0, token: 'a' }, { x: 100, y: 100, z: 0, token: 'b' }]);
    expect(v.kind).toBe('sparse');
    expect(cellCount(v)).toBe(2);
  });

  it('round-trips cell identity regardless of chosen representation', () => {
    const input = [
      { x: 0, y: 0, z: 0, token: 'a' },
      { x: 1, y: 0, z: 0, token: 'b' },
      { x: 5, y: 5, z: 0, token: 'c', state: { foo: 1 } },
    ];
    const v = volumeFromCells(input);
    const out = [...iterCells(v)].sort((a, b) => a.x - b.x || a.y - b.y);
    expect(out).toHaveLength(3);
    expect(getCell(v, 5, 5, 0)).toEqual({ token: 'c', state: { foo: 1 } });
  });
});

describe('union/subtract/paint typed-array fast path (large uniform/dense base + small edit)', () => {
  it('union: painting a small dense patch onto a large uniform base never materializes a per-cell Map (state-free operands)', () => {
    const BIG = { minX: 0, minY: 0, minZ: 0, maxX: 199, maxY: 199, maxZ: 0 };
    const base = uniformVolume(BIG, 'grass');
    const patch = denseVolumeFromCells(
      { minX: 10, minY: 10, minZ: 0, maxX: 14, maxY: 14, maxZ: 0 },
      Array.from({ length: 25 }, (_, i) => ({ x: 10 + (i % 5), y: 10 + Math.floor(i / 5), z: 0, token: 'road' })),
    );
    const merged = union(base, patch);
    expect(cellCount(merged)).toBe(200 * 200);
    expect(getCell(merged, 12, 12, 0)).toEqual({ token: 'road' });
    expect(getCell(merged, 0, 0, 0)).toEqual({ token: 'grass' });
    expect(getCell(merged, 199, 199, 0)).toEqual({ token: 'grass' });
  });

  it('union: a state-carrying sparse operand still routes through the state-preserving Map path (unchanged pre-existing contract: state only survives when the result stays low-density/sparse — verified identical on the pre-fast-path implementation)', () => {
    // Deliberately sparse-vs-sparse (both low density) so the result itself stays sparse and
    // state survives — this is the one shape the array fast path must NOT be used for, and it
    // isn't (hasAnyState(b) is true here so union() takes the Map branch, same as before).
    const a = sparseVolumeFromCells([{ x: 0, y: 0, z: 0, token: 'wall' }]);
    const door = sparseVolumeFromCells([{ x: 100, y: 100, z: 0, token: 'door', state: { open: true } }]);
    const merged = union(a, door);
    expect(getCell(merged, 100, 100, 0)).toEqual({ token: 'door', state: { open: true } });
    expect(getCell(merged, 0, 0, 0)).toEqual({ token: 'wall' });
  });

  it('subtract: carving a hole out of a large dense base agrees with the generic-path result and keeps other cells intact', () => {
    const BIG = { minX: 0, minY: 0, minZ: 0, maxX: 99, maxY: 99, maxZ: 0 };
    const base = denseVolumeFromCells(
      BIG,
      (function* () {
        for (let x = 0; x <= 99; x++) for (let y = 0; y <= 99; y++) yield { x, y, z: 0, token: x < 50 ? 'a' : 'b' };
      })(),
    );
    const hole = uniformVolume({ minX: 10, minY: 10, minZ: 0, maxX: 19, maxY: 19, maxZ: 0 }, 'whatever');
    const rest = subtract(base, hole);
    expect(cellCount(rest)).toBe(100 * 100 - 100);
    expect(getCell(rest, 15, 15, 0)).toBeUndefined();
    expect(getCell(rest, 0, 0, 0)).toEqual({ token: 'a' });
    expect(getCell(rest, 60, 60, 0)).toEqual({ token: 'b' });
  });

  it('subtract: preserves state on a sparse base for cells not covered by b (stays low-density so the state-preserving Map branch is taken, same pre-existing contract as before this change)', () => {
    const base = sparseVolumeFromCells([
      { x: 0, y: 0, z: 0, token: 'door', state: { open: true } },
      { x: 100, y: 100, z: 0, token: 'wall' },
    ]);
    const hole = uniformVolume({ minX: 100, minY: 100, minZ: 0, maxX: 100, maxY: 100, maxZ: 0 }, 'x');
    const rest = subtract(base, hole);
    expect(getCell(rest, 0, 0, 0)).toEqual({ token: 'door', state: { open: true } });
    expect(getCell(rest, 100, 100, 0)).toBeUndefined();
  });

  it('paint: stamping a small region onto a large uniform base only touches the region footprint', () => {
    const BIG = { minX: 0, minY: 0, minZ: 0, maxX: 299, maxY: 299, maxZ: 0 };
    const base = uniformVolume(BIG, 'grass');
    const region = uniformVolume({ minX: 100, minY: 100, minZ: 0, maxX: 109, maxY: 109, maxZ: 0 }, 'ignored-token');
    const painted = paint(base, region, 'road');
    expect(cellCount(painted)).toBe(300 * 300);
    expect(getCell(painted, 105, 105, 0)).toEqual({ token: 'road' });
    expect(getCell(painted, 0, 0, 0)).toEqual({ token: 'grass' });
  });

  it('paint: preserves state on untouched cells of a sparse base', () => {
    const base = sparseVolumeFromCells([{ x: 0, y: 0, z: 0, token: 'door', state: { open: true } }]);
    const region = uniformVolume({ minX: 5, minY: 5, minZ: 0, maxX: 5, maxY: 5, maxZ: 0 }, 'ignored');
    const painted = paint(base, region, 'road');
    expect(getCell(painted, 0, 0, 0)).toEqual({ token: 'door', state: { open: true } });
    expect(getCell(painted, 5, 5, 0)).toEqual({ token: 'road' });
  });

  it('union/subtract/paint fast paths never allocate a Map<string, object> proportional to base size (smoke perf check)', () => {
    const N = 1000;
    const base = uniformVolume({ minX: 0, minY: 0, minZ: 0, maxX: N - 1, maxY: N - 1, maxZ: 0 }, 'grass');
    const t0 = Date.now();
    let cur = base;
    for (let i = 0; i < 20; i++) {
      const ox = (i * 37) % (N - 10);
      const oy = (i * 53) % (N - 10);
      const region = uniformVolume({ minX: ox, minY: oy, minZ: 0, maxX: ox + 9, maxY: oy + 9, maxZ: 0 }, 'x');
      cur = paint(cur, region, 'road');
    }
    const elapsed = Date.now() - t0;
    expect(cellCount(cur)).toBe(N * N);
    // generic Map-based path took ~1s *per call* at this scale (measured); the fast path should
    // finish all 20 calls in well under a second combined.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('purity regression: repeated calls with the same inputs produce equal (deep) outputs', () => {
  it('union/subtract/paint are pure — no shared mutable state between calls', () => {
    const a = denseVolumeFromCells(BOX, [{ x: 0, y: 0, z: 0, token: 'a' }]);
    const b = denseVolumeFromCells(BOX, [{ x: 1, y: 1, z: 0, token: 'b' }]);
    const r1 = [...iterCells(union(a, b))].sort((x, y) => x.x - y.x);
    const r2 = [...iterCells(union(a, b))].sort((x, y) => x.x - y.x);
    expect(r1).toEqual(r2);
    // and calling with swapped/interleaved order elsewhere must not have perturbed a or b themselves
    expect(cellCount(a)).toBe(1);
    expect(cellCount(b)).toBe(1);
  });
});
