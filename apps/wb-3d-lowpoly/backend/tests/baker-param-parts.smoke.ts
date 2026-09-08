/**
 * Baker P2/P4 几何差异化烟雾测试。
 *
 * 覆盖本次新增/真实化的几何：
 *   - herringbone_rack_gear ≠ rack_gear（人字 vs 直齿条）
 *   - bevel_gear cone_angle 收缩（30° vs 45° 截面不同）
 *   - bevel_gear helix（螺旋锥齿 vs 直齿锥齿）
 *   - barrel_hinge knuckle_count 偶数被强制成奇数（4 与 5 同 sha）
 *   - tire tread/sidewall 改变几何
 *   - knob bore/skirt/indicator 改变几何
 *   - wheel spoke_count / bore_d 改变几何
 *
 * 跑法：cd backend && node_modules/.bin/tsx tests/baker-param-parts.smoke.ts
 */

import { createHash } from 'node:crypto';
import { bakeShape, initBakerService } from '../src/services/baker/baker.service.js';
import type { BakerLibraryHandle } from '../src/services/baker/types.js';
import { num, bool } from '../../vendor/dist/shared/types/index.js';
import type { Arg } from '../../vendor/dist/shared/types/index.js';

// blobId = OBJ 字节内容哈希，让 blobSha256 真实反映几何（而非文件名/参数）。
class FakeLibrary implements BakerLibraryHandle {
  bytesByAlias = new Map<string, Buffer>();
  async importFromBuffer(buffer: Buffer, filename: string, alias?: string): Promise<{ alias: string; blobId: string }> {
    const a = alias ?? filename;
    this.bytesByAlias.set(a, buffer);
    const blobId = createHash('sha256').update(buffer).digest('hex');
    return { alias: a, blobId };
  }
}

const M = 0.002;
let passed = 0;
let failed = 0;

// 返回 OBJ 内容哈希（blobSha256）：真实反映几何，参数不同但几何相同的 case 会得到相同哈希。
async function shaOf(lib: FakeLibrary, op: string, args: Record<string, Arg>): Promise<string> {
  const r = await bakeShape(op, args, lib);
  if (r.vertexCount === 0 || r.triangleCount === 0) throw new Error(`${op}: empty mesh`);
  return r.blobSha256 ?? r.sha256;
}

// 烘焙一个 shape 并从生成的 OBJ 里解析出顶点，用于几何断言（如屋脊朝向）。
async function bakeVerts(lib: FakeLibrary, op: string, args: Record<string, Arg>): Promise<Array<[number, number, number]>> {
  lib.bytesByAlias.clear();
  const r = await bakeShape(op, args, lib);
  if (r.vertexCount === 0 || r.triangleCount === 0) throw new Error(`${op}: empty mesh`);
  const buf = [...lib.bytesByAlias.values()].pop();
  if (!buf) throw new Error(`${op}: no OBJ buffer captured`);
  const verts: Array<[number, number, number]> = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.startsWith('v ')) continue;
    const p = line.trim().split(/\s+/);
    verts.push([Number(p[1]), Number(p[2]), Number(p[3])]);
  }
  return verts;
}

// 屋脊沿哪根水平轴：取靠近最高 Z 的顶点，比较其在 X / Y 上的展布，展布大者即屋脊方向。
function ridgeAxis(verts: Array<[number, number, number]>): 'x' | 'y' {
  const maxZ = Math.max(...verts.map(v => v[2]));
  const top = verts.filter(v => v[2] >= maxZ - 1e-4);
  const spread = (i: 0 | 1): number => {
    const vals = top.map(v => v[i]);
    return Math.max(...vals) - Math.min(...vals);
  };
  return spread(0) >= spread(1) ? 'x' : 'y';
}

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`OK   ${name} ${detail}`); passed++; }
  else { console.error(`FAIL ${name} ${detail}`); failed++; }
}

