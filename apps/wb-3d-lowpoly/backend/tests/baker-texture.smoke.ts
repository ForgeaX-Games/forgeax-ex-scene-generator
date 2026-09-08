/**
 * baker-texture.smoke.ts —— 端到端验证贴图/PBR 参数烘焙链路：
 *   DSL (box + texture + material + part) → g_bake_object 电池
 *   → baker.service.bakeColoredAssembly（真 OCCT + uv-from-faces.ts）
 *   → glb_export.ts groupsToGlb → 解析产出的 .glb 二进制，断言：
 *     - materials[0].pbrMetallicRoughness 的 metallicFactor/roughnessFactor 匹配 DSL 显式值
 *     - materials[0].pbrMetallicRoughness.baseColorTexture 存在
 *     - images[0]/textures[0]/samplers[0] 存在，image 字节还原后等于源 PNG
 *     - primitives[0].attributes.TEXCOORD_0 存在
 *   另外单独跑 meshShapeWithUvs 的按面精确校验（box 的 6 个 PLANE + 圆柱的 1 个
 *   CYLINDRE 侧面），因为 GLB 里同一 mesh 多个面的顶点混在一起后没法反推单面 UV 边界。
 *
 * 不跑浏览器 GLTFLoader（Node 无 DOM，Image/URL.createObjectURL 缺失）——
 * 直接校验 GLB 的 JSON chunk + BIN chunk 结构，这是本项目对贴图 GLB 的
 * verify_frontend 覆盖手段（跟纯二进制格式契约打交道，比强行拉浏览器环境更稳）。
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gBakeObject } from '../../batteries/Output/Bake/g_bake_object/index.js';
import { createBakerServices } from '../src/services/baker-context.js';
import { geometryFromSource } from '../../vendor/dist/shared/types/index.js';
import { initBakerService } from '../src/services/baker/baker.service.js';
import { meshShapeWithUvs } from '../src/services/baker/uv-from-faces.js';
import { DEFAULT_TESSELLATION } from '../src/services/baker/types.js';
import { safeDelete } from '../src/services/baker/op_helpers.js';

// 1x1 红色 PNG（最小合法 PNG，67 字节）
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

const DSL = `
b1 = box(size=[1, 1, 1])
t1 = texture(image="wood.png", repeat=[2, 3], offset=[0.1, 0.2], rotation=0)
m1 = material(rgba=[0.8, 0.4, 0.2, 1], texture=t1, metalness=0.2, roughness=0.6)
p1 = part(shape=b1, material=m1)
`;

interface GlbParsed {
  json: {
    materials: Array<{ pbrMetallicRoughness?: Record<string, unknown> }>;
    images?: Array<{ bufferView: number; mimeType: string }>;
    textures?: Array<{ source: number; sampler: number }>;
    samplers?: Array<Record<string, unknown>>;
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; material: number }> }>;
    bufferViews: Array<{ byteOffset: number; byteLength: number }>;
    accessors: Array<{ bufferView: number; componentType: number; count: number; type: string }>;
  };
  bin: Buffer;
}

function parseGlb(bytes: Buffer): GlbParsed {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('bad GLB magic');
  const jsonLen = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('expected JSON chunk first');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLen)) as GlbParsed['json'];
  const binChunkStart = 20 + jsonLen;
  const binLen = bytes.readUInt32LE(binChunkStart);
  const bin = bytes.subarray(binChunkStart + 8, binChunkStart + 8 + binLen);
  return { json, bin };
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'wb-lowpoly-tex-smoke-'));
  const texturesDir = join(workDir, 'assets', 'textures');
  const libDir = join(workDir, 'library');
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(texturesDir, { recursive: true });
  writeFileSync(join(texturesDir, 'wood.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));

  const bakerServices = createBakerServices(libDir);
  const geom = geometryFromSource(DSL);

  const ctx = {
    services: {
      baker: bakerServices.baker,
      assetsDir: join(workDir, 'assets'),
    },
  };

  const result = (await gBakeObject({ geometry: geom }, ctx)) as Record<string, unknown>;
  if (result.error) throw new Error(`gBakeObject failed: ${result.error}`);
  console.log(`[OK]   gBakeObject → ${result.filename} V=${result.vertexCount} T=${result.triangleCount}`);

  // gBakeObject 不直接暴露磁盘路径，只给 filename/sha256；直接扫 library 内容寻址目录取字节。
  const glbBytes = await findBakedGlbBytes(libDir);
  const { json } = parseGlb(glbBytes);

  assert(json.materials.length === 1, `expected 1 material, got ${json.materials.length}`);
  const mat = json.materials[0]!.pbrMetallicRoughness as Record<string, unknown>;
  assert(Math.abs((mat.metallicFactor as number) - 0.2) < 1e-6, `metallicFactor should be 0.2, got ${mat.metallicFactor}`);
  assert(Math.abs((mat.roughnessFactor as number) - 0.6) < 1e-6, `roughnessFactor should be 0.6, got ${mat.roughnessFactor}`);
  assert(!!mat.baseColorTexture, 'material should have baseColorTexture');
  console.log(`[OK]   material.pbrMetallicRoughness = ${JSON.stringify(mat)}`);

  assert((json.images?.length ?? 0) === 1, `expected 1 image, got ${json.images?.length}`);
  assert((json.textures?.length ?? 0) === 1, `expected 1 texture, got ${json.textures?.length}`);
  assert((json.samplers?.length ?? 0) === 1, `expected 1 sampler, got ${json.samplers?.length}`);
  console.log('[OK]   images/textures/samplers each = 1 (dedup path exercised)');

  const prim = json.meshes[0]!.primitives[0]!;
  assert(prim.attributes.POSITION !== undefined, 'primitive missing POSITION accessor');
  assert(prim.attributes.TEXCOORD_0 !== undefined, 'primitive missing TEXCOORD_0 accessor (UV not written)');
  console.log('[OK]   primitive has POSITION + TEXCOORD_0 attributes');

  // 校验图片字节原样还原（bufferView 指向的字节 == 源 PNG）。
  const imgView = json.bufferViews[json.images![0]!.bufferView]!;
  const { bin } = parseGlb(glbBytes);
  const restoredPng = bin.subarray(imgView.byteOffset, imgView.byteOffset + imgView.byteLength);
  assert(restoredPng.equals(Buffer.from(TINY_PNG_BASE64, 'base64')), 'embedded image bytes do not match source PNG');
  console.log('[OK]   embedded image bytes match source PNG exactly');

  const uvAcc = json.accessors[prim.attributes.TEXCOORD_0]!;
  assert(uvAcc.type === 'VEC2' && uvAcc.componentType === 5126, 'TEXCOORD_0 accessor should be float VEC2');
  console.log('[OK]   TEXCOORD_0 accessor is float VEC2');

  // 精确 UV 单测：box 6 面全是 PLANE，每面各自 1x1 米、各自独立的 UV 原点/朝向——
  // 不能把 6 面的顶点混在一起求全局 min/max（origin 不同，会互相抬高聚合 span）。
  // 直接调 meshShapeWithUvs，按 shape.mesh() 的 faceGroups 分面校验：每个面自己的
  // (max-min) U span ≈ repeat_u、V span ≈ repeat_v（PLANE 精确路径，零失真）。
  await verifyPlaneFaceUvSpans();
  await verifyCylinderFaceUvSpan();

  rmSync(workDir, { recursive: true, force: true });
  console.log('\nAll texture/PBR bake assertions passed.');
}

/** 单测 meshShapeWithUvs：1x1x1 box 每个 PLANE 面的 UV span 应精确匹配 repeat_u/repeat_v。 */
async function verifyPlaneFaceUvSpans(): Promise<void> {
  await initBakerService();
  const replicad = await import('replicad');
  const box = replicad.makeBaseBox(1, 1, 1) as unknown as Parameters<typeof meshShapeWithUvs>[0];

  const uvParams = { repeatU: 2, repeatV: 3, offsetU: 0.1, offsetV: 0.2, rotation: 0 };
  const { triangles, uvs, faceGroups } = meshShapeWithUvs(box, DEFAULT_TESSELLATION, uvParams);
  safeDelete(box);

  assert(faceGroups.length === 6, `box should have 6 faces, got ${faceGroups.length}`);

  for (const group of faceGroups) {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const seen = new Set<number>();
    for (let i = group.start; i < group.start + group.count; i++) {
      const vi = triangles[i]!;
      if (seen.has(vi)) continue;
      seen.add(vi);
      const u = uvs[vi * 2]!;
      const v = uvs[vi * 2 + 1]!;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const spanU = maxU - minU;
    const spanV = maxV - minV;
    assert(Math.abs(spanU - uvParams.repeatU) < 1e-4, `face ${group.faceId} U span should be ${uvParams.repeatU}, got ${spanU}`);
    assert(Math.abs(spanV - uvParams.repeatV) < 1e-4, `face ${group.faceId} V span should be ${uvParams.repeatV}, got ${spanV}`);
  }
  console.log(`[OK]   all 6 box PLANE faces: UV span exactly [repeat_u=${uvParams.repeatU}, repeat_v=${uvParams.repeatV}] (zero distortion)`);
}

/**
 * 单测 CYLINDRE 侧面：u（弧度）× 半径 = 弧长（米），v（高度）原样——侧面展开后
 * U span 应精确等于 2π·radius·repeat_u（整圈弧长×密度），V span 精确等于 length·repeat_v。
 */
async function verifyCylinderFaceUvSpan(): Promise<void> {
  await initBakerService();
  const replicad = await import('replicad');
  const radius = 0.3;
  const length = 2;
  const cyl = replicad.makeCylinder(radius, length, [0, 0, 0], [0, 0, 1]) as unknown as Parameters<typeof meshShapeWithUvs>[0];

  const uvParams = { repeatU: 1, repeatV: 1, offsetU: 0, offsetV: 0, rotation: 0 };
  const { triangles, uvs, faceGroups } = meshShapeWithUvs(cyl, DEFAULT_TESSELLATION, uvParams);

  const occtCyl = cyl as unknown as { faces: Array<{ geomType: string; hashCode: number }> };
  const cylindreFaceIds = new Set(
    occtCyl.faces.filter((f) => f.geomType === 'CYLINDRE').map((f) => f.hashCode),
  );
  safeDelete(cyl);
  assert(cylindreFaceIds.size === 1, `cylinder should have exactly 1 CYLINDRE face, got ${cylindreFaceIds.size}`);

  const sideGroup = faceGroups.find((g) => cylindreFaceIds.has(g.faceId));
  assert(!!sideGroup, 'could not find the CYLINDRE side faceGroup');

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const seen = new Set<number>();
  for (let i = sideGroup!.start; i < sideGroup!.start + sideGroup!.count; i++) {
    const vi = triangles[i]!;
    if (seen.has(vi)) continue;
    seen.add(vi);
    minU = Math.min(minU, uvs[vi * 2]!);
    maxU = Math.max(maxU, uvs[vi * 2]!);
    minV = Math.min(minV, uvs[vi * 2 + 1]!);
    maxV = Math.max(maxV, uvs[vi * 2 + 1]!);
  }
  const expectedUSpan = 2 * Math.PI * radius;
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  // 圆柱侧面在展开接缝处，离散采样最后一个顶点角度够不到整圈（差最后一个三角化角度步长，
  // low-poly 默认分段数不多，这一步能到小几个百分点）——这是离散化的固有特性，不是 bug。
  // 只验证量级对得上（弧长=角度×半径的公式生效），留 10% 容差。
  assert(Math.abs(spanU - expectedUSpan) / expectedUSpan < 0.1, `cylinder U span should be ≈${expectedUSpan.toFixed(4)} (2π·r), got ${spanU}`);
  assert(Math.abs(spanV - length) < 1e-4, `cylinder V span should be ${length} (height), got ${spanV}`);
  console.log(`[OK]   CYLINDRE side face: U span=${spanU.toFixed(4)} (≈2π·r=${expectedUSpan.toFixed(4)}), V span=${spanV.toFixed(4)} (=height=${length})`);
}

/**
 * library 内容寻址存储把 blob 落在 `library/blobs/<sha[0:2]>/<sha[2:4]>/<sha>`（无扩展名，
 * 元数据单独存在 index.json）。这个 smoke 用全新临时目录，`blobs/` 下只会有一个文件
 * （前面刚烘的那个 GLB），直接扫目录取即可，不用去解析 index.json。
 */
async function findBakedGlbBytes(libDir: string): Promise<Buffer> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const blobsDir = path.join(libDir, 'blobs');
  const stack = [blobsDir];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else return fs.readFile(full);
    }
  }
  throw new Error(`no blob file found under ${blobsDir}`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
