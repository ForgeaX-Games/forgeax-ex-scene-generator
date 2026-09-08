/**
 * 多材质 GLB (glTF 2.0 binary) 写出器 —— 把"按颜色分组的三角网格"打成单个 .glb。
 *
 * 为什么要这个：
 *   普通 `g_bake_part` 烘的是**纯几何 OBJ**（不带颜色），一个物体烘成一个 mesh 在
 *   场景里就只能上一种 link material。要让"一个物体单元"自带多种颜色整体复用，
 *   就需要一个**自带内嵌材质**的容器。GLB 是最自然的选择：viewer 的 GLTFLoader
 *   原生认内嵌材质，只要 g_to_urdf 对这种 mesh 不再覆盖 link material，颜色就透得出来。
 *
 * 设计：
 *   - 一个 mesh、N 个 primitive，每个 primitive = 一组同色三角面 + 一个 material。
 *   - 相同 (rgba, metalness, roughness, 贴图字节 hash) 的组共用同一个 material（去重，
 *     控制 material 数量）；相同贴图字节的组也共用同一个 image/texture（去重）。
 *   - 默认只写 POSITION + indices，**不写 normal**：与 OBJ 路径一致，前端
 *     `applyLoadedMeshPresentation` 在缺 normal 时会 `computeVertexNormals()`。
 *     省字节、产物稳定。有 `uvs` 时额外写 `TEXCOORD_0`。
 *   - material 用 pbrMetallicRoughness.baseColorFactor=[r,g,b,a] + 该组的
 *     metallicFactor/roughnessFactor（缺省回退到跟前端 materials.ts 一致的默认值）；
 *     alpha<1 时标 alphaMode="BLEND"。有贴图的组额外写 baseColorTexture 指向内嵌 image。
 *   - 二进制布局：BIN chunk 里按组依次放 [positions | (uvs)? | indices | (image bytes)?]，
 *     每个 bufferView 起点都 4 字节对齐（数值 buffer 天然对齐；图片字节手动 padding）。
 */

import { createHash } from 'node:crypto';

/** 与前端 materials.ts 的 defaultSpec 保持一致的兜底值（g_material 也用同一对默认值）。 */
const DEFAULT_METALNESS = 0.05;
const DEFAULT_ROUGHNESS = 0.48;

export interface ColoredMeshGroup {
  /** flat [x,y,z,x,y,z,...]（已烘入世界/物体局部位姿） */
  readonly positions: ArrayLike<number>;
  /** flat [i0,i1,i2,...]，0-based 顶点索引 */
  readonly indices: ArrayLike<number>;
  /** [r,g,b,a]，0..1 */
  readonly rgba: readonly [number, number, number, number];
  /** 可选：与 positions 顶点数对齐的 UV，flat [u0,v0,u1,v1,...]。只在该组带贴图时提供。 */
  readonly uvs?: ArrayLike<number>;
  /** 可选：内嵌贴图的原始文件字节 + MIME（如 "image/png"）。 */
  readonly textureImage?: { bytes: Uint8Array | Buffer; mime: string };
  /** 金属度 0..1；缺省用 DEFAULT_METALNESS。 */
  readonly metalness?: number;
  /** 粗糙度 0..1；缺省用 DEFAULT_ROUGHNESS。 */
  readonly roughness?: number;
}

