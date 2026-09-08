/**
 * Geometry DSL 端到端测试。
 *
 * 覆盖：
 *   1. parser：DSL 文本 → Statement[]（含注释/空行/数字/字符串/列表/ref）
 *   2. validate：SSA 唯一、ref 前向、op 已注册、参数 kind
 *   3. serialize：Statement → 单行字符串，round-trip 等价
 *   4. make：makeGeometry / append / emit / freshId
 *   5. summary：摘要生成 + sentinel + tooltip 字符串
 *   6. 电池：g_box / g_cylinder / g_sphere / g_material / g_part / g_joint_fixed / g_joint_revolute 协同
 *   7. URDF 导出：g_to_urdf 生成合法 XML + 各 link/joint 字段齐全
 *
 * Demo：搭一个最小 desk_lamp（底座圆柱 + 灯头球 + 一个 revolute joint）端到端跑通。
 */

import { describe, it, expect } from 'vitest';

import {
  // core
  parseDSL,
  validateStatements,
  formatStatement,
  formatStatements,
  makeGeometry,
  geometryFromSource,
  emit,
  freshId,
  isValidId,
  num,
  str,
  numList,
  ref,
  bool,
  list,
  // port / summary
  isGeometry,
  parseGeometryPort,
  summarizeGeometry,
  isGeometrySummary,
  formatGeometrySummary,
  // op-registry
  getOpSpec,
  listOpSpecs,
  type Geometry,
} from '../../vendor/dist/shared/types/index.js';

// 电池
import { gBox }          from '../../batteries/Generate/Primitive/g_box/index.ts';
import { gCylinder }     from '../../batteries/Generate/Primitive/g_cylinder/index.ts';
import { gSphere }       from '../../batteries/Generate/Primitive/g_sphere/index.ts';
import { gMaterial }     from '../../batteries/Modify/Material/g_material/index.ts';
import { gPart }         from '../../batteries/Assemble/Assembly/g_part/index.ts';
import { gJointFixed }   from '../../batteries/Assemble/Assembly/g_joint_fixed/index.ts';
import { gJointRevolute }from '../../batteries/Assemble/Assembly/g_joint_revolute/index.ts';
import { gToUrdf }       from '../../batteries/Output/Export/g_to_urdf/index.ts';

// ─────────────────────────────────────────────────────────────────────────
// 1. parser
// ─────────────────────────────────────────────────────────────────────────

