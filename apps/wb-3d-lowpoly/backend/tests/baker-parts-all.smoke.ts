/**
 * Baker 全部 14 个 Phase 1 op 的烘焙烟雾测试：
 *   brackets: clevis_bracket / pivot_fork / trunnion_yoke
 *   panels:   perforated_panel / slot_panel / vent_grille
 *   wheels:   wheel / tire
 *   hinges:   barrel_hinge / piano_hinge
 *   controls: knob / bezel
 *   fans:     fan_rotor / blower_wheel
 *
 * 每个 op：
 *   1) 默认参数烘成功，顶点/三角形 > 0
 *   2) 改一个参数后 sha 必须变化
 *   3) 同参数重复跑必命中缓存
 *
 * 跑法：
 *   cd backend
 *   npx tsx test/baker-parts-all.smoke.ts
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { bakeShape, initBakerService } from '../src/services/baker/baker.service.js';
import type { BakerLibraryHandle } from '../src/services/baker/types.js';
import { num, numList, bool, str } from '../../vendor/dist/shared/types/index.js';
import type { Arg } from '../../vendor/dist/shared/types/index.js';

class FakeLibrary implements BakerLibraryHandle {
  bytesByAlias = new Map<string, Buffer>();
  async importFromBuffer(buffer: Buffer, filename: string, alias?: string): Promise<{ alias: string; blobId: string }> {
    const a = alias ?? filename;
    this.bytesByAlias.set(a, buffer);
    return { alias: a, blobId: a.replace(/\.obj$/, '') };
  }
}

interface Case {
  op: string;
  base: Record<string, Arg>;
  /** 变体参数；必须导致与 base 不同 sha */
  variant: Record<string, Arg>;
}

const CASES: Case[] = [
  {
    op: 'clevis_bracket',
    base: {
      overall_size:   numList([0.06, 0.04, 0.05]),
      gap_width:      num(0.02),
      bore_diameter:  num(0.008),
      bore_center_z:  num(0.035),
      base_thickness: num(0.01),
      corner_radius:  num(0.003),
    },
    variant: { corner_radius: num(0.001) },
  },
  {
    op: 'pivot_fork',
    base: {
      overall_size:     numList([0.06, 0.04, 0.05]),
      gap_width:        num(0.03),
      bore_diameter:    num(0.008),
      bore_center_z:    num(0.035),
      bridge_thickness: num(0.008),
      corner_radius:    num(0.002),
    },
    variant: { gap_width: num(0.035) },
  },
  {
    op: 'trunnion_yoke',
    base: {
      overall_size:      numList([0.08, 0.05, 0.06]),
      span_width:        num(0.04),
      trunnion_diameter: num(0.012),
      trunnion_center_z: num(0.04),
      base_thickness:    num(0.01),
      corner_radius:     num(0.003),
    },
    variant: { trunnion_diameter: num(0.01) },
  },
  {
    op: 'perforated_panel',
    base: {
      panel_size:    numList([0.08, 0.06]),
      thickness:     num(0.003),
      hole_diameter: num(0.004),
      pitch:         num(0.008),
      frame:         num(0.006),
      corner_radius: num(0.002),
    },
    variant: { hole_diameter: num(0.005) },
  },
  {
    op: 'slot_panel',
    base: {
      panel_size:     numList([0.08, 0.06]),
      thickness:      num(0.003),
      slot_size:      numList([0.012, 0.004]),
      pitch:          numList([0.018, 0.010]),
      frame:          num(0.006),
      slot_angle_deg: num(0),
    },
    variant: { slot_angle_deg: num(20) },
  },
  {
    op: 'vent_grille',
    base: {
      panel_size:      numList([0.1, 0.08]),
      frame:           num(0.012),
      face_thickness:  num(0.004),
      duct_depth:      num(0.02),
      duct_wall:       num(0.0025),
      slat_pitch:      num(0.018),
      slat_width:      num(0.009),
      slat_angle_deg:  num(35),
    },
    variant: { slat_pitch: num(0.022) },
  },
  {
    op: 'wheel',
    base: {
      radius: num(0.04),
      width:  num(0.02),
    },
    variant: { radius: num(0.05) },
  },
  {
    op: 'tire',
    base: {
      outer_radius: num(0.05),
      inner_radius: num(0.035),
      width:        num(0.02),
    },
    variant: { inner_radius: num(0.040) },
  },
  {
    op: 'barrel_hinge',
    base: {
      length:                 num(0.06),
      leaf_width_a:           num(0.02),
      leaf_width_b:           num(0.02),
      leaf_thickness:         num(0.003),
      pin_diameter:           num(0.003),
      knuckle_outer_diameter: num(0.006),
      knuckle_count:          num(3),
      open_angle_deg:         num(90),
    },
    variant: { open_angle_deg: num(135) },
  },
  {
    op: 'piano_hinge',
    base: {
      length:         num(0.12),
      leaf_width_a:   num(0.02),
      leaf_width_b:   num(0.02),
      leaf_thickness: num(0.0015),
      pin_diameter:   num(0.0025),
      knuckle_pitch:  num(0.012),
      open_angle_deg: num(180),
    },
    variant: { open_angle_deg: num(120) },
  },
  {
    op: 'knob',
    base: {
      diameter:   num(0.025),
      height:     num(0.018),
      body_style: str('cylindrical'),
    },
    variant: { body_style: str('tapered'), top_diameter: num(0.018) },
  },
  {
    op: 'bezel',
    base: {
      opening_size:  numList([0.08, 0.05]),
      outer_size:    numList([0.1, 0.07]),
      depth:         num(0.005),
      opening_shape: str('rect'),
      outer_shape:   str('rect'),
    },
    variant: { opening_shape: str('rounded_rect'), opening_corner_radius: num(0.005) },
  },
  {
    op: 'fan_rotor',
    base: {
      outer_radius:    num(0.04),
      hub_radius:      num(0.01),
      blade_count:     num(5),
      thickness:       num(0.012),
      blade_pitch_deg: num(28),
      blade_sweep_deg: num(20),
    },
    variant: { blade_pitch_deg: num(35) },
  },
  {
    op: 'blower_wheel',
    base: {
      outer_radius:    num(0.05),
      inner_radius:    num(0.035),
      width:           num(0.04),
      blade_count:     num(24),
      blade_thickness: num(0.0015),
      blade_sweep_deg: num(35),
      backplate:       bool(true),
      shroud:          bool(false),
    },
    variant: { blade_count: num(18) },
  },
];

