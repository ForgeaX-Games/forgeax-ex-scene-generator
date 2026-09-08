/**
 * baker smoke for sdf_blob: actually run bakeShape('sdf_blob', ...) end to end (compile SDF →
 * marching cubes → MeshGeometry → OBJ) and sanity-check the produced OBJ/bbox, confirming the
 * op can feed the existing g_bake_object merge chain like rock/boulder already do.
 */
import { bakeShape, initBakerService } from '../src/services/baker/baker.service.js';
import type { BakerLibraryHandle } from '../src/services/baker/types.js';
import { num, str, list } from '../../vendor/dist/shared/types/index.js';
import type { Arg } from '../../vendor/dist/shared/types/index.js';

class FakeLibrary implements BakerLibraryHandle {
  bytesByAlias = new Map<string, Buffer>();
  async importFromBuffer(buffer: Buffer, filename: string, alias?: string): Promise<{ alias: string; blobId: string }> {
    const a = alias ?? filename;
    this.bytesByAlias.set(a, buffer);
    return { alias: a, blobId: a.replace(/\.obj$/, '') };
  }
}

function primitiveTuple(
  type: string, id: string, center: [number, number, number], params: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): Arg {
  return list([str(type), str(id), ...center.map(num), ...params.map(num), ...rotation.map(num)]);
}
function operationTuple(type: string, id: string, left: string, right: string, radius = 0): Arg {
  return list([str(type), str(id), str(left), str(right), num(radius)]);
}

interface Case { name: string; op: string; args: Record<string, Arg> }

const CASES: Case[] = [
  {
    name: 'sdf_blob single sphere',
    op: 'sdf_blob',
    args: {
      primitives: list([primitiveTuple('sphere', 'a', [0, 0, 0], [0.5, 0, 0])]),
      resolution: num(16),
    },
  },
  {
    name: 'sdf_blob two-sphere smooth-union',
    op: 'sdf_blob',
    args: {
      primitives: list([
        primitiveTuple('sphere', 'a', [-0.3, 0, 0], [0.4, 0, 0]),
        primitiveTuple('sphere', 'b', [0.3, 0, 0], [0.4, 0, 0]),
      ]),
      operations: list([operationTuple('smooth-union', 'u', 'a', 'b', 0.25)]),
      resolution: num(20),
    },
  },
  {
    name: 'sdf_blob capsule+box subtract',
    op: 'sdf_blob',
    args: {
      primitives: list([
        primitiveTuple('capsule', 'a', [0, 0, 0], [0.3, 1, 0]),
        primitiveTuple('box', 'b', [0, 0.6, 0], [0.5, 0.3, 0.5]),
      ]),
      operations: list([operationTuple('subtract', 'sub', 'a', 'b')]),
      resolution: num(18),
    },
  },
];

async function main() {
  await initBakerService();
  const lib = new FakeLibrary();
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    try {
      const res = await bakeShape(c.op, c.args, lib);
      if (res.vertexCount === 0 || res.triangleCount === 0) throw new Error(`empty mesh V=${res.vertexCount} T=${res.triangleCount}`);
      if (!res.bboxMin || !res.bboxMax || ![...res.bboxMin, ...res.bboxMax].every((v) => Number.isFinite(v))) {
        throw new Error(`invalid bbox min=${JSON.stringify(res.bboxMin)} max=${JSON.stringify(res.bboxMax)}`);
      }
      const obj = lib.bytesByAlias.get(res.url)?.toString('utf8') ?? '';
      if (!obj.includes('v ') || !obj.includes('f ')) throw new Error('OBJ missing vertex/face lines');
      console.log(`[OK]   ${c.name.padEnd(32)} V=${String(res.vertexCount).padStart(5)} T=${String(res.triangleCount).padStart(5)}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${c.name.padEnd(32)} ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${CASES.length} baked (${failed} failed)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
