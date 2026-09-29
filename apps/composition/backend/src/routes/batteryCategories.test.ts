import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SceneContractRegistry, type AcceptanceGateId } from '@forgeax/scene-authoring'
import {
  applyAcceptanceCoverage,
  getBatteryCategories,
  scanBatteryCategories,
  type BatteryUiMeta,
} from './batteryCategories.js'

const allGates: AcceptanceGateId[] = [
  'contract',
  'roundTrip',
  'graphWriteBack',
  'execute',
  'sourceMap',
  'capability',
  'visual',
]

describe('scanBatteryCategories', () => {
  it('includes iconSvg when an op directory has icon.svg', async () => {
    const root = await mkdtemp(join(tmpdir(), `scene-battery-icons-${process.pid}-`))
    const batteryDir = join(root, 'common', 'input', 'toggle')
    await mkdir(batteryDir, { recursive: true })
    await writeFile(
      join(batteryDir, 'scene.contract.ts'),
      `import { defineAtomic } from '@forgeax/scene-authoring'\nexport default defineAtomic({ functionName: 'toggle', contractVersion: '1.0.0', opId: 'toggle', inputs: [], outputs: [] })\n`,
      'utf8',
    )
    await writeFile(join(batteryDir, 'icon.svg'), '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>\n', 'utf8')

    const categories = await scanBatteryCategories([root])

    expect(categories.get('toggle')?.iconSvg).toContain('<svg')
  })

  it('joins promoted evidence to palette entries by kind-qualified op id', () => {
    const categories = new Map<string, BatteryUiMeta>([
      ['empty_scene', { category: 'scene/manage' }],
      ['not_promoted', { category: 'scene/manage' }],
    ])
    const registry = new SceneContractRegistry([
      {
        functionName: 'emptyScene',
        kind: 'atomic',
        contractVersion: '1.0.0',
        opId: 'empty_scene',
        description: 'Empty scene',
        inputs: [],
        outputs: [],
      },
      {
        functionName: 'notPromoted',
        kind: 'atomic',
        contractVersion: '1.0.0',
        opId: 'not_promoted',
        description: 'Not promoted',
        inputs: [],
        outputs: [],
      },
    ])

    applyAcceptanceCoverage(categories, registry, { 'atomic:empty_scene': allGates })

    expect(categories.get('empty_scene')?.sceneScriptStatus).toBe('equivalence-verified')
    expect(categories.get('not_promoted')?.sceneScriptStatus).toBe('script-callable')
  })

  it('projects only the first-batch library into the palette', async () => {
    const categories = await getBatteryCategories()
    expect([...categories.keys()].sort()).toEqual([
      'add_child',
      'allocate_spans',
      'base_plane',
      'bounds_relation',
      'box',
      'cellular_noise',
      'create_grid',
      'derive_seed',
      'empty_scene',
      'fit_anchor',
      'geometry_mask',
      'grid_abs',
      'grid_add',
      'grid_aspect',
      'grid_bbox',
      'grid_blur',
      'grid_choose',
      'grid_clamp',
      'grid_close',
      'grid_components',
      'grid_curvature',
      'grid_diamond_square',
      'grid_dilate',
      'grid_distance',
      'grid_edge',
      'grid_erode_morph',
      'grid_fill',
      'grid_gradient',
      'grid_lerp',
      'grid_majority',
      'grid_mask_diff',
      'grid_mask_union',
      'grid_max',
      'grid_median',
      'grid_midpoint',
      'grid_min',
      'grid_mul',
      'grid_neg',
      'grid_neighborhood_max',
      'grid_neighborhood_min',
      'grid_open',
      'grid_outline',
      'grid_quantize',
      'grid_range_select',
      'grid_remap',
      'grid_resize',
      'grid_sharpen',
      'grid_slope',
      'grid_smoothstep',
      'grid_stats',
      'grid_sub',
      'grid_threshold',
      'grid_zonal_mean',
      'hash_noise',
      'heightfield',
      'heightfield_explode',
      'heightfield_mesh',
      'heightfield_set_mask',
      'json_panel',
      'lift_to_surface',
      'local_frame',
      'network2d',
      'network3d',
      'number_const',
      'opensimplex2_noise',
      'opensimplex2s_noise',
      'perlin_noise',
      'place_on_ground',
      'point2d',
      'point3d',
      'polygon2d',
      'polygon3d',
      'polyline2d',
      'polyline3d',
      'scene_node',
      'scene_output',
      'segment_run',
      'spline2d',
      'spline3d',
      'surface_band',
      'text_panel',
      'toggle',
      'transform',
      'value_cubic_noise',
      'value_noise',
    ])
    expect(categories.get('point2d')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('base_plane')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('polyline2d')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('spline2d')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('polygon2d')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('network2d')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('geometry_mask')?.category).toBe('Modeling/geometry2d')
    expect(categories.get('polyline2d')?.iconSvg).toContain('#10211d')
    expect(categories.get('perlin_noise')?.category).toBe('Grid/noise')
    expect(categories.get('hash_noise')?.category).toBe('Grid/noise')
    expect(categories.get('cellular_noise')?.iconSvg).toContain('#10211d')
    expect(categories.get('grid_add')?.category).toBe('Grid/arith')
    expect(categories.get('grid_blur')?.category).toBe('Grid/filter')
    expect(categories.get('grid_dilate')?.category).toBe('Grid/morph')
    expect(categories.get('grid_slope')?.category).toBe('Grid/derive')
    expect(categories.get('grid_erode_morph')?.iconSvg).toContain('#10211d')
    expect(categories.get('heightfield_set_mask')?.category).toBe('Modeling/heightfield')
    expect(categories.get('heightfield_set_mask')?.iconSvg).toContain('#10211d')
    expect(categories.get('heightfield_mesh')?.category).toBe('Modeling/heightfield')
    expect(categories.get('heightfield_mesh')?.iconSvg).toContain('#10211d')
    expect(categories.get('box')?.category).toBe('Modeling/geometry3d')
    expect(categories.get('transform')?.category).toBe('Modeling/pose')
    expect(categories.get('place_on_ground')?.category).toBe('Modeling/pose')
    expect(categories.get('point3d')?.category).toBe('Modeling/geometry3d')
    expect(categories.get('lift_to_surface')?.category).toBe('Modeling/surface')
    expect(categories.get('surface_band')?.category).toBe('Modeling/surface')
    expect(categories.get('surface_band')?.iconSvg).toContain('#10211d')
    expect(categories.get('box')?.iconSvg).toContain('#10211d')
    expect(categories.get('place_on_ground')?.iconSvg).toContain('#10211d')
  })

  it('re-reads heightfield icon.svg on a cached catalog fetch', async () => {
    const first = await getBatteryCategories()
    expect(first.get('heightfield')?.iconSvg).toContain('#10211d')
    const second = await getBatteryCategories()
    expect(second.get('heightfield')?.iconSvg).toContain('#b7ff5a')
  })
})
