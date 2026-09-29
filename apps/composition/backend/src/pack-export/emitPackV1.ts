import { collectMaterialTextures, type PackProjection } from './engineBridge.js'
import { deriveAssetGuid } from './identity.js'

/** V1 catalogs require exact declarations before build. Mirror the runtime's
 * shared-mesh identity and texture deduplication, without embedding any payload.
 */
export function emitV1Declarations(projection: PackProjection, packageId: string, sceneKey: string, name: string): string {
  const assets = new Map<string, { kind: string; name: string }>([[sceneKey, { kind: 'scene', name }]])
  const meshes = new Set<object>()
  for (const entity of projection.entities) if (entity.mesh && !meshes.has(entity.mesh)) {
    meshes.add(entity.mesh)
    assets.set(`mesh/${entity.slug}`, { kind: 'mesh', name: `${name} / ${entity.name}` })
  }
  for (const material of projection.materials)
    assets.set(`material/${material.key}`, { kind: 'material', name: `${name} / ${material.key}` })
  const textures = collectMaterialTextures(projection.materials)
  for (const texture of textures) assets.set(`texture/${texture.key}`, { kind: 'texture', name: texture.key })
  if (textures.length) assets.set('sampler/surface-repeat', { kind: 'sampler', name: 'Surface repeat' })
  return `function guid(value: string): AssetGuidType {
  const parsed = AssetGuid.parse(value)
  if (!parsed.ok) throw parsed.error
  return parsed.value
}

const assets: Record<string, { guid: AssetGuidType; kind: 'mesh' | 'material' | 'scene' | 'texture' | 'sampler'; name: string }> = {
${[...assets].map(([key, asset]) => `  ${JSON.stringify(key)}: { guid: guid(${JSON.stringify(deriveAssetGuid(packageId, key))}), kind: '${asset.kind}', name: ${JSON.stringify(asset.name)} },`).join('\n')}
}
`
}
