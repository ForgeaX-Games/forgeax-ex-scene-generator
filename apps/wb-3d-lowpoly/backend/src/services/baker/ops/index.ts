/**
 * 各 op 的 builder 注册表。
 *
 * 这里只做 op-name → builder 的 plain map：每加一个新 op 在对应家族文件里
 * 实现一个 OpBuilder，再在这里注册一行即可。
 *
 * Phase 1 范围（14 个 Parts）：
 *   brackets:  clevis_bracket / pivot_fork / trunnion_yoke
 *   panels:    perforated_panel / slot_panel / vent_grille
 *   fans:      fan_rotor / blower_wheel
 *   controls:  knob / bezel
 *   wheels:    wheel / tire
 *   hinges:    barrel_hinge / piano_hinge
 *
 * Phase 2 范围（15 个 Gears）：
 *   单齿: spur_gear / herringbone_gear / crossed_helical_gear / hyperbolic_gear
 *   环齿: ring_gear / herringbone_ring_gear
 *   齿条: rack_gear / herringbone_rack_gear
 *   行星: planetary_gearset / herringbone_planetary_gearset
 *   锥/对: bevel_gear / bevel_gear_pair
 *   蜗杆: worm
 *   交错/双曲对: crossed_gear_pair / hyperbolic_gear_pair
 *
 * ⚠️ Phase 1（Parts）+ Phase 2（Gears）op 均已 DSL 不可达：对应电池已在 `3b752a7c`
 * （"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts 已同步
 * 移除这些 op（见 CHANGELOG "Removed"）。下面这些 builder 仍注册在 `OPS` 里、仍被
 * `getOpBuilder`/`bakeShape` 直接调用（内部测试如 baker-gears-all.smoke.ts 用），但
 * `listBakeableOps()` 会把它们过滤掉（因为已不在 op-registry 的 `listBakeableShapeOps()`
 * 里），不是死代码，只是不再是 DSL 可达 op。
 */

import type { OpBuilder } from '../types.js';
import { listBakeableShapeOps } from '../shared-types.js';

export type OpBuilderRegistry = ReadonlyMap<string, OpBuilder>;

/** 返回当前进程内所有已注册的 bake-able op 名（供 g_to_urdf 判断"该不该 bake"） */
export function listBakeableOps(): readonly string[] {
  const registered = new Set(listBakeableShapeOps());
  return Array.from(OPS.keys()).filter(op => registered.has(op));
}

/** 取某 op 的 builder；未注册返回 undefined。 */
export function getOpBuilder(opName: string): OpBuilder | undefined {
  return OPS.get(opName);
}

// ── 注册 ─────────────────────────────────────────────────────────────

import * as brackets from './brackets.js';
import * as panels from './panels.js';
import * as wheels from './wheels.js';
import * as hinges from './hinges.js';
import * as controls from './controls.js';
import * as fans from './fans.js';
import * as gears from './gears.js';
import * as primitives from './primitives.js';
import * as architecture from './architecture.js';
import * as rockOps from './rock.js';
import * as organicOps from './organic.js';

const OPS: OpBuilderRegistry = new Map<string, OpBuilder>([
  // ── Extra primitives (URDF-native box/cylinder/sphere are not baked) ──
  ['cone',    primitives.cone],
  ['capsule', primitives.capsule],
  ['torus',   primitives.torus],
  ['dome',    primitives.dome],
  // rock/boulder：icosphere + 确定性位移，直接产出三角网格（非 OCCT 实体）。
  ['rock',    rockOps.rock as OpBuilder],
  ['boulder', rockOps.boulder as OpBuilder],
  // sdf_blob：多 primitive 平滑融合（smooth-union/subtract/intersect）+ Marching Cubes，
  // 同样直接产出三角网格（非 OCCT 实体），与 rock/boulder 同类。
  ['sdf_blob', organicOps.sdfBlob as OpBuilder],

  // ── Phase 1: Parts ──
  ['clevis_bracket', brackets.clevisBracket],
  ['pivot_fork',     brackets.pivotFork],
  ['trunnion_yoke',  brackets.trunnionYoke],

  ['perforated_panel', panels.perforatedPanel],
  ['slot_panel',       panels.slotPanel],
  ['vent_grille',      panels.ventGrille],

  ['wheel', wheels.wheel],
  ['tire',  wheels.tire],

  ['barrel_hinge', hinges.barrelHinge],
  ['piano_hinge',  hinges.pianoHinge],

  ['knob',  controls.knob],
  ['bezel', controls.bezel],

  ['fan_rotor',    fans.fanRotor],
  ['blower_wheel', fans.blowerWheel],

  // ── Phase 2: Gears ──
  ['spur_gear',                     gears.spurGear],
  ['herringbone_gear',              gears.herringboneGear],
  ['crossed_helical_gear',          gears.crossedHelicalGear],
  ['hyperbolic_gear',               gears.hyperbolicGear],
  ['ring_gear',                     gears.ringGear],
  ['herringbone_ring_gear',         gears.herringboneRingGear],
  ['rack_gear',                     gears.rackGear],
  ['herringbone_rack_gear',         gears.herringboneRackGear],
  ['planetary_gearset',             gears.planetaryGearset],
  ['herringbone_planetary_gearset', gears.herringbonePlanetaryGearset],
  ['bevel_gear',                    gears.bevelGear],
  ['bevel_gear_pair',               gears.bevelGearPair],
  ['worm',                          gears.worm],
  ['crossed_gear_pair',             gears.crossedGearPair],
  ['hyperbolic_gear_pair',          gears.hyperbolicGearPair],

  // ── Architecture: 静态建筑元素 + 开口/门窗 ──
  ['wall',          architecture.wall],
  ['floor_slab',    architecture.floorSlab],
  ['stairs',        architecture.stairs],
  ['roof',          architecture.roof],
  ['facade_panel',  architecture.facadePanel],
  ['window',        architecture.windowUnit],
  ['door_frame',    architecture.doorFrame],
  ['door_leaf',     architecture.doorLeaf],
  ['railing',       architecture.railing],
  ['column',        architecture.column],
]);
