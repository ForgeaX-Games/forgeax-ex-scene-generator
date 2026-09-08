/**
 * Geometry 语义校验：parse 之后跑一遍 statements，检查
 *   1. id 唯一（SSA 约束）
 *   2. ref 指向已定义且在当前语句之前的 id（前向无依赖）
 *   3. op 在 op-registry 里登记
 *   4. 必填参数齐全 + 参数 kind 匹配
 *
 * 与 parser 的分工：parser 只管语法；validate 管语义。
 * 永不抛异常；返回 errors 数组（parser 错也会一并报告，便于一次性诊断）。
 */

import type { Arg, GeometryError, Statement } from './types.js';
import { argMatchesKind, getOpSpec, opProduces } from './op-registry.js';

export interface ValidateResult {
  ok: boolean;
  errors: GeometryError[];
}

export function validateStatements(stmts: readonly Statement[]): ValidateResult {
  const errors: GeometryError[] = [];
  const known = new Set<string>();
  const byId = new Map<string, Statement>();

  for (const stmt of stmts) {
    // 1. id 唯一
    if (known.has(stmt.id)) {
      errors.push({
        message: `duplicate id "${stmt.id}"`,
        line: stmt.line,
        kind: 'duplicate-id',
      });
    } else {
      known.add(stmt.id);
      byId.set(stmt.id, stmt);
    }

    // 2. op 已注册
    const spec = getOpSpec(stmt.op);
    if (!spec) {
      errors.push({
        message: `unknown op "${stmt.op}"`,
        line: stmt.line,
        kind: 'unknown-op',
      });
      continue;
    }

    // 3. 必填参数检查
    for (const param of spec.params) {
      if (param.required && !(param.name in stmt.args)) {
        errors.push({
          message: `op "${stmt.op}" missing required argument "${param.name}"`,
          line: stmt.line,
          kind: 'bad-arg',
        });
      }
    }

    // 4. 参数 kind 检查 + 未知参数检查 + ref 指向校验
    const allowed = new Set(spec.params.map(p => p.name));
    for (const [k, v] of Object.entries(stmt.args)) {
      if (!allowed.has(k)) {
        errors.push({
          message: `op "${stmt.op}" got unknown argument "${k}"`,
          line: stmt.line,
          kind: 'bad-arg',
        });
        continue;
      }
      const param = spec.params.find(p => p.name === k)!;
      if (!param.kinds.some(kind => argMatchesKind(v, kind))) {
        errors.push({
          message: `op "${stmt.op}" arg "${k}" expects ${param.kinds.join('|')}, got ${v.kind}`,
          line: stmt.line,
          kind: 'bad-arg',
        });
      }
      // ref 类参数 / 列表里嵌套的 ref 都要回查 known
      checkRefs(v, known, stmt.line, errors);
    }
    checkSemanticRefs(stmt, byId, errors);
  }

  return { ok: errors.length === 0, errors };
}

