/**
 * Baker e2e smoke: g_rock → g_part → g_to_urdf → URDF
 *   含 <mesh filename="<sha>.obj"/> + 同份 collision；
 *   配合 viewer baseUrl="/api/v1/library/blob/" 应能直接显示出 mesh。
 *   rock 是三角网格产物（COMPOSITE_BAKE_OPS 成员），永远走 OCCT bake → OBJ blob +
 *   mesh collision 路径，能覆盖到原本用 g_clevis_bracket 测的同一条链路（该电池已随
 *   3b752a7c 删除，从未迁移到承诺的 CAD/Parts 目录）。
 *
 * 跑法： cd backend && npx tsx test/baker-e2e-urdf.smoke.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { bakeShape, initBakerService } from '../src/services/baker/baker.service.js';
import { listBakeableOps } from '../src/services/baker/ops/index.js';
import type { BakerLibraryHandle } from '../src/services/baker/types.js';
import { gRock } from
  '../../batteries/Generate/Primitive/g_rock/index.js';
import { gPart } from
  '../../batteries/Assemble/Assembly/g_part/index.js';
import { gToUrdf } from
  '../../batteries/Output/Export/g_to_urdf/index.js';
import type { Geometry } from '../../vendor/dist/shared/types/index.js';

// Fake library + ctx：让 g_to_urdf 看到真正的 baker，但不依赖 SQLite。
class FakeLibrary implements BakerLibraryHandle {
  bytesByAlias = new Map<string, Buffer>();
  async importFromBuffer(buffer: Buffer, _filename: string, alias?: string) {
    const a = alias ?? _filename;
    this.bytesByAlias.set(a, buffer);
    return { alias: a, blobId: a.replace(/\.obj$/, '') };
  }
}

async function main() {
  const t0 = Date.now();
  await initBakerService();
  console.log(`[e2e] baker ready in ${Date.now() - t0}ms`);

  const lib = new FakeLibrary();

  // 1) DSL：rock → part
  const r1 = gRock({
    radius: 0.03,
    irregularity: 0.35,
    seed: 7,
    detail: 1,
    id: 'rock1',
  });
  if (r1.error) throw new Error(`g_rock: ${r1.error}`);

  const r2 = gPart({
    geometry: r1.geometry,
    shape_id: 'rock1',
    id: 'p_rock',
  });
  if (r2.error) throw new Error(`g_part: ${r2.error}`);
  console.log(`[e2e] geometry DSL: ${(r2.geometry as Geometry).statements.length} statements`);
  console.log(`---\n${(r2.geometry as Geometry).source}\n---`);

  // 2) g_to_urdf with fake ctx pointing at real baker
  const ctx = {
    services: {
      baker: {
        async bake(opName: string, args: Record<string, unknown>) {
          // 把 unknown 安全降级——args 实际就是 Record<string, Arg>
          return bakeShape(opName, args as Parameters<typeof bakeShape>[1], lib);
        },
        listBakeableOps,
      },
    },
  };

  const urdfOut = await gToUrdf({ geometry: r2.geometry, name: 'demo_rock' }, ctx);
  const xml = urdfOut.urdf as string;
  const outPath = join('/tmp', 'demo_rock.urdf');
  writeFileSync(outPath, xml);
  console.log(`[e2e] URDF written to ${outPath} (${xml.length}B)`);

  // 3) 验证关键 XML 结构
  const checks: Array<[boolean, string]> = [
    [xml.includes('<robot name="demo_rock">'), 'robot name'],
    [xml.includes('<link name="p_rock">'),     'part as link'],
    [/<mesh filename="[0-9a-f]{64}\.obj"\/>/.test(xml), '<mesh filename="<sha>.obj"/>'],
    [(xml.match(/<mesh /g) ?? []).length === 2,         'mesh in both visual and collision'],
    [!xml.includes('<!-- error'),                       'no error comments'],
    [!xml.includes('<!-- baker error'),                 'no baker error comments'],
  ];
  let ok = true;
  for (const [pass, label] of checks) {
    console.log(`[e2e] ${pass ? '✓' : '✗'} ${label}`);
    if (!pass) ok = false;
  }
  if (!ok) {
    console.error('[e2e] FAIL');
    console.error('--- URDF ---');
    console.error(xml);
    process.exit(1);
  }

  // 4) 验证 lib 里真的有 OBJ
  const meshMatch = xml.match(/<mesh filename="([0-9a-f]{64}\.obj)"\/>/);
  if (!meshMatch) throw new Error('unreachable');
  const fnameInUrdf = meshMatch[1];
  const obj = lib.bytesByAlias.get(fnameInUrdf);
  if (!obj) {
    console.error(`[e2e] FAIL: library does not contain "${fnameInUrdf}"`);
    process.exit(1);
  }
  console.log(`[e2e] ✓ library has ${fnameInUrdf} (${obj.byteLength}B)`);

  // 5) 第二次跑应缓存命中：URDF 字节应完全等同
  const tCache = Date.now();
  const urdfOut2 = await gToUrdf({ geometry: r2.geometry, name: 'demo_rock' }, ctx);
  const dt2 = Date.now() - tCache;
  if (urdfOut2.urdf !== urdfOut.urdf) {
    console.error('[e2e] FAIL: cached URDF differs from first run');
    process.exit(1);
  }
  console.log(`[e2e] ✓ cached re-run ${dt2}ms (URDF byte-identical)`);

  console.log(`[e2e] OK (total ${Date.now() - t0}ms)`);
}

main().catch((err) => {
  console.error('[e2e] error:', err);
  process.exit(1);
});
