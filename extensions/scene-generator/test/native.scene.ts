import { addChild, box, sceneNode, sceneOutput, type GeometryMesh } from '@forgeax/scene'

const geometry = box({ width: 4, depth: 3, height: 2 }) as GeometryMesh
if (!geometry.positions) throw new Error('Native box requires vertex positions')
const building = sceneNode({
  name: 'Building', key: 'building',
  geometry: { ...geometry, colors: geometry.positions.map((_, i) => [1, .5, .25][i % 3]!), material: { id: 'opaque', surface: {
    baseColor: [0.2, 0.3, 0.4, 1], roughness: 0.8, metallic: 0,
    baseColorTexture: { width: 1, height: 1, rgba8: '/////w==', colorSpace: 'srgb' },
  } } },
})
const glass = sceneNode({
  name: 'Glass', key: 'glass',
  geometry: { ...geometry, material: { id: 'glass', surface: {
    baseColor: [0.2, 0.3, 0.4, 0.35], roughness: 0.1, metallic: 0.1,
  } } },
})
export default sceneOutput({ scene: addChild({ scene: building, nodes: [glass] }) })
