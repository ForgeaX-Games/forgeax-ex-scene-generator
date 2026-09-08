/**
 * g_sdf_blob 电池单测：primitives/operations 定长 tuple 解析（JSON 字符串 + 已解析数组两种
 * 输入形式）、校验报错、resolution/bounds 处理，以及发出的 DSL 语句能通过 op-registry 校验。
 */
import { describe, it, expect } from 'vitest';
import { validateStatements, type Geometry } from '../../vendor/dist/shared/types/index.js';
import { gSdfBlob } from '../../batteries/Modify/CSG/g_sdf_blob/index.ts';

function lastOf(geom: Geometry) {
  return geom.statements[geom.statements.length - 1]!;
}

describe('g_sdf_blob battery', () => {
  it('emits a valid sdf_blob statement from JSON-string primitives/operations', () => {
    const out = gSdfBlob({
      primitives: JSON.stringify([
        ['sphere', 'a', 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
        ['sphere', 'b', 0.6, 0, 0, 0.4, 0, 0, 0, 0, 0],
      ]),
      operations: JSON.stringify([['smooth-union', 'u', 'a', 'b', 0.2]]),
      resolution: 24,
      id: 'blob1',
    });
    expect(out.error).toBe('');
    expect(out.id).toBe('blob1');
    const geom = out.geometry as Geometry;
    const stmt = lastOf(geom);
    expect(stmt.op).toBe('sdf_blob');
    expect(validateStatements(geom.statements).ok).toBe(true);
  });

  it('accepts already-parsed arrays (not just JSON strings) for primitives/operations', () => {
    const out = gSdfBlob({
      primitives: [['box', 'a', 0, 0, 0, 1, 1, 1, 0, 0, 0]],
      operations: [],
      resolution: 8,
    });
    expect(out.error).toBe('');
    expect(validateStatements((out.geometry as Geometry).statements).ok).toBe(true);
  });

  it('omits the operations arg entirely when the list is empty', () => {
    const out = gSdfBlob({ primitives: [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]], resolution: 8, id: 'b' });
    const stmt = lastOf(out.geometry as Geometry);
    expect(stmt.args.operations).toBeUndefined();
  });

  it('passes explicit bounds through as a 6-number DSL list', () => {
    const out = gSdfBlob({
      primitives: [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]],
      resolution: 8,
      bounds: [-2, -2, -2, 2, 2, 2],
      id: 'b',
    });
    const stmt = lastOf(out.geometry as Geometry);
    expect(stmt.args.bounds).toEqual({
      kind: 'list',
      items: [-2, -2, -2, 2, 2, 2].map((v) => ({ kind: 'number', value: v })),
    });
  });

  it('defaults resolution to 32 when omitted', () => {
    const out = gSdfBlob({ primitives: [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]] });
    const stmt = lastOf(out.geometry as Geometry);
    expect(stmt.args.resolution).toEqual({ kind: 'number', value: 32 });
  });

  it('rejects missing primitives', () => {
    const out = gSdfBlob({ id: 'b' });
    expect(out.error).toContain('primitives');
  });

  it('rejects malformed primitives JSON', () => {
    const out = gSdfBlob({ primitives: '{not json', id: 'b' });
    expect(String(out.error)).toContain('JSON');
  });

  it('rejects a primitive tuple with the wrong length', () => {
    const out = gSdfBlob({ primitives: [['sphere', 'a', 0, 0, 0]] });
    expect(String(out.error)).toContain('primitives[0]');
  });

  it('rejects an unknown primitive type', () => {
    const out = gSdfBlob({ primitives: [['pyramid', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]] });
    expect(String(out.error)).toContain('type must be one of');
  });

  it('rejects an unknown operation type', () => {
    const out = gSdfBlob({
      primitives: [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0], ['sphere', 'b', 1, 0, 0, 1, 0, 0, 0, 0, 0]],
      operations: [['xor', 'u', 'a', 'b', 0]],
    });
    expect(String(out.error)).toContain('operations[0]');
  });

  it('rejects too many primitives (>64)', () => {
    const many = Array.from({ length: 65 }, (_, i) => ['sphere', `s${i}`, i, 0, 0, 0.1, 0, 0, 0, 0, 0]);
    const out = gSdfBlob({ primitives: many });
    expect(String(out.error)).toContain('exceeds limit 64');
  });

  it('rejects resolution out of [4, 64]', () => {
    const primitives = [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]];
    expect(String(gSdfBlob({ primitives, resolution: 3 }).error)).toContain('resolution');
    expect(String(gSdfBlob({ primitives, resolution: 65 }).error)).toContain('resolution');
  });

  it('generates a fresh id (blob{n}) when id is omitted', () => {
    const out = gSdfBlob({ primitives: [['sphere', 'a', 0, 0, 0, 1, 0, 0, 0, 0, 0]] });
    expect(out.error).toBe('');
    expect(out.id).toMatch(/^blob\d+$/);
  });
});