function checkSemanticRefs(
  stmt: Statement,
  byId: ReadonlyMap<string, Statement>,
  errors: GeometryError[],
): void {
  if (stmt.op === 'part') {
    const shape = stmt.args.shape;
    if (shape?.kind === 'ref') {
      expectProduces(stmt, 'shape', shape.name, 'shape', byId, errors);
    }
    const material = stmt.args.material;
    if (material?.kind === 'ref') {
      expectProduces(stmt, 'material', material.name, 'material', byId, errors);
    }
  } else if (stmt.op === 'joint') {
    const parent = stmt.args.parent;
    const child = stmt.args.child;
    if (parent?.kind === 'ref') expectProduces(stmt, 'parent', parent.name, 'part', byId, errors);
    if (child?.kind === 'ref') expectProduces(stmt, 'child', child.name, 'part', byId, errors);
    if (parent?.kind === 'ref' && child?.kind === 'ref' && parent.name === child.name) {
      errors.push({
        message: `op "joint" parent and child must differ`,
        line: stmt.line,
        kind: 'bad-arg',
      });
    }
    const mimic = stmt.args.mimic_joint;
    if (mimic?.kind === 'ref') expectProduces(stmt, 'mimic_joint', mimic.name, 'joint', byId, errors);
  } else if (stmt.op === 'collision') {
    const link = stmt.args.link;
    if (link?.kind === 'ref') expectProduces(stmt, 'link', link.name, 'part', byId, errors);
    const shape = stmt.args.shape;
    if (shape?.kind === 'ref') expectProduces(stmt, 'shape', shape.name, 'shape', byId, errors);
    const geometryArgs = ['box', 'cylinder', 'sphere_radius', 'shape'].filter(name => stmt.args[name] !== undefined);
    if (geometryArgs.length !== 1) {
      errors.push({
        message: `op "collision" must provide exactly one geometry descriptor: box, cylinder, sphere_radius, or shape`,
        line: stmt.line,
        kind: 'bad-arg',
      });
    }
  } else if (stmt.op === 'inertial') {
    const link = stmt.args.link;
    if (link?.kind === 'ref') expectProduces(stmt, 'link', link.name, 'part', byId, errors);
  } else if (stmt.op === 'extrude' || stmt.op === 'revolve' || stmt.op === 'sweep') {
    const profile = stmt.args.profile;
    if (profile?.kind === 'ref') expectProduces(stmt, 'profile', profile.name, 'sketch', byId, errors);
  } else if (stmt.op === 'extrude_with_holes') {
    const outer = stmt.args.outer;
    if (outer?.kind === 'ref') expectProduces(stmt, 'outer', outer.name, 'sketch', byId, errors);
    const holes = stmt.args.holes;
    if (holes?.kind === 'list') {
      for (const item of holes.items) {
        if (item.kind === 'ref') expectProduces(stmt, 'holes', item.name, 'sketch', byId, errors);
      }
    }
  } else if (stmt.op === 'loft') {
    const profiles = stmt.args.profiles;
    if (profiles?.kind === 'list') {
      for (const item of profiles.items) {
        if (item.kind === 'ref') expectProduces(stmt, 'profiles', item.name, 'sketch', byId, errors);
      }
    }
  } else if (stmt.op === 'union' || stmt.op === 'intersection') {
    const a = stmt.args.a;
    const b = stmt.args.b;
    if (a?.kind === 'ref') expectProduces(stmt, 'a', a.name, 'shape', byId, errors);
    if (b?.kind === 'ref') expectProduces(stmt, 'b', b.name, 'shape', byId, errors);
  } else if (stmt.op === 'difference') {
    const base = stmt.args.base;
    const tool = stmt.args.tool;
    if (base?.kind === 'ref') expectProduces(stmt, 'base', base.name, 'shape', byId, errors);
    if (tool?.kind === 'ref') expectProduces(stmt, 'tool', tool.name, 'shape', byId, errors);
  } else if (stmt.op === 'translate' || stmt.op === 'rotate' || stmt.op === 'scale' || stmt.op === 'mirror' || stmt.op === 'array_linear' || stmt.op === 'array_radial') {
    const shape = stmt.args.shape;
    if (shape?.kind === 'ref') expectProduces(stmt, 'shape', shape.name, 'shape', byId, errors);
  } else if (stmt.op === 'bone' || stmt.op === 'bone_chain') {
    const parent = stmt.args.parent;
    if (parent?.kind === 'ref') expectProduces(stmt, 'parent', parent.name, 'bone', byId, errors);
    // source_part 目前只在这里被"消费"——校验它指向一个真的 part。g_to_rig 的 RigBone
    // 和自动蒙皮都不读它，纯粹是给人/agent看的溯源提示（见 op-registry.ts 的 bone desc）。
    const sourcePart = stmt.args.source_part;
    if (sourcePart?.kind === 'ref') expectProduces(stmt, 'source_part', sourcePart.name, 'part', byId, errors);
  } else if (stmt.op === 'storey_stack') {
    const parts = stmt.args.parts;
    if (parts?.kind === 'list') {
      for (const item of parts.items) {
        if (item.kind === 'ref') expectProduces(stmt, 'parts', item.name, 'part', byId, errors);
      }
    }
    const root = stmt.args.root;
    if (root?.kind === 'ref') expectProduces(stmt, 'root', root.name, 'part', byId, errors);
  } else if (stmt.op === 'skeleton') {
    const root = stmt.args.root;
    if (root?.kind === 'ref') expectProduces(stmt, 'root', root.name, 'bone', byId, errors);
  } else if (stmt.op === 'skin') {
    const skeleton = stmt.args.skeleton;
    if (skeleton?.kind === 'ref') expectProduces(stmt, 'skeleton', skeleton.name, 'skeleton', byId, errors);
    const mesh = stmt.args.mesh;
    if (mesh?.kind === 'ref') expectProduces(stmt, 'mesh', mesh.name, 'shape', byId, errors);
  }
}

function expectProduces(
  stmt: Statement,
  argName: string,
  refName: string,
  produces: 'shape' | 'material' | 'part' | 'joint' | 'sketch' | 'bone' | 'skeleton' | 'skin',
  byId: ReadonlyMap<string, Statement>,
  errors: GeometryError[],
): void {
  const target = byId.get(refName);
  if (!target) return;
  if (!opProduces(target.op, produces)) {
    errors.push({
      message: `op "${stmt.op}" arg "${argName}" references "${refName}" (op "${target.op}"), expected ${produces}`,
      line: stmt.line,
      kind: 'bad-arg',
    });
  }
}

function checkRefs(
  arg: Arg,
  known: ReadonlySet<string>,
  line: number,
  errors: GeometryError[],
): void {
  if (arg.kind === 'ref') {
    if (!known.has(arg.name)) {
      errors.push({
        message: `reference to undefined id "${arg.name}"`,
        line,
        kind: 'unknown-ref',
      });
    }
  } else if (arg.kind === 'list') {
    for (const item of arg.items) checkRefs(item, known, line, errors);
  }
}