async function main() {
  const t0 = Date.now();
  await initBakerService();
  console.log(`[smoke] baker ready in ${Date.now() - t0}ms`);

  const outDir = process.env.BAKE_OUT_DIR ?? '/tmp/baker-parts-all';
  mkdirSync(outDir, { recursive: true });

  const lib = new FakeLibrary();
  let passed = 0;
  let failed = 0;
  const seenShas = new Map<string, string>();

  for (const c of CASES) {
    const tag = `[${c.op.padEnd(16)}]`;
    try {
      console.log(`${tag} START`);
      const t1 = Date.now();
      const baseRes = await bakeShape(c.op, c.base, lib);
      const dt1 = Date.now() - t1;

      if (baseRes.vertexCount === 0 || baseRes.triangleCount === 0) {
        throw new Error(`empty mesh: V=${baseRes.vertexCount} T=${baseRes.triangleCount}`);
      }
      if (seenShas.has(baseRes.sha256)) {
        throw new Error(`sha collision with ${seenShas.get(baseRes.sha256)}`);
      }
      seenShas.set(baseRes.sha256, c.op);

      const objBytes = lib.bytesByAlias.get(baseRes.url);
      if (objBytes) writeFileSync(join(outDir, `${c.op}.obj`), objBytes);

      const t2 = Date.now();
      const cachedRes = await bakeShape(c.op, c.base, lib);
      const dt2 = Date.now() - t2;
      if (!cachedRes.cacheHit) throw new Error('expected cache hit on repeat');
      if (cachedRes.sha256 !== baseRes.sha256) throw new Error('cache sha mismatch');

      const variantArgs: Record<string, Arg> = { ...c.base, ...c.variant };
      const t3 = Date.now();
      const variantRes = await bakeShape(c.op, variantArgs, lib);
      const dt3 = Date.now() - t3;
      if (variantRes.sha256 === baseRes.sha256) {
        throw new Error('variant should produce different sha');
      }

      console.log(
        `${tag} OK  sha=${baseRes.sha256.slice(0, 8)} V=${String(baseRes.vertexCount).padStart(4)} ` +
        `T=${String(baseRes.triangleCount).padStart(4)} ${baseRes.byteSize}B  ` +
        `bake=${dt1}ms cache=${dt2}ms variant=${dt3}ms`,
      );
      passed++;
    } catch (err) {
      const e = err as Error;
      console.error(`${tag} FAIL: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[smoke] ${passed}/${CASES.length} passed (${failed} failed) in ${Date.now() - t0}ms`);
  console.log(`[smoke] OBJ files written to ${outDir}/`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
