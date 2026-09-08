/**
 * sdf_blob DSL 层参数校验单测（backend/src/services/baker/ops/organic.ts）：
 * 缺字段、非法 primitive/operation type、operation 引用未知/前向 id、resolution/数量越界。
 */
import { describe, it, expect } from 'vitest';
import { sdfBlob } from '../src/services/baker/ops/organic.js';
import { BakerError } from '../src/services/baker/errors.js';
import type { Arg } from '../src/services/baker/shared-types.js';

function num(v: number): Arg { return { kind: 'number', value: v }; }
function str(v: string): Arg { return { kind: 'string', value: v }; }
function list(items: Arg[]): Arg { return { kind: 'list', items }; }

function primitiveTuple(
  type: string, id: string, center: [number, number, number] = [0, 0, 0],
  params: [number, number, number] = [1, 0, 0], rotation: [number, number, number] = [0, 0, 0],
): Arg {
  return list([str(type), str(id), ...center.map(num), ...params.map(num), ...rotation.map(num)]);
}

function operationTuple(type: string, id: string, left: string, right: string, radius = 0): Arg {
  return list([str(type), str(id), str(left), str(right), num(radius)]);
}

function call(args: Record<string, Arg>) {
  return sdfBlob(undefined, args);
}

describe('sdfBlob op: happy path', () => {
  it('a single sphere primitive with no operations produces a mesh', () => {
    const mesh = call({ primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [1, 0, 0])]), resolution: num(8) });
    expect(mesh.kind).toBe('mesh_geometry');
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.faces.length).toBeGreaterThan(0);
  });

  it('two primitives combined via smooth-union produce a mesh', () => {
    const mesh = call({
      primitives: list([
        primitiveTuple('sphere', 'a', [-0.4, 0, 0], [0.5, 0, 0]),
        primitiveTuple('sphere', 'b', [0.4, 0, 0], [0.5, 0, 0]),
      ]),
      operations: list([operationTuple('smooth-union', 'u', 'a', 'b', 0.2)]),
      resolution: num(12),
    });
    expect(mesh.vertices.length).toBeGreaterThan(0);
  });

  it('respects explicit bounds when provided', () => {
    const mesh = call({
      primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [1, 0, 0])]),
      resolution: num(8),
      bounds: list([num(-2), num(-2), num(-2), num(2), num(2), num(2)]),
    });
    expect(mesh.vertices.length).toBeGreaterThan(0);
  });

  it('is deterministic for identical args', () => {
    const args = { primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [1, 0, 0])]), resolution: num(10) };
    expect(call(args)).toEqual(call(args));
  });
});

describe('sdfBlob op: validation errors', () => {
  it('rejects missing primitives', () => {
    expect(() => call({})).toThrow(BakerError);
    expect(() => call({})).toThrow(/primitives/);
  });

  it('rejects an empty primitives list', () => {
    expect(() => call({ primitives: list([]) })).toThrow(/primitives/);
  });

  it('rejects more than 64 primitives', () => {
    const many = Array.from({ length: 65 }, (_, i) => primitiveTuple('sphere', `s${i}`, [i, 0, 0], [0.1, 0, 0]));
    expect(() => call({ primitives: list(many) })).toThrow(/exceeds limit 64/);
  });

  it('rejects more than 128 operations', () => {
    const primitives = list([primitiveTuple('sphere', 'a', [0, 0, 0], [1, 0, 0]), primitiveTuple('sphere', 'b', [1, 0, 0], [1, 0, 0])]);
    const many = Array.from({ length: 129 }, (_, i) => operationTuple('smooth-union', `op${i}`, 'a', 'b', 0.1));
    expect(() => call({ primitives, operations: list(many) })).toThrow(/exceeds limit 128/);
  });

  it('rejects an unknown primitive type', () => {
    expect(() => call({ primitives: list([primitiveTuple('pyramid', 'a')]) })).toThrow(/unknown primitive type/);
  });

  it('rejects an unknown operation type', () => {
    const primitives = list([primitiveTuple('sphere', 'a'), primitiveTuple('sphere', 'b', [1, 0, 0])]);
    expect(() => call({ primitives, operations: list([operationTuple('xor', 'u', 'a', 'b')]) })).toThrow(/unknown operation type/);
  });

  it('rejects an operation that references an unknown id', () => {
    const primitives = list([primitiveTuple('sphere', 'a')]);
    expect(() => call({ primitives, operations: list([operationTuple('smooth-union', 'u', 'a', 'ghost', 0.1)]) })).toThrow(BakerError);
  });

  it('rejects a forward reference (operation referencing a later-declared operation id)', () => {
    const primitives = list([primitiveTuple('sphere', 'a')]);
    // 'u' references 'later', which is only declared by the *next* operation — must be rejected.
    const operations = list([
      operationTuple('smooth-union', 'u', 'a', 'later', 0.1),
      operationTuple('smooth-union', 'later', 'a', 'a', 0.1),
    ]);
    expect(() => call({ primitives, operations })).toThrow(BakerError);
  });

  it('rejects duplicate primitive ids', () => {
    const primitives = list([primitiveTuple('sphere', 'dup'), primitiveTuple('sphere', 'dup', [1, 0, 0])]);
    expect(() => call({ primitives })).toThrow(/duplicate primitive id/);
  });

  it('rejects duplicate operation ids', () => {
    const primitives = list([primitiveTuple('sphere', 'a'), primitiveTuple('sphere', 'b', [1, 0, 0]), primitiveTuple('sphere', 'c', [2, 0, 0])]);
    const operations = list([
      operationTuple('smooth-union', 'dup', 'a', 'b', 0.1),
      operationTuple('smooth-union', 'dup', 'a', 'c', 0.1),
    ]);
    expect(() => call({ primitives, operations })).toThrow(/duplicate operation id/);
  });

  it('rejects resolution below 4 or above 64', () => {
    const primitives = list([primitiveTuple('sphere', 'a')]);
    expect(() => call({ primitives, resolution: num(3) })).toThrow(/resolution/);
    expect(() => call({ primitives, resolution: num(65) })).toThrow(/resolution/);
  });

  it('rejects non-positive sphere radius', () => {
    expect(() => call({ primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [0, 0, 0])]) })).toThrow(/radius/);
    expect(() => call({ primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [-1, 0, 0])]) })).toThrow(/radius/);
  });

  it('rejects non-positive box size components', () => {
    expect(() => call({ primitives: list([primitiveTuple('box', 'a', [0, 0, 0], [1, 1, 0])]) })).toThrow(/box/);
  });

  it('rejects malformed bounds (max <= min)', () => {
    const primitives = list([primitiveTuple('sphere', 'a')]);
    expect(() => call({ primitives, bounds: list([num(1), num(-1), num(-1), num(-1), num(1), num(1)]) })).toThrow(/bounds/);
  });

  it('rejects a primitive tuple with the wrong length', () => {
    expect(() => call({ primitives: list([list([str('sphere'), str('a')])]) })).toThrow(/list of exactly/);
  });
});
