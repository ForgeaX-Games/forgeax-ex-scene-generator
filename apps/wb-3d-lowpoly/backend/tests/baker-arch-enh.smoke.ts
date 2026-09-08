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

interface Case { name: string; op: string; args: Record<string, Arg> }

const CASES: Case[] = [
  { name: 'wall band+plinth', op: 'wall', args: { length: num(6), height: num(3), thickness: num(0.2), window_band: bool(true), band_sill: num(0.9), band_head: num(2.2), band_margin: num(0.5), pane_width: num(1.0), mullion: num(0.06), plinth_height: num(0.4), plinth_projection: num(0.05) } },
  { name: 'roof flat parapet', op: 'roof', args: { footprint: numList([6, 4]), type: str('flat'), thickness: num(0.15), parapet_height: num(0.8), parapet_thickness: num(0.12), coping_width: num(0.05) } },
  { name: 'roof gable eave/verge', op: 'roof', args: { footprint: numList([6, 4]), type: str('gable'), height: num(1.6), eave_overhang: num(0.5), verge_overhang: num(0.2) } },
  { name: 'roof hip eave/verge', op: 'roof', args: { footprint: numList([6, 4]), type: str('hip'), height: num(1.6), eave_overhang: num(0.4), verge_overhang: num(0.3) } },
  { name: 'stairs open+landing', op: 'stairs', args: { total_rise: num(2.8), run: num(0.28), width: num(1), step_count: num(14), open_riser: bool(true), tread_thickness: num(0.05), landing_depth: num(1.0), landing_after: num(7) } },
  { name: 'stairs solid+landing', op: 'stairs', args: { total_rise: num(2.8), run: num(0.28), width: num(1), step_count: num(12), landing_depth: num(1.0), landing_after: num(6) } },
  { name: 'stairs spiral wedge', op: 'stairs', args: { total_rise: num(2.8), run: num(0.24), width: num(1), step_count: num(16), type: str('spiral'), radius: num(1.2), inner_radius: num(0.15), sweep_deg: num(360) } },
  { name: 'stairs spiral open', op: 'stairs', args: { total_rise: num(2.8), run: num(0.24), width: num(1), step_count: num(16), type: str('spiral'), radius: num(1.2), inner_radius: num(0.15), sweep_deg: num(270), open_riser: bool(true), tread_thickness: num(0.05) } },
  { name: 'column round taper+flutes', op: 'column', args: { height: num(3), radius: num(0.2), base_height: num(0.2), capital_height: num(0.2), taper: num(0.8), base_style: str('stepped'), capital_style: str('stepped'), flutes: num(16) } },
  { name: 'column square taper', op: 'column', args: { height: num(3), radius: num(0.2), shape: str('square'), taper: num(0.75), base_height: num(0.2), capital_height: num(0.2) } },
  { name: 'door_frame transom+side', op: 'door_frame', args: { size: numList([1.6, 2.4]), depth: num(0.2), frame: num(0.08), transom: num(0.4), sidelight: num(0.3) } },
  { name: 'door_leaf panel grid', op: 'door_leaf', args: { size: numList([0.9, 2.0]), thickness: num(0.045), hinge: str('left'), style: str('panel'), panel_rows: num(3), panel_cols: num(2) } },
  { name: 'window arch+pane+sill', op: 'window', args: { size: numList([1.2, 1.8]), depth: num(0.2), frame: num(0.06), mullion: num(0.04), pane_width: num(0.4), sill: num(0.08), arch_top: bool(true) } },
  { name: 'window grid pane_width', op: 'window', args: { size: numList([2.0, 1.4]), depth: num(0.2), frame: num(0.06), mullion: num(0.04), type: str('grid'), rows: num(2), pane_width: num(0.4) } },
  { name: 'railing round+rails', op: 'railing', args: { length: num(3), height: num(1.0), post_shape: str('round'), post_radius: num(0.06), post_spacing: num(0.15), bottom_rail: bool(true), mid_rail: bool(true), top_rail_width: num(0.08) } },
  { name: 'floor beam+chamfer', op: 'floor_slab', args: { size: numList([6, 4]), thickness: num(0.2), beam_depth: num(0.4), beam_width: num(0.24), edge_chamfer: num(0.03) } },
  { name: 'facade both shiplap', op: 'facade_panel', args: { panel_size: numList([2.4, 2.8]), thickness: num(0.03), groove_spacing: num(0.3), groove_direction: str('both'), board_style: str('shiplap') } },
  { name: 'facade vertical lap', op: 'facade_panel', args: { panel_size: numList([2.4, 2.8]), thickness: num(0.03), groove_count: num(8), groove_direction: str('vertical'), board_style: str('lap') } },
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
      console.log(`[OK]   ${c.name.padEnd(28)} V=${String(res.vertexCount).padStart(5)} T=${String(res.triangleCount).padStart(5)}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${c.name.padEnd(28)} ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${CASES.length} baked (${failed} failed)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
