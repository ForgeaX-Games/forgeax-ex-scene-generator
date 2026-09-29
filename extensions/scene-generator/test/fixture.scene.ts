import { box, defineMaterial, paintSurface, sceneNode, sceneOutput } from '@forgeax/scene'
import type { GeometryMesh } from '@forgeax/scene'

const geometry = box({ width: 4, depth: 3, height: 2 }) as GeometryMesh
if (!geometry.positions) throw new Error('Acceptance box requires vertex positions')

export default sceneOutput({
  scene: sceneNode({
    name: 'CLI acceptance building',
    key: 'acceptance-building',
    geometry: paintSurface({
      geometry: { ...geometry, colors: geometry.positions.map((_, i) => [1, 0.5, 0.25][i % 3]!) },
      material: defineMaterial({ name: 'wall', surface: () => ({
        baseColor: [0.6, 0.3, 0.2, 1],
        baseColorTexture: { width: 1, height: 1, rgba8: '/////w==', colorSpace: 'srgb' },
      }) }),
    }),
  }),
})
