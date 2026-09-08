/**
 * Baker WASM 接通验证（vitest 不依赖）。
 *
 * 用途：
 *   - 验证 replicad-opencascadejs WASM 能在 Node + tsx 下 init
 *   - 验证 setOC 注入 replicad、boolean、tessellation 都成功
 *   - 验证 vertices / triangles 序列化成 ASCII OBJ
 *
 * 跑法：
 *   cd backend
 *   npx tsx test/baker-occt.smoke.ts
 *
 * 期望输出（数字会变，关键看不抛错且 V/T > 0）：
 *   [smoke] OCCT WASM init: ~400ms
 *   [smoke] cut: V=130 T=120 OBJ=4421B
 *   [smoke] OK
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);

async function main() {
  const t0 = Date.now();

  // 1) Emscripten 工厂；ESM 形式 default export
  const occtMod = await import('replicad-opencascadejs/src/replicad_single.js');
  const occtFactory = occtMod.default as (
    config?: { wasmBinary?: Uint8Array },
  ) => Promise<unknown>;

  // 2) Node 端最稳：直接喂 wasmBinary，跳过 locateFile / fetch
  const wasmPath = require_.resolve('replicad-opencascadejs/src/replicad_single.wasm');
  const wasmBinary = readFileSync(wasmPath);
  const oc = await occtFactory({ wasmBinary });
  const tInit = Date.now() - t0;
  console.log(`[smoke] OCCT WASM init: ${tInit}ms (wasm ${wasmBinary.byteLength}B)`);

  // 3) 注入 replicad
  const replicad = await import('replicad');
  replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);

  // 4) 最小 CSG：box 减去一个穿心圆柱（沿 +Y）
  const t1 = Date.now();
  const box = replicad.makeBaseBox(0.06, 0.04, 0.05);
  const pin = replicad.makeCylinder(0.004, 0.07, [0, -0.035, 0.025], [0, 1, 0]);
  const result = (box as InstanceType<typeof replicad.Solid>)
    .cut(pin as InstanceType<typeof replicad.Solid>);
  const tBuild = Date.now() - t1;

  // 5) Tessellate
  const t2 = Date.now();
  const mesh = result.mesh({ tolerance: 0.0001, angularTolerance: 0.5 });
  const tMesh = Date.now() - t2;

  // 6) 序列化为 OBJ ASCII
  const obj = writeObj(mesh.vertices, mesh.triangles);
  const outPath = join('/tmp', 'baker-smoke.obj');
  writeFileSync(outPath, obj);

  const vCount = mesh.vertices.length / 3;
  const tCount = mesh.triangles.length / 3;
  console.log(
    `[smoke] cut: V=${vCount} T=${tCount} OBJ=${obj.length}B  build=${tBuild}ms tess=${tMesh}ms  → ${outPath}`,
  );

  // 真切了一刀的 box 至少要有 12+ verts、12+ tris；纯 box 是 V=24/T=12，下面阈值放宽点
  if (vCount < 40 || tCount < 40) {
    console.error(`[smoke] FAIL: mesh too small (V=${vCount} T=${tCount}); boolean likely silently failed`);
    process.exit(1);
  }

  console.log(`[smoke] OK (total ${Date.now() - t0}ms)`);
}

function writeObj(vertices: number[], triangles: number[]): string {
  const lines: string[] = ['# baker smoke OBJ'];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`v ${fmt(vertices[i])} ${fmt(vertices[i + 1])} ${fmt(vertices[i + 2])}`);
  }
  for (let i = 0; i < triangles.length; i += 3) {
    lines.push(`f ${triangles[i] + 1} ${triangles[i + 1] + 1} ${triangles[i + 2] + 1}`);
  }
  lines.push('');
  return lines.join('\n');
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

main().catch((err) => {
  console.error('[smoke] error:', err);
  process.exit(1);
});
