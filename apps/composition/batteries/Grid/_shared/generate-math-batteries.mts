/**
 * One-shot generator for Grid arith / filter / morph / derive batteries.
 * Run: bun apps/composition/batteries/Grid/_shared/generate-math-batteries.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

type Port = {
  name: string
  type: string
  required?: boolean
  defaultValue?: unknown
  mode?: string
  options?: string[]
  label: string
  description?: string
}

type Spec = {
  family: 'arith' | 'filter' | 'morph' | 'derive'
  dir: string
  fn: string
  opId: string
  label: string
  nameEn: string
  description: string
  kernel: string
  kind: string
  inputs: Port[]
  outputs?: Port[]
}

const gridIn = (name: string, label: string, required = true): Port => ({
  name, type: 'grid', required, label,
})
const numIn = (name: string, label: string, defaultValue: number): Port => ({
  name, type: 'number', defaultValue, mode: 'parameter', label,
})
const optGrid = (name: string, label: string): Port => ({
  name, type: 'grid', required: false, label,
})
const gridOut: Port = { name: 'grid', type: 'grid', label: '网格' }

const arithBinary = (
  fn: string,
  opId: string,
  dir: string,
  label: string,
  nameEn: string,
  description: string,
  kind: string,
  valueDefault: number,
): Spec => ({
  family: 'arith', dir, fn, opId, label, nameEn, description, kernel: 'runGridArith', kind,
  inputs: [
    gridIn('a', 'A'),
    { name: 'b', type: 'grid', required: false, label: 'B' },
    numIn('value', '数值', valueDefault),
    optGrid('mask', '遮罩'),
  ],
  outputs: [gridOut],
})

const specs: Spec[] = [
  arithBinary('gridAdd', 'grid_add', 'grid_add', '加', 'GridAdd', 'Add a Grid and a Grid or number. Same lattice or scalar.', 'add', 0),
  arithBinary('gridSub', 'grid_sub', 'grid_sub', '减', 'GridSub', 'Subtract a Grid or number from a Grid. Same lattice or scalar.', 'sub', 0),
  arithBinary('gridMul', 'grid_mul', 'grid_mul', '乘', 'GridMul', 'Multiply a Grid by a Grid or number. Binary intersect is multiply.', 'mul', 1),
  arithBinary('gridMin', 'grid_min', 'grid_min', '逐格最小', 'GridMin', 'Per-cell minimum. Same lattice or scalar.', 'min', 0),
  arithBinary('gridMax', 'grid_max', 'grid_max', '逐格最大', 'GridMax', 'Per-cell maximum. Same lattice or scalar.', 'max', 0),
  {
    family: 'arith', dir: 'grid_lerp', fn: 'gridLerp', opId: 'grid_lerp', label: '线性混合', nameEn: 'GridLerp',
    description: 'Lerp two same-lattice Grids. t is a number; weight is an optional per-cell Grid.',
    kernel: 'runGridArith', kind: 'lerp',
    inputs: [
      gridIn('a', 'A'),
      gridIn('b', 'B'),
      numIn('t', 'T', 0.5),
      optGrid('weight', '权重'),
      optGrid('mask', '遮罩'),
    ],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_choose', fn: 'gridChoose', opId: 'grid_choose', label: '按遮罩抽取', nameEn: 'GridChoose',
    description: 'Where mask > 0.5 take b, else a. Not a lerp.',
    kernel: 'runGridArith', kind: 'choose',
    inputs: [gridIn('a', 'A'), gridIn('b', 'B'), gridIn('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_mask_diff', fn: 'gridMaskDiff', opId: 'grid_mask_diff', label: '二值差集', nameEn: 'GridMaskDiff',
    description: '1 where a is nonzero and b is zero. Same lattice required.',
    kernel: 'runGridArith', kind: 'maskDiff',
    inputs: [gridIn('a', 'A'), gridIn('b', 'B'), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_mask_union', fn: 'gridMaskUnion', opId: 'grid_mask_union', label: '二值并集', nameEn: 'GridMaskUnion',
    description: '1 where either Grid is nonzero. Same lattice required.',
    kernel: 'runGridArith', kind: 'maskUnion',
    inputs: [gridIn('a', 'A'), gridIn('b', 'B'), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_abs', fn: 'gridAbs', opId: 'grid_abs', label: '绝对值', nameEn: 'GridAbs',
    description: 'Per-cell absolute value.',
    kernel: 'runGridArith', kind: 'abs',
    inputs: [gridIn('grid', '网格'), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_neg', fn: 'gridNeg', opId: 'grid_neg', label: '取负', nameEn: 'GridNeg',
    description: 'Per-cell negate.',
    kernel: 'runGridArith', kind: 'neg',
    inputs: [gridIn('grid', '网格'), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_clamp', fn: 'gridClamp', opId: 'grid_clamp', label: '夹取', nameEn: 'GridClamp',
    description: 'Clamp every cell to [min, max].',
    kernel: 'runGridArith', kind: 'clamp',
    inputs: [gridIn('grid', '网格'), numIn('min', '最小', 0), numIn('max', '最大', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_remap', fn: 'gridRemap', opId: 'grid_remap', label: '区间重映射', nameEn: 'GridRemap',
    description: 'Linear remap from [fromMin, fromMax] to [toMin, toMax].',
    kernel: 'runGridArith', kind: 'remap',
    inputs: [
      gridIn('grid', '网格'),
      numIn('fromMin', '从最小', 0),
      numIn('fromMax', '从最大', 1),
      numIn('toMin', '到最小', 0),
      numIn('toMax', '到最大', 1),
      optGrid('mask', '遮罩'),
    ],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_smoothstep', fn: 'gridSmoothstep', opId: 'grid_smoothstep', label: '平滑阶跃', nameEn: 'GridSmoothstep',
    description: 'Hermite smoothstep between edge0 and edge1.',
    kernel: 'runGridArith', kind: 'smoothstep',
    inputs: [gridIn('grid', '网格'), numIn('edge0', '边0', 0), numIn('edge1', '边1', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'arith', dir: 'grid_quantize', fn: 'gridQuantize', opId: 'grid_quantize', label: '量化分层', nameEn: 'GridQuantize',
    description: 'Quantize to steps. Lattice terraces, not a geology Terrace SOP.',
    kernel: 'runGridArith', kind: 'quantize',
    inputs: [gridIn('grid', '网格'), numIn('steps', '层数', 4), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'filter', dir: 'grid_blur', fn: 'gridBlur', opId: 'grid_blur', label: '模糊', nameEn: 'GridBlur',
    description: 'Box or gaussian blur. Radius is cells, not metres.',
    kernel: 'runGridFilter', kind: 'blur',
    inputs: [
      gridIn('grid', '网格'),
      numIn('radius', '半径', 1),
      { name: 'kind', type: 'string', defaultValue: 'box', mode: 'parameter', options: ['box', 'gaussian'], label: '核' },
      optGrid('mask', '遮罩'),
    ],
    outputs: [gridOut],
  },
  {
    family: 'filter', dir: 'grid_sharpen', fn: 'gridSharpen', opId: 'grid_sharpen', label: '反锐化', nameEn: 'GridSharpen',
    description: 'Unsharp mask. Radius is cells.',
    kernel: 'runGridFilter', kind: 'sharpen',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), numIn('amount', '强度', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'filter', dir: 'grid_median', fn: 'gridMedian', opId: 'grid_median', label: '中值', nameEn: 'GridMedian',
    description: 'Median filter. Radius is cells.',
    kernel: 'runGridFilter', kind: 'median',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'filter', dir: 'grid_neighborhood_min', fn: 'gridNeighborhoodMin', opId: 'grid_neighborhood_min', label: '邻域最小', nameEn: 'GridNeighborhoodMin',
    description: 'Neighborhood minimum. Radius is cells.',
    kernel: 'runGridFilter', kind: 'nmin',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'filter', dir: 'grid_neighborhood_max', fn: 'gridNeighborhoodMax', opId: 'grid_neighborhood_max', label: '邻域最大', nameEn: 'GridNeighborhoodMax',
    description: 'Neighborhood maximum. Radius is cells.',
    kernel: 'runGridFilter', kind: 'nmax',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_dilate', fn: 'gridDilate', opId: 'grid_dilate', label: '膨胀', nameEn: 'GridDilate',
    description: 'Morphological dilate. Not hydraulic erosion.',
    kernel: 'runGridMorph', kind: 'dilate',
    inputs: [
      gridIn('grid', '网格'),
      numIn('radius', '半径', 1),
      { name: 'connectivity', type: 'number', defaultValue: 8, mode: 'parameter', options: ['4', '8'], label: '连通' },
      optGrid('mask', '遮罩'),
    ],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_erode_morph', fn: 'gridErodeMorph', opId: 'grid_erode_morph', label: '形态学腐蚀', nameEn: 'GridErodeMorph',
    description: 'Morphological erode. Do not call erodeGrid.',
    kernel: 'runGridMorph', kind: 'erode',
    inputs: [
      gridIn('grid', '网格'),
      numIn('radius', '半径', 1),
      { name: 'connectivity', type: 'number', defaultValue: 8, mode: 'parameter', options: ['4', '8'], label: '连通' },
      optGrid('mask', '遮罩'),
    ],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_open', fn: 'gridOpen', opId: 'grid_open', label: '开运算', nameEn: 'GridOpen',
    description: 'Erode then dilate. Removes specks.',
    kernel: 'runGridMorph', kind: 'open',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_close', fn: 'gridClose', opId: 'grid_close', label: '闭运算', nameEn: 'GridClose',
    description: 'Dilate then erode. Fills pinholes.',
    kernel: 'runGridMorph', kind: 'close',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_majority', fn: 'gridMajority', opId: 'grid_majority', label: '邻域投票', nameEn: 'GridMajority',
    description: 'Neighborhood majority vote to 0/1.',
    kernel: 'runGridMorph', kind: 'majority',
    inputs: [gridIn('grid', '网格'), numIn('radius', '半径', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'morph', dir: 'grid_outline', fn: 'gridOutline', opId: 'grid_outline', label: '形态学轮廓', nameEn: 'GridOutline',
    description: 'Positive thickness is an inner ring; negative is an outer band.',
    kernel: 'runGridMorph', kind: 'outline',
    inputs: [gridIn('grid', '网格'), numIn('thickness', '厚度', 1), optGrid('mask', '遮罩')],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_slope', fn: 'gridSlope', opId: 'grid_slope', label: '坡', nameEn: 'GridSlope',
    description: 'Gradient magnitude in Δvalue / cell. Not degrees per metre.',
    kernel: 'runGridDerive', kind: 'slope',
    inputs: [gridIn('grid', '网格')],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_aspect', fn: 'gridAspect', opId: 'grid_aspect', label: '朝向', nameEn: 'GridAspect',
    description: 'Aspect in degrees [0, 360) from index-space gradients.',
    kernel: 'runGridDerive', kind: 'aspect',
    inputs: [gridIn('grid', '网格')],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_curvature', fn: 'gridCurvature', opId: 'grid_curvature', label: '曲率', nameEn: 'GridCurvature',
    description: '4-neighbour Laplacian in index space.',
    kernel: 'runGridDerive', kind: 'curvature',
    inputs: [gridIn('grid', '网格')],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_threshold', fn: 'gridThreshold', opId: 'grid_threshold', label: '阈值', nameEn: 'GridThreshold',
    description: '1 where grid >= value, else 0. A mask, not zone ids.',
    kernel: 'runGridDerive', kind: 'threshold',
    inputs: [gridIn('grid', '网格'), numIn('value', '阈值', 0.5)],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_range_select', fn: 'gridRangeSelect', opId: 'grid_range_select', label: '区间选择', nameEn: 'GridRangeSelect',
    description: '1 where min <= grid <= max.',
    kernel: 'runGridDerive', kind: 'range',
    inputs: [gridIn('grid', '网格'), numIn('min', '最小', 0), numIn('max', '最大', 1)],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_edge', fn: 'gridEdge', opId: 'grid_edge', label: '边缘带', nameEn: 'GridEdge',
    description: 'Max absolute 4-neighbour difference. Prefer gridOutline for a binary ring.',
    kernel: 'runGridDerive', kind: 'edge',
    inputs: [gridIn('grid', '网格')],
    outputs: [gridOut],
  },
  {
    family: 'derive', dir: 'grid_bbox', fn: 'gridBBox', opId: 'grid_bbox', label: '非零包围盒', nameEn: 'GridBBox',
    description: 'Nonzero index bbox. Outputs numbers, not a Grid.',
    kernel: 'runGridDerive', kind: 'bbox',
    inputs: [gridIn('grid', '网格')],
    outputs: [
      { name: 'columns', type: 'number', label: '列' },
      { name: 'rows', type: 'number', label: '行' },
      { name: 'col', type: 'number', label: '列起点' },
      { name: 'row', type: 'number', label: '行起点' },
    ],
  },
]

function portBlock(port: Port): string {
  const lines = [
    `    {`,
    `      name: ${JSON.stringify(port.name)},`,
    `      type: ${JSON.stringify(port.type)},`,
  ]
  if (port.type === 'grid') lines.push(`      runtimeType: "grid",`)
  lines.push(`      access: "item",`)
  if (port.required === true) lines.push(`      required: true,`)
  if (port.required === false) lines.push(`      required: false,`)
  if (port.defaultValue !== undefined) lines.push(`      defaultValue: ${JSON.stringify(port.defaultValue)},`)
  if (port.mode) lines.push(`      mode: ${JSON.stringify(port.mode)},`)
  if (port.options) {
    lines.push(`      options: [`)
    for (const opt of port.options) lines.push(`        ${JSON.stringify(opt)},`)
    lines.push(`      ],`)
  }
  lines.push(`      label: ${JSON.stringify(port.label)},`)
  lines.push(`    },`)
  return lines.join('\n')
}

function kernelImport(spec: Spec): string {
  if (spec.family === 'arith') return `import { runGridArith } from '../_arith/runGridArith.ts'`
  if (spec.family === 'filter') return `import { runGridFilter } from '../_filter/runGridFilter.ts'`
  if (spec.family === 'morph') return `import { runGridMorph } from '../_morph/runGridMorph.ts'`
  return `import { runGridDerive } from '../_derive/runGridDerive.ts'`
}

function kernelCall(spec: Spec): string {
  if (spec.family === 'arith') return `runGridArith('${spec.kind}', input)`
  if (spec.family === 'filter') return `runGridFilter('${spec.kind}', input)`
  if (spec.family === 'morph') return `runGridMorph('${spec.kind}', input)`
  return `runGridDerive('${spec.kind}', input)`
}

function iconSvg(spec: Spec): string {
  const glyphs: Record<string, string> = {
    gridAdd: '<path d="M12 8v8M8 12h8" fill="none" stroke="#e7f5ee" stroke-width="1.6" stroke-linecap="round"/>',
    gridSub: '<path d="M8 12h8" fill="none" stroke="#e7f5ee" stroke-width="1.6" stroke-linecap="round"/>',
    gridMul: '<path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="#e7f5ee" stroke-width="1.6" stroke-linecap="round"/>',
    gridMin: '<path d="M8 10h8M10 14h4" fill="none" stroke="#e7f5ee" stroke-width="1.6" stroke-linecap="round"/>',
    gridMax: '<path d="M10 10h4M8 14h8" fill="none" stroke="#e7f5ee" stroke-width="1.6" stroke-linecap="round"/>',
    gridLerp: '<path d="M8 16 L12 8 L16 14" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    gridChoose: '<path d="M8 9h3v6H8zM13 9h3v6h-3z" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridMaskDiff: '<path d="M8 8h6v8H8z" fill="none" stroke="#e7f5ee" stroke-width="1.4"/><path d="M12 10h4v4h-4" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridMaskUnion: '<path d="M8 9h5v6H8zM11 9h5v6h-5" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridAbs: '<path d="M9 8v8M15 8v8M10 12h4" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridNeg: '<path d="M8 12h8M14 9v6" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridClamp: '<path d="M8 8h8M8 16h8M10 10v4h4v-4" fill="none" stroke="#e7f5ee" stroke-width="1.4" stroke-linecap="round"/>',
    gridRemap: '<path d="M8 16l4-8 4 5" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridSmoothstep: '<path d="M7 16c2 0 3-8 5-8s3 8 5 8" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridQuantize: '<path d="M8 16h3v-3h3V10h2V8" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridBlur: '<circle cx="12" cy="12" r="4.2" fill="none" stroke="#e7f5ee" stroke-width="1.5"/>',
    gridSharpen: '<path d="M12 7l4 9H8z" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linejoin="round"/>',
    gridMedian: '<path d="M8 16V8h3v8M13 16V11h3v5" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridNeighborhoodMin: '<path d="M8 9h8v6H8zM10 12h4" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridNeighborhoodMax: '<path d="M8 9h8v6H8zM9 11h6" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridDilate: '<rect x="8" y="8" width="8" height="8" fill="none" stroke="#e7f5ee" stroke-width="1.4"/><rect x="10" y="10" width="4" height="4" fill="none" stroke="#e7f5ee" stroke-width="1.2"/>',
    gridErodeMorph: '<rect x="9" y="9" width="6" height="6" fill="none" stroke="#e7f5ee" stroke-width="1.5"/>',
    gridOpen: '<path d="M8 12h8M12 8v8" fill="none" stroke="#e7f5ee" stroke-width="1.2"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="#e7f5ee" stroke-width="1.3"/>',
    gridClose: '<circle cx="12" cy="12" r="4" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
    gridMajority: '<path d="M8 14h2v2H8zM11 11h2v5h-2zM14 9h2v7h-2z" fill="none" stroke="#e7f5ee" stroke-width="1.3"/>',
    gridOutline: '<rect x="8" y="8" width="8" height="8" fill="none" stroke="#e7f5ee" stroke-width="1.6"/>',
    gridSlope: '<path d="M7 16l5-8 5 4" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridAspect: '<path d="M12 8v3M12 12l3 3" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="4" fill="none" stroke="#e7f5ee" stroke-width="1.3"/>',
    gridCurvature: '<path d="M7 14c2-6 8-6 10 0" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridThreshold: '<path d="M8 15h8M8 9h4v6" fill="none" stroke="#e7f5ee" stroke-width="1.5" stroke-linecap="round"/>',
    gridRangeSelect: '<path d="M8 15h8M10 9h4v6" fill="none" stroke="#e7f5ee" stroke-width="1.5"/>',
    gridEdge: '<path d="M8 8h8v8H8z" fill="none" stroke="#e7f5ee" stroke-width="1.6"/>',
    gridBBox: '<path d="M8 8h5v3H8zM11 13h5v3h-5" fill="none" stroke="#e7f5ee" stroke-width="1.4"/>',
  }
  const glyph = glyphs[spec.fn] ?? '<circle cx="12" cy="12" r="3" fill="none" stroke="#e7f5ee" stroke-width="1.5"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="${spec.nameEn}">
  <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#10211d" stroke="#4f6f63" stroke-width="1.2"/>
  ${glyph}
  <path d="M7.2 18.2h9.6" fill="none" stroke="#b7ff5a" stroke-width="1.7" stroke-linecap="round"/>
</svg>
`
}

function contractSource(spec: Spec): string {
  return `import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: ${JSON.stringify(spec.fn)},
  contractVersion: "1.0.0",
  opId: ${JSON.stringify(spec.opId)},
  label: ${JSON.stringify(spec.label)},
  nameEn: ${JSON.stringify(spec.nameEn)},
  description: ${JSON.stringify(spec.description)},
  inputs: [
${spec.inputs.map(portBlock).join('\n')}
  ],
  outputs: [
${(spec.outputs ?? [gridOut]).map(portBlock).join('\n')}
  ],
  deterministic: true,
})
`
}

function indexSource(spec: Spec): string {
  return `${kernelImport(spec)}

export function ${spec.fn}(input: Record<string, unknown>) {
  return ${kernelCall(spec)}
}
`
}

for (const spec of specs) {
  const dir = join(root, spec.family, spec.dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'scene.contract.ts'), contractSource(spec))
  writeFileSync(join(dir, 'index.ts'), indexSource(spec))
  writeFileSync(join(dir, 'icon.svg'), iconSvg(spec))
}

console.log(`wrote ${specs.length} Grid math batteries`)
export { specs }
