import type { DomainPortTypes } from '@forgeax/node-runtime-react/editor'

// Single source of truth for this app's domain port types. Consumed by both the
// canvas <Editor> (WorkbenchHost) and the left-pane data-types panel
// (WorkbenchLeftPane → SceneGeneratorControlsPanel); keep them in sync by
// importing this rather than redeclaring the list per file.
export const scenePortTypes: DomainPortTypes = [
  { type: 'scene', desc: '场景', descEn: 'Scene', color: '#fb923c' },
  { type: 'point2d', desc: '二维点', descEn: 'Point2D', color: '#c4b5fd' },
  { type: 'mesh', desc: '网格', descEn: 'Mesh', color: '#d4d4d0' },
]
