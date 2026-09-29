import type { DomainPortTypes } from '@forgeax/node-runtime-react/editor'

// Single source of truth for this app's domain port types. Consumed by both the
// canvas <Editor> (AuthoringHost) and the left-pane data-types panel
// (AuthoringLeftPane → SceneGeneratorControlsPanel); keep them in sync by
// importing this rather than redeclaring the list per file.
export const scenePortTypes: DomainPortTypes = [
  { type: 'geometry', desc: '几何', descEn: 'Geometry', color: '#22d3ee', aliases: ['plane'] },
  { type: 'heightfield', desc: '高度场', descEn: 'Heightfield', color: '#86efac' },
  { type: 'scene', desc: '场景', descEn: 'Scene', color: '#fb923c' },
  {
    type: 'point2d',
    desc: '几何 · 点',
    descEn: 'Geometry point',
    color: '#c4b5fd',
    compatibleWith: ['geometry'],
  },
  {
    type: 'polyline2d',
    desc: '几何 · 折线',
    descEn: 'Geometry polyline',
    color: '#7dd3fc',
    compatibleWith: ['geometry'],
  },
  {
    type: 'spline2d',
    desc: '几何 · 样条',
    descEn: 'Geometry spline',
    color: '#5eead4',
    compatibleWith: ['geometry'],
  },
  {
    type: 'polygon2d',
    desc: '几何 · 多边形',
    descEn: 'Geometry polygon',
    color: '#a3e635',
    compatibleWith: ['geometry'],
  },
  {
    type: 'network2d',
    desc: '几何 · 曲线网',
    descEn: 'Geometry network',
    color: '#93c5fd',
    compatibleWith: ['geometry'],
  },
  {
    type: 'point3d',
    desc: '几何 · 点3D',
    descEn: 'Geometry point3d',
    color: '#e879f9',
    compatibleWith: ['geometry'],
  },
  {
    type: 'polyline3d',
    desc: '几何 · 折线3D',
    descEn: 'Geometry polyline3d',
    color: '#f0abfc',
    compatibleWith: ['geometry'],
  },
  {
    type: 'spline3d',
    desc: '几何 · 样条3D',
    descEn: 'Geometry spline3d',
    color: '#fbbf24',
    compatibleWith: ['geometry'],
  },
  {
    type: 'polygon3d',
    desc: '几何 · 多边形3D',
    descEn: 'Geometry polygon3d',
    color: '#f472b6',
    compatibleWith: ['geometry'],
  },
  {
    type: 'network3d',
    desc: '几何 · 曲线网3D',
    descEn: 'Geometry network3d',
    color: '#c084fc',
    compatibleWith: ['geometry'],
  },
  { type: 'mesh', desc: '网格', descEn: 'Mesh', color: '#d4d4d0' },
]