describe('parser', () => {
  it('parses an empty source to zero statements with no errors', () => {
    const { statements, errors } = parseDSL('');
    expect(statements).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('skips blank lines and comments', () => {
    const src = `
# this is a comment
   # indented comment

b1 = box(size=[1, 2, 3])  # trailing comment
`;
    const { statements, errors } = parseDSL(src);
    expect(errors).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.id).toBe('b1');
    expect(statements[0]!.op).toBe('box');
    expect(statements[0]!.line).toBe(5);
  });

  it('parses numbers (int, float, neg, sci)', () => {
    const src = `n = box(size=[1, -2.5, 3e2])`;
    const { statements, errors } = parseDSL(src);
    expect(errors).toEqual([]);
    const size = statements[0]!.args.size;
    expect(size?.kind).toBe('list');
    if (size?.kind === 'list') {
      expect(size.items.map(i => i.kind === 'number' ? i.value : null)).toEqual([1, -2.5, 300]);
    }
  });

  it('parses strings with escape sequences', () => {
    const src = `m = material(rgba=[1, 0, 0, 1], texture="foo\\\\bar.png")`;
    const { statements, errors } = parseDSL(src);
    expect(errors).toEqual([]);
    const tex = statements[0]!.args.texture;
    expect(tex?.kind).toBe('string');
    if (tex?.kind === 'string') expect(tex.value).toBe('foo\\bar.png');
  });

  it('parses refs (unquoted identifiers as references)', () => {
    const src = `
b1 = box(size=[1, 1, 1])
p1 = part(shape=b1)
`;
    const { statements } = parseDSL(src);
    const shapeArg = statements[1]!.args.shape;
    expect(shapeArg?.kind).toBe('ref');
    if (shapeArg?.kind === 'ref') expect(shapeArg.name).toBe('b1');
  });

  it('parses bool literals true/false', () => {
    const src = `x = box(size=[1, 1, 1])`;  // not directly using bool in v1 ops, parser still works
    expect(parseDSL(src).errors).toEqual([]);
    const { statements } = parseDSL(`x = box(size=[true, false, 1])`);
    const sizeArg = statements[0]!.args.size;
    if (sizeArg?.kind === 'list') {
      expect(sizeArg.items[0]?.kind).toBe('bool');
      expect(sizeArg.items[1]?.kind).toBe('bool');
    }
  });

  it('handles nested lists', () => {
    const src = `x = box(size=[[1, 2], [3, 4]])`;
    const { statements, errors } = parseDSL(src);
    expect(errors).toEqual([]);
    const outer = statements[0]!.args.size;
    if (outer?.kind === 'list' && outer.items[0]?.kind === 'list') {
      expect(outer.items[0]!.items.length).toBe(2);
    }
  });

  it('tolerates trailing commas', () => {
    const src = `x = box(size=[1, 2, 3,], extra=1,)`;
    const { errors } = parseDSL(src);
    // 注意：extra 不在 op-registry 里；parser 不报错（解析层只看语法）
    expect(errors).toEqual([]);
  });

  it('reports parse errors with line numbers and does not abort following lines', () => {
    const src = `
broken =  
b2 = box(size=[1, 1, 1])
`;
    const { statements, errors } = parseDSL(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBe(2);
    // 第 3 行的合法语句仍然被解析
    expect(statements.some(s => s.id === 'b2')).toBe(true);
  });

  it('rejects unterminated strings', () => {
    const src = `m = material(texture="oops)`;
    const { errors } = parseDSL(src);
    expect(errors.some(e => /unterminated/i.test(e.message))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. validate (semantic)
// ─────────────────────────────────────────────────────────────────────────

describe('validate', () => {
  it('passes on a clean program', () => {
    const { statements } = parseDSL(`
m  = material(rgba=[0.5, 0.5, 0.5, 1])
b1 = box(size=[1, 2, 3])
p1 = part(shape=b1, material=m)
`);
    const { ok, errors } = validateStatements(statements);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it('flags duplicate ids', () => {
    const { statements } = parseDSL(`
b1 = box(size=[1, 1, 1])
b1 = sphere(radius=1)
`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'duplicate-id')).toBe(true);
  });

  it('flags unknown refs (forward / undefined)', () => {
    const { statements } = parseDSL(`
p1 = part(shape=nope)
`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'unknown-ref')).toBe(true);
  });

  it('flags unknown ops', () => {
    const { statements } = parseDSL(`x = wibble(foo=1)`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'unknown-op')).toBe(true);
  });

  it('flags missing required args', () => {
    const { statements } = parseDSL(`b1 = box()`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'bad-arg' && /required/.test(e.message))).toBe(true);
  });

  it('flags unknown kw args', () => {
    const { statements } = parseDSL(`b1 = box(size=[1, 1, 1], wat=42)`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'bad-arg' && /unknown argument/.test(e.message))).toBe(true);
  });

  it('flags wrong arg kind', () => {
    const { statements } = parseDSL(`s = sphere(radius="big")`);
    const { errors } = validateStatements(statements);
    expect(errors.some(e => e.kind === 'bad-arg' && /expects number/.test(e.message))).toBe(true);
  });

  it('accepts both storey_stack level forms (count+storey_height, or levels)', () => {
    const head = `
b = box(size=[8, 6, 0.2])
p_slab = part(shape=b)
`;
    for (const tail of [
      'lv = storey_stack(parts=[p_slab], root=p_slab, count=8, storey_height=3.2)',
      'lv = storey_stack(parts=[p_slab], root=p_slab, levels=[3.2, 6.4, 11.0])',
      'lv = storey_stack(parts=[p_slab], root=p_slab, mode="instance", count=8, storey_height=3.2)',
    ]) {
      const { statements } = parseDSL(head + tail);
      expect(validateStatements(statements).errors).toEqual([]);
    }
  });

  it('flags storey_stack parts/root that do not reference parts', () => {
    const { statements } = parseDSL(`
b = box(size=[8, 6, 0.2])
p_slab = part(shape=b)
lv = storey_stack(parts=[p_slab, b], root=b, count=2, storey_height=3.2)
`);
    const { errors } = validateStatements(statements);
    expect(errors.filter(e => /expected part/.test(e.message))).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. serialize round-trip
// ─────────────────────────────────────────────────────────────────────────

describe('serialize', () => {
  it('formats statements stably and parses back equivalently', () => {
    const src = `
mat_metal = material(rgba=[0.08, 0.085, 0.09, 1])
base_disc = cylinder(radius=0.12, length=0.032)
p_base = part(shape=base_disc, material=mat_metal)
`.trim();
    const { statements } = parseDSL(src);
    const reformatted = formatStatements(statements);
    const { statements: roundTrip, errors } = parseDSL(reformatted);
    expect(errors).toEqual([]);
    expect(roundTrip.length).toBe(statements.length);
    // 同行（位置 1..N）
    statements.forEach((orig, i) => {
      expect(roundTrip[i]!.id).toBe(orig.id);
      expect(roundTrip[i]!.op).toBe(orig.op);
      expect(roundTrip[i]!.args).toEqual(orig.args);
    });
  });

  it('escapes special chars in strings', () => {
    const stmt = {
      id: 'm', op: 'material', line: 1,
      args: { texture: { kind: 'string' as const, value: 'a"b\\c\nd' } },
    };
    const out = formatStatement(stmt);
    const { statements, errors } = parseDSL(out);
    expect(errors).toEqual([]);
    const tex = statements[0]!.args.texture;
    if (tex?.kind === 'string') expect(tex.value).toBe('a"b\\c\nd');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. make (constructor / emit / freshId / isValidId)
// ─────────────────────────────────────────────────────────────────────────

describe('make', () => {
  it('makeGeometry yields an empty immutable Geometry', () => {
    const g = makeGeometry();
    expect(g.source).toBe('');
    expect(g.statements).toEqual([]);
    expect(g.version).toBe(0);
    expect(Object.isFrozen(g)).toBe(true);
  });

  it('emit appends a new line and bumps version', () => {
    const g0 = makeGeometry();
    const g1 = emit(g0, 'b1', 'box', { size: numList([1, 2, 3]) });
    expect(g1.source).toBe('b1 = box(size=[1, 2, 3])');
    expect(g1.statements).toHaveLength(1);
    expect(g1.statements[0]!.line).toBe(1);
    expect(g1.focus).toBe('b1');
    expect(g1.version).toBe(1);
    // 不修改 g0
    expect(g0.source).toBe('');
    expect(g0.version).toBe(0);
  });

  it('emit subsequent lines accumulate', () => {
    let g = makeGeometry();
    g = emit(g, 'b1', 'box',    { size: numList([1, 1, 1]) });
    g = emit(g, 'm',  'material',{ rgba: numList([0.5, 0.5, 0.5, 1]) });
    g = emit(g, 'p1', 'part',   { shape: ref('b1'), material: ref('m') });
    expect(g.source).toContain('b1 = box');
    expect(g.source).toContain('m = material');
    expect(g.source).toContain('p1 = part');
    expect(g.statements).toHaveLength(3);
    expect(g.statements[2]!.line).toBe(3);
    expect(g.focus).toBe('p1');
  });

  it('freshId picks non-colliding names', () => {
    let g = makeGeometry();
    expect(freshId(g, 'box')).toBe('box1');
    g = emit(g, 'box1', 'box', { size: numList([1, 1, 1]) });
    expect(freshId(g, 'box')).toBe('box2');
    g = emit(g, 'box2', 'box', { size: numList([1, 1, 1]) });
    g = emit(g, 'box3', 'box', { size: numList([1, 1, 1]) });
    expect(freshId(g, 'box')).toBe('box4');
  });

  it('isValidId accepts python-identifier-shaped names', () => {
    expect(isValidId('foo')).toBe(true);
    expect(isValidId('_x_2')).toBe(true);
    expect(isValidId('Box1')).toBe(true);
    expect(isValidId('1box')).toBe(false);
    expect(isValidId('a-b')).toBe(false);
    expect(isValidId('')).toBe(false);
  });

  it('geometryFromSource parses and focuses on last stmt', () => {
    const g = geometryFromSource('b1 = box(size=[1,1,1])\np1 = part(shape=b1)');
    expect(g.statements).toHaveLength(2);
    expect(g.focus).toBe('p1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. summary & port guard
// ─────────────────────────────────────────────────────────────────────────

describe('summary & port', () => {
  it('isGeometry / parseGeometryPort', () => {
    expect(isGeometry({})).toBe(false);
    expect(isGeometry(null)).toBe(false);
    expect(isGeometry({ source: '', statements: [], version: 0 })).toBe(true);
    expect(parseGeometryPort('nope')).toBeNull();
    expect(parseGeometryPort({ source: '', statements: [], version: 0 })).not.toBeNull();
  });

  it('summarizeGeometry computes op counts + focus + preview', () => {
    let g = makeGeometry();
    g = emit(g, 'b1', 'box',     { size: numList([1, 1, 1]) });
    g = emit(g, 'b2', 'box',     { size: numList([2, 2, 2]) });
    g = emit(g, 's1', 'sphere',  { radius: num(0.5) });
    g = emit(g, 'p1', 'part',    { shape: ref('b1') });
    g = emit(g, 'p2', 'part',    { shape: ref('b2') });
    g = emit(g, 'j',  'joint',   { type: str('fixed'), parent: ref('p1'), child: ref('p2') });
    const s = summarizeGeometry(g);
    expect(s.__kind).toBe('geometry-summary');
    expect(s.statementCount).toBe(6);
    expect(s.opCounts.box).toBe(2);
    expect(s.opCounts.part).toBe(2);
    expect(s.opCounts.joint).toBe(1);
    expect(s.focus).toBe('j');
    expect(s.preview).toContain('b1 = box');
    expect(isGeometrySummary(s)).toBe(true);
    expect(formatGeometrySummary(s)).toContain('focus=j');
  });

  it('preview truncates when too many lines', () => {
    let g = makeGeometry();
    for (let i = 1; i <= 10; i++) g = emit(g, `b${i}`, 'box', { size: numList([i, i, i]) });
    const s = summarizeGeometry(g);
    expect(s.preview).toContain('... +4 more');
  });

  // NOTE: summarizeGeometryForBroadcast was intentionally removed in our refactor
  // (port values are summarized locally via summarizeGeometry; the broadcast path
  // had no consumers). The legacy test for it is dropped rather than re-adding dead code.
});

// ─────────────────────────────────────────────────────────────────────────
// 6. op-registry
// ─────────────────────────────────────────────────────────────────────────

describe('op-registry', () => {
  it('exposes v1 ops', () => {
    expect(getOpSpec('box')!.produces).toBe('shape');
    expect(getOpSpec('cylinder')!.params.find(p => p.name === 'radius')?.required).toBe(true);
    expect(getOpSpec('joint')!.produces).toBe('joint');
    expect(getOpSpec('not_a_real_op')).toBeUndefined();
    const names = listOpSpecs().map(s => s.name);
    // v1 core ops 必须全部存在（其它语义零件 / 齿轮 op 见独立 aabb / sidecar 测试）
    for (const must of ['box', 'cylinder', 'sphere', 'mesh', 'material', 'part', 'inertial', 'joint']) {
      expect(names).toContain(must);
    }
    // 同时检查 op 名全唯一
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. Batteries end-to-end: desk_lamp
// ─────────────────────────────────────────────────────────────────────────

describe('batteries: desk_lamp end-to-end', () => {
  it('chains primitives → material → parts → joints → urdf', async () => {
    // 1) 材质
    const r1 = gMaterial({ r: 0.08, g: 0.085, b: 0.09, a: 1, id: 'mat_metal' });
    expect((r1 as { id: string }).id).toBe('mat_metal');

    // 2) 底座圆柱 + 灯头球
    const r2 = gCylinder({ geometry: r1.geometry, radius: 0.12, length: 0.032, id: 'base_disc' });
    const r3 = gSphere  ({ geometry: r2.geometry, radius: 0.02,                 id: 'bulb' });

    // 3) Parts
    const r4 = gPart({
      geometry: r3.geometry, shape_id: 'base_disc', material_id: 'mat_metal',
      id: 'p_base',
    });
    const r5 = gPart({
      geometry: r4.geometry, shape_id: 'bulb', material_id: 'mat_metal',
      ox: 0.18, oz: 0.32, id: 'p_head',
    });

    // 4) 一个 revolute joint
    const r6 = gJointRevolute({
      geometry: r5.geometry,
      parent_id: 'p_base', child_id: 'p_head',
      ax: 0, ay: 1, az: 0,
      lower: -0.45, upper: 0.65,
      ox: 0.16, oz: 0.32,
      effort: 3, velocity: 1.2,
      id: 'arm_to_head',
    });

    const finalGeom = r6.geometry as Geometry;

    // ── 静态检查 ──
    expect(finalGeom.statements).toHaveLength(6);
    expect(finalGeom.focus).toBe('arm_to_head');

    // 语义 valid
    const { ok, errors } = validateStatements(finalGeom.statements);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);

    // source 行数 = 语句数
    expect(finalGeom.source.split('\n').length).toBe(6);

    // 来回 parse 等价
    const reparsed = parseDSL(finalGeom.source);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.statements.length).toBe(6);

    // ── URDF 导出 ──
    const urdfOut = await gToUrdf({ geometry: finalGeom, name: 'desk_lamp' });
    const xml = urdfOut.urdf as string;

    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<robot name="desk_lamp">');
    // 材质
    expect(xml).toMatch(/<material name="mat_metal">/);
    expect(xml).toMatch(/<color rgba="0\.08 0\.085 0\.09 1"\/>/);
    // 底座 link 含 cylinder visual
    expect(xml).toMatch(/<link name="p_base">[\s\S]*<cylinder radius="0\.12" length="0\.032"\/>[\s\S]*<\/link>/);
    // 头 link 含 sphere visual
    expect(xml).toMatch(/<link name="p_head">[\s\S]*<sphere radius="0\.02"\/>[\s\S]*<\/link>/);
    // joint
    expect(xml).toMatch(/<joint name="arm_to_head" type="revolute">/);
    expect(xml).toMatch(/<axis xyz="0 1 0"\/>/);
    expect(xml).toMatch(/<limit lower="-0\.45" upper="0\.65" effort="3" velocity="1\.2"\/>/);
    expect(xml).toContain('<parent link="p_base"/>');
    expect(xml).toContain('<child link="p_head"/>');
  });

  it('rejects part with unknown shape_id', () => {
    const out = gPart({ geometry: makeGeometry(), shape_id: 'nope' });
    expect(out.error).toBeTruthy();
    expect(out.id).toBe('');
  });

  it('rejects joint with non-existent parent/child', () => {
    const out = gJointFixed({ geometry: makeGeometry(), parent_id: 'a', child_id: 'b' });
    expect(out.error).toBeTruthy();
  });

  it('auto-generates non-colliding ids when omitted', () => {
    let g: any = gBox({ w: 1, d: 1, h: 1 });
    expect(g.id).toBe('box1');
    g = gBox({ geometry: g.geometry, w: 2, d: 2, h: 2 });
    expect(g.id).toBe('box2');
    g = gCylinder({ geometry: g.geometry, radius: 1, length: 1 });
    expect(g.id).toBe('cyl1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Inline DSL → URDF directly (no batteries)
// ─────────────────────────────────────────────────────────────────────────

describe('g_to_urdf: inline source path', () => {
  it('accepts a raw DSL source string instead of a Geometry value', async () => {
    const src = [
      'm = material(rgba=[1, 0, 0, 1])',
      'b1 = box(size=[1, 2, 3])',
      'p1 = part(shape=b1, material=m)',
      'b2 = sphere(radius=0.5)',
      'p2 = part(shape=b2)',
      'j  = joint(type="fixed", parent=p1, child=p2, origin=[0, 0, 1])',
    ].join('\n');
    const out = await gToUrdf({ source: src, name: 'inline_demo' });
    const xml = out.urdf as string;
    expect(xml).toContain('<robot name="inline_demo">');
    expect(xml).toContain('<link name="p1">');
    expect(xml).toContain('<link name="p2">');
    expect(xml).toContain('<joint name="j" type="fixed">');
    expect(xml).toMatch(/<origin xyz="0 0 1"\/>/);
  });
});

describe('g_to_urdf: strict diagnostics', () => {
  // AABB fallback silently substitutes a "plausible-looking" box for a bake that's
  // missing/failed — unlike allow_auto_wrap_orphans/allow_auto_stitch_roots (which only
  // relax graph-structure conveniences), this one can make the *geometry itself* wrong
  // without any visible sign. So allow_bake_fallback defaults to false independent of
  // `strict`: a missing bake is a hard error unless the caller explicitly opts in.
  it('fails loud on a missing bake by default, even without strict:true', async () => {
    const geom = geometryFromSource('p1 = profile_rect(w=0.8, d=0.4)');
    const out = await gToUrdf({ geometry: geom, name: 'preview_profile' });
    expect(out.error as string).toContain('BAKE_FALLBACK_USED');
    expect((out.diagnostics as Array<{ code: string; severity: string }>).some(d => d.code === 'BAKE_FALLBACK_USED' && d.severity === 'error')).toBe(true);
    expect(out.stats).toMatchObject({ implicitLinks: 1, bakeFallbacks: 1 });
  });

  it('supports an explicit allow_bake_fallback=true opt-in for lenient live preview', async () => {
    const geom = geometryFromSource('p1 = profile_rect(w=0.8, d=0.4)');
    const out = await gToUrdf({ geometry: geom, name: 'preview_profile', allow_bake_fallback: true });
    expect(out.error).toBeUndefined();
    expect(out.urdf as string).toContain('<box size="0.8 0.4 0.002"/>');
    expect((out.diagnostics as Array<{ code: string; severity: string }>).some(d => d.code === 'BAKE_FALLBACK_USED' && d.severity === 'warning')).toBe(true);
    expect(out.stats).toMatchObject({ implicitLinks: 1, bakeFallbacks: 1 });
  });

  it('fails strict delivery when a composite would use AABB fallback', async () => {
    const geom = geometryFromSource('p1 = profile_rect(w=0.8, d=0.4)');
    const out = await gToUrdf({
      geometry: geom,
      name: 'strict_profile',
      strict: true,
      asset_kind: 'static',
    });
    expect(out.error as string).toContain('BAKE_FALLBACK_USED');
    expect((out.diagnostics as Array<{ code: string; severity: string }>).some(d => d.code === 'BAKE_FALLBACK_USED' && d.severity === 'error')).toBe(true);
  });

  it('allows one strict static native terminal shape without forcing g_part', async () => {
    const geom = geometryFromSource('b1 = box(size=[1,2,3])');
    const out = await gToUrdf({
      geometry: geom,
      name: 'strict_static_box',
      strict: true,
      asset_kind: 'static',
    });
    expect(out.error).toBeUndefined();
    expect(out.urdf as string).toContain('<link name="b1_link">');
    expect(out.stats).toMatchObject({ implicitLinks: 1, bakeFallbacks: 0 });
  });

  it('requires mechanisms to include a non-fixed joint', async () => {
    const geom = geometryFromSource([
      'b1 = box(size=[1,1,1])',
      'b2 = box(size=[0.5,0.5,0.5])',
      'p1 = part(shape=b1)',
      'p2 = part(shape=b2)',
      'j1 = joint(type="fixed", parent=p1, child=p2)',
    ].join('\n'));
    const out = await gToUrdf({
      geometry: geom,
      name: 'fixed_tree',
      strict: true,
      asset_kind: 'mechanism',
    });
    expect(out.error as string).toContain('MECHANISM_REQUIRES_MOVING_JOINT');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Smoke: Arg builders + format symmetry
// ─────────────────────────────────────────────────────────────────────────

describe('Arg constructors', () => {
  it('num/str/bool/ref/list/numList compose into a Statement that round-trips', () => {
    const g = emit(makeGeometry(), 'x', 'joint', {
      type:   str('revolute'),
      parent: ref('a'),
      child:  ref('b'),
      axis:   numList([0, 0, 1]),
      lower:  num(-1),
      upper:  num(1),
      mimic:  bool(false), // 不在 op-registry，但 parser/serializer 仍合法
      box:    list([num(1), str('two'), ref('a')]),
    });
    const { statements, errors } = parseDSL(g.source);
    expect(errors).toEqual([]);
    expect(statements[0]!.args.type).toEqual({ kind: 'string', value: 'revolute' });
    expect(statements[0]!.args.parent).toEqual({ kind: 'ref', name: 'a' });
  });
});
