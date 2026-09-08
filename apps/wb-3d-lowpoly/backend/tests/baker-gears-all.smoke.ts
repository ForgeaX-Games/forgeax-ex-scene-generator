/**
 * Baker 全部 15 个 Phase 2 Gear op 的烘焙烟雾测试。
 *
 * 每个 op：
 *   1) 默认参数烘成功，顶点/三角形 > 0
 *   2) 改一个参数后 sha 必须变化
 *   3) 同参数重复跑必命中缓存
 *
 * 跑法：
 *   cd backend && npx tsx test/baker-gears-all.smoke.ts
 *
 * 环境变量：
 *   BAKE_OUT_DIR — OBJ 落盘目录（默认 /tmp/baker-gears-all）
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { bakeShape, initBakerService } from '../src/services/baker/baker.service.js';
import type { BakerLibraryHandle } from '../src/services/baker/types.js';
import { num } from '../../vendor/dist/shared/types/index.js';
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
  variant: Record<string, Arg>;
}

// 公制单位：module=0.001 ≈ 1mm 模数；典型小齿轮 module=0.002（2mm 模数）
const M = 0.002;

const CASES: Case[] = [
  // ── 单齿轮 ──
  {
    op: 'spur_gear',
    base: { module: num(M), teeth_number: num(20), width: num(0.01) },
    variant: { teeth_number: num(24) },
  },
  {
    op: 'herringbone_gear',
    base: { module: num(M), teeth_number: num(20), width: num(0.012), helix_angle: num(20) },
    variant: { helix_angle: num(30) },
  },
  {
    op: 'crossed_helical_gear',
    base: { module: num(M), teeth_number: num(20), width: num(0.01), helix_angle: num(45) },
    variant: { teeth_number: num(18) },
  },
  {
    op: 'hyperbolic_gear',
    base: { module: num(M), teeth_number: num(20), width: num(0.012), twist_angle: num(20) },
    variant: { twist_angle: num(30) },
  },

  // ── 环齿轮 ──
  {
    op: 'ring_gear',
    base: { module: num(M), teeth_number: num(40), width: num(0.01), rim_width: num(0.005) },
    variant: { rim_width: num(0.008) },
  },
  {
    op: 'herringbone_ring_gear',
    base: { module: num(M), teeth_number: num(40), width: num(0.012), rim_width: num(0.005), helix_angle: num(15) },
    variant: { helix_angle: num(25) },
  },

  // ── 齿条 ──
  {
    op: 'rack_gear',
    base: { module: num(M), length: num(0.06), width: num(0.01), height: num(0.005) },
    variant: { length: num(0.08) },
  },
  {
    op: 'herringbone_rack_gear',
    base: { module: num(M), length: num(0.06), width: num(0.012), height: num(0.005), helix_angle: num(15) },
    variant: { length: num(0.08) },
  },

  // ── 行星齿轮组 ──
  // 注意：planet 数 = 3 时 (sun+planet)%3 == (12+18)%3 == 0 → 啮合 OK
  {
    op: 'planetary_gearset',
    base: {
      module: num(M),
      sun_teeth_number: num(12),
      planet_teeth_number: num(18),
      width: num(0.01),
      rim_width: num(0.005),
      n_planets: num(3),
    },
    variant: { n_planets: num(4), planet_teeth_number: num(20) },
  },
  {
    op: 'herringbone_planetary_gearset',
    base: {
      module: num(M),
      sun_teeth_number: num(12),
      planet_teeth_number: num(18),
      width: num(0.012),
      rim_width: num(0.005),
      n_planets: num(3),
      helix_angle: num(15),
    },
    variant: { helix_angle: num(20) },
  },

  // ── 锥齿轮 ──
  {
    op: 'bevel_gear',
    base: { module: num(M), teeth_number: num(20), cone_angle: num(45), face_width: num(0.008) },
    variant: { cone_angle: num(30) },
  },
  {
    op: 'bevel_gear_pair',
    base: { module: num(M), gear_teeth: num(30), pinion_teeth: num(15), face_width: num(0.008) },
    variant: { axis_angle: num(60) },
  },

  // ── 蜗杆 ──
  {
    op: 'worm',
    base: { module: num(M), lead_angle: num(5), n_threads: num(1), length: num(0.03) },
    variant: { n_threads: num(2) },
  },

  // ── 交错斜齿对 / 双曲对 ──
  {
    op: 'crossed_gear_pair',
    base: {
      module: num(M),
      gear1_teeth_number: num(20),
      gear2_teeth_number: num(24),
      gear1_width: num(0.01),
      gear2_width: num(0.01),
    },
    variant: { shaft_angle: num(60) },
  },
  {
    op: 'hyperbolic_gear_pair',
    base: {
      module: num(M),
      gear1_teeth_number: num(20),
      width: num(0.012),
      shaft_angle: num(30),
    },
    variant: { shaft_angle: num(45) },
  },
];

async function main(): Promise<void> {
  const t0 = Date.now();
  await initBakerService();
  console.log(`[smoke] baker ready in ${Date.now() - t0}ms`);

  const outDir = process.env.BAKE_OUT_DIR ?? '/tmp/baker-gears-all';
  mkdirSync(outDir, { recursive: true });

  const lib = new FakeLibrary();
  let passed = 0;
  let failed = 0;
  const seenShas = new Map<string, string>();

  for (const c of CASES) {
    const tag = `[${c.op.padEnd(30)}]`;
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
        `${tag} OK  sha=${baseRes.sha256.slice(0, 8)} V=${String(baseRes.vertexCount).padStart(5)} ` +
        `T=${String(baseRes.triangleCount).padStart(5)} ${String(baseRes.byteSize).padStart(7)}B  ` +
        `bake=${String(dt1).padStart(4)}ms cache=${String(dt2).padStart(3)}ms variant=${String(dt3).padStart(4)}ms`,
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