async function main(): Promise<void> {
  await initBakerService();
  const lib = new FakeLibrary();

  // 1) herringbone rack vs straight rack（同参数）
  const rackArgs = { module: num(M), length: num(0.06), width: num(0.012), height: num(0.005) };
  const rackSha = await shaOf(lib, 'rack_gear', rackArgs);
  const hbRackSha = await shaOf(lib, 'herringbone_rack_gear', { ...rackArgs, helix_angle: num(25) });
  check('herringbone_rack != rack', rackSha !== hbRackSha, `${rackSha.slice(0, 8)} vs ${hbRackSha.slice(0, 8)}`);

  // 2) bevel cone_angle 收缩
  const bevel30 = await shaOf(lib, 'bevel_gear', { module: num(M), teeth_number: num(20), cone_angle: num(30), face_width: num(0.008) });
  const bevel45 = await shaOf(lib, 'bevel_gear', { module: num(M), teeth_number: num(20), cone_angle: num(45), face_width: num(0.008) });
  check('bevel cone 30 != 45', bevel30 !== bevel45, `${bevel30.slice(0, 8)} vs ${bevel45.slice(0, 8)}`);

  // 3) bevel spiral helix
  const bevelStraight = await shaOf(lib, 'bevel_gear', { module: num(M), teeth_number: num(20), cone_angle: num(45), face_width: num(0.008) });
  const bevelSpiral = await shaOf(lib, 'bevel_gear', { module: num(M), teeth_number: num(20), cone_angle: num(45), face_width: num(0.008), helix_angle: num(30) });
  check('bevel spiral != straight', bevelStraight !== bevelSpiral, `${bevelStraight.slice(0, 8)} vs ${bevelSpiral.slice(0, 8)}`);

  // 4) barrel_hinge 偶数 knuckle 被强制奇数（4 -> 5，与 5 同 sha）
  const hingeBase = { length: num(0.06), leaf_width_a: num(0.02), leaf_thickness: num(0.003), pin_diameter: num(0.004) };
  const hinge4 = await shaOf(lib, 'barrel_hinge', { ...hingeBase, knuckle_count: num(4) });
  const hinge5 = await shaOf(lib, 'barrel_hinge', { ...hingeBase, knuckle_count: num(5) });
  check('barrel_hinge knuckle 4 forced to 5 (same sha)', hinge4 === hinge5, `${hinge4.slice(0, 8)} vs ${hinge5.slice(0, 8)}`);

  // 5) tire tread/sidewall
  const tirePlain = await shaOf(lib, 'tire', { outer_radius: num(0.06), width: num(0.03) });
  const tireTread = await shaOf(lib, 'tire', { outer_radius: num(0.06), width: num(0.03), tread_depth: num(0.004), tread_count: num(3) });
  check('tire tread != plain', tirePlain !== tireTread, `${tirePlain.slice(0, 8)} vs ${tireTread.slice(0, 8)}`);
  const tireSidewall = await shaOf(lib, 'tire', { outer_radius: num(0.06), width: num(0.03), sidewall_depth: num(0.003) });
  check('tire sidewall != plain', tirePlain !== tireSidewall, `${tirePlain.slice(0, 8)} vs ${tireSidewall.slice(0, 8)}`);

  // 6) knob bore/skirt/indicator
  const knobPlain = await shaOf(lib, 'knob', { diameter: num(0.025), height: num(0.018) });
  const knobBore = await shaOf(lib, 'knob', { diameter: num(0.025), height: num(0.018), bore_d: num(0.006) });
  check('knob bore != plain', knobPlain !== knobBore, `${knobPlain.slice(0, 8)} vs ${knobBore.slice(0, 8)}`);
  const knobSkirt = await shaOf(lib, 'knob', { diameter: num(0.025), height: num(0.018), skirt_diameter: num(0.032), skirt_height: num(0.004) });
  check('knob skirt != plain', knobPlain !== knobSkirt, `${knobPlain.slice(0, 8)} vs ${knobSkirt.slice(0, 8)}`);
  const knobIndicator = await shaOf(lib, 'knob', { diameter: num(0.025), height: num(0.018), indicator: bool(true) });
  check('knob indicator != plain', knobPlain !== knobIndicator, `${knobPlain.slice(0, 8)} vs ${knobIndicator.slice(0, 8)}`);

  // 7) bezel recess/flange
  const bezelPlain = await shaOf(lib, 'bezel', { opening_size: { kind: 'list', items: [num(0.08), num(0.05)] } as Arg, outer_size: { kind: 'list', items: [num(0.1), num(0.07)] } as Arg, depth: num(0.008) });
  const bezelFlange = await shaOf(lib, 'bezel', { opening_size: { kind: 'list', items: [num(0.08), num(0.05)] } as Arg, outer_size: { kind: 'list', items: [num(0.1), num(0.07)] } as Arg, depth: num(0.008), flange_width: num(0.006) });
  check('bezel flange != plain', bezelPlain !== bezelFlange, `${bezelPlain.slice(0, 8)} vs ${bezelFlange.slice(0, 8)}`);

  // 8) wheel spokes / bore
  const wheelPlain = await shaOf(lib, 'wheel', { radius: num(0.05), width: num(0.025) });
  const wheelSpokes = await shaOf(lib, 'wheel', { radius: num(0.05), width: num(0.025), spoke_count: num(5) });
  check('wheel spokes != plain', wheelPlain !== wheelSpokes, `${wheelPlain.slice(0, 8)} vs ${wheelSpokes.slice(0, 8)}`);

  // 9) roof 屋脊统一沿 footprint 较长边（宽>深 → 沿 X；深>宽 → 沿 Y），gable/gambrel/shed/hip 一致。
  //    修复前 gable/gambrel/shed 恒沿 Y、hip 恒沿 X，且 hip 在 bd>bw 时退化。
  const fp = (x: number, y: number): Arg => ({ kind: 'list', items: [num(x), num(y)] } as Arg);
  for (const rtype of ['gable', 'gambrel', 'shed', 'hip']) {
    const wideX = await bakeVerts(lib, 'roof', { type: { kind: 'string', value: rtype } as Arg, footprint: fp(10, 4), height: num(2) });
    const wideY = await bakeVerts(lib, 'roof', { type: { kind: 'string', value: rtype } as Arg, footprint: fp(4, 10), height: num(2) });
    check(`roof ${rtype} ridge along X when width>depth`, ridgeAxis(wideX) === 'x', `axis=${ridgeAxis(wideX)}`);
    check(`roof ${rtype} ridge along Y when depth>width`, ridgeAxis(wideY) === 'y', `axis=${ridgeAxis(wideY)}`);
  }

  console.log(`\n[param-parts smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('[param-parts smoke] fatal:', err); process.exit(1); });