export interface GlbExportResult {
  bytes: Buffer;
  vertexCount: number;
  triangleCount: number;
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const CT_FLOAT = 5126;
const CT_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
// glTF 2.0 sampler enums (WebGL constants)
const WRAP_REPEAT = 10497;
const FILTER_LINEAR = 9729;
const FILTER_LINEAR_MIPMAP_LINEAR = 9987;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rgbaKey(c: readonly [number, number, number, number]): string {
  return c.map((v) => Math.round(clamp01(v) * 1000) / 1000).join(',');
}

export function groupsToGlb(groups: readonly ColoredMeshGroup[]): GlbExportResult {
  // ── 累积 BIN + accessors/bufferViews/images/textures/samplers/materials/primitives ──
  const binChunks: Buffer[] = [];
  let binOffset = 0;
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const images: Array<Record<string, unknown>> = [];
  const textures: Array<Record<string, unknown>> = [];
  const samplers: Array<Record<string, unknown>> = [];
  const materials: Array<{ pbrMetallicRoughness: Record<string, unknown>; alphaMode?: string }> = [];
  const primitives: Array<Record<string, unknown>> = [];

  let defaultSamplerIndex: number | null = null;
  const imageIndexByHash = new Map<string, number>();
  const textureIndexByImage = new Map<number, number>();
  const matIndexByKey = new Map<string, number>();

  /** 把一段字节写进 BIN，起点 4 字节对齐；返回新建的 bufferView 下标。 */
  function pushBufferView(bytes: Buffer, target?: number): number {
    const view = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: bytes.length,
      ...(target !== undefined ? { target } : {}),
    });
    binChunks.push(bytes);
    binOffset += bytes.length;
    const pad = (4 - (binOffset % 4)) % 4;
    if (pad > 0) {
      binChunks.push(Buffer.alloc(pad, 0));
      binOffset += pad;
    }
    return view;
  }

  function ensureSampler(): number {
    if (defaultSamplerIndex === null) {
      defaultSamplerIndex = samplers.length;
      samplers.push({
        wrapS: WRAP_REPEAT,
        wrapT: WRAP_REPEAT,
        magFilter: FILTER_LINEAR,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
      });
    }
    return defaultSamplerIndex;
  }

  /** 贴图字节去重（同一张贴图被多个 part 引用时只内嵌一份）→ 返回 textures[] 下标。 */
  function ensureTexture(img: { bytes: Uint8Array | Buffer; mime: string }): number {
    const bytes = Buffer.isBuffer(img.bytes) ? img.bytes : Buffer.from(img.bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    let imgIdx = imageIndexByHash.get(hash);
    if (imgIdx === undefined) {
      const view = pushBufferView(bytes);
      imgIdx = images.length;
      images.push({ bufferView: view, mimeType: img.mime });
      imageIndexByHash.set(hash, imgIdx);
    }
    let texIdx = textureIndexByImage.get(imgIdx);
    if (texIdx === undefined) {
      texIdx = textures.length;
      textures.push({ source: imgIdx, sampler: ensureSampler() });
      textureIndexByImage.set(imgIdx, texIdx);
    }
    return texIdx;
  }

  /** material 去重键：rgba + metalness + roughness + 贴图 texture 下标（无贴图则 'none'）。 */
  function ensureMaterial(g: ColoredMeshGroup): number {
    const metalness = clamp01(g.metalness ?? DEFAULT_METALNESS);
    const roughness = clamp01(g.roughness ?? DEFAULT_ROUGHNESS);
    const texIdx = g.textureImage ? ensureTexture(g.textureImage) : undefined;
    const key = `${rgbaKey(g.rgba)}|${metalness}|${roughness}|${texIdx ?? 'none'}`;
    let idx = matIndexByKey.get(key);
    if (idx === undefined) {
      const [r, gg, b, a] = g.rgba.map(clamp01) as [number, number, number, number];
      const pbr: Record<string, unknown> = {
        baseColorFactor: [r, gg, b, a],
        metallicFactor: metalness,
        roughnessFactor: roughness,
      };
      if (texIdx !== undefined) pbr.baseColorTexture = { index: texIdx };
      const mat: { pbrMetallicRoughness: Record<string, unknown>; alphaMode?: string } = {
        pbrMetallicRoughness: pbr,
      };
      if (a < 0.999) mat.alphaMode = 'BLEND';
      idx = materials.length;
      materials.push(mat);
      matIndexByKey.set(key, idx);
    }
    return idx;
  }

  const gMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const gMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  let totalVerts = 0;
  let totalTris = 0;

  for (const group of groups) {
    const vcount = group.positions.length / 3;
    const icount = group.indices.length;
    if (vcount === 0 || icount === 0) continue;

    const materialIndex = ensureMaterial(group);

    // positions（float32）+ 局部 min/max
    const pos = new Float32Array(group.positions.length);
    const localMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const localMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < group.positions.length; i++) {
      const v = group.positions[i];
      pos[i] = v;
      const axis = i % 3;
      if (v < localMin[axis]) localMin[axis] = v;
      if (v > localMax[axis]) localMax[axis] = v;
    }
    seen = true;
    for (let a = 0; a < 3; a++) {
      if (localMin[a] < gMin[a]) gMin[a] = localMin[a];
      if (localMax[a] > gMax[a]) gMax[a] = localMax[a];
    }

    const posBuf = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
    const posView = pushBufferView(posBuf, TARGET_ARRAY_BUFFER);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: CT_FLOAT,
      count: vcount,
      type: 'VEC3',
      min: localMin,
      max: localMax,
    });

    // TEXCOORD_0（float32，可选）：只在该组带 uvs 且长度匹配顶点数时写。
    let uvAcc: number | undefined;
    if (group.uvs && group.uvs.length === vcount * 2) {
      const uv = new Float32Array(group.uvs.length);
      for (let i = 0; i < group.uvs.length; i++) uv[i] = group.uvs[i];
      const uvBuf = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
      const uvView = pushBufferView(uvBuf, TARGET_ARRAY_BUFFER);
      uvAcc = accessors.length;
      accessors.push({ bufferView: uvView, componentType: CT_FLOAT, count: vcount, type: 'VEC2' });
    }

    // indices（uint32）
    const idx = new Uint32Array(icount);
    for (let i = 0; i < icount; i++) idx[i] = group.indices[i];
    const idxBuf = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
    const idxView = pushBufferView(idxBuf, TARGET_ELEMENT_ARRAY_BUFFER);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxView, componentType: CT_UINT, count: icount, type: 'SCALAR' });

    const attributes: Record<string, number> = { POSITION: posAcc };
    if (uvAcc !== undefined) attributes.TEXCOORD_0 = uvAcc;
    primitives.push({ attributes, indices: idxAcc, material: materialIndex });
    totalVerts += vcount;
    totalTris += icount / 3;
  }

  const binBody = Buffer.concat(binChunks);

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'forgeax-wb-scene baker (colored GLB)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBody.length }],
    ...(images.length ? { images } : {}),
    ...(textures.length ? { textures } : {}),
    ...(samplers.length ? { samplers } : {}),
  };

  const bytes = assembleGlb(gltf, binBody);
  return {
    bytes,
    vertexCount: totalVerts,
    triangleCount: totalTris,
    bboxMin: seen ? gMin : null,
    bboxMax: seen ? gMax : null,
  };
}

/** 把 glTF JSON + BIN body 打成最终 .glb（含 12 字节 header + 两个 chunk，各 4 对齐）。 */
function assembleGlb(gltf: Record<string, unknown>, binBody: Buffer): Buffer {
  const jsonStr = JSON.stringify(gltf);
  let jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]); // 空格填充

  const binPad = (4 - (binBody.length % 4)) % 4;
  const binBuf = binPad > 0 ? Buffer.concat([binBody, Buffer.alloc(binPad, 0x00)]) : binBody;

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}
