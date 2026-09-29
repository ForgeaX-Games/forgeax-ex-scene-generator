import type { RendererVoxelLayer } from '../../renderer/types.js'
import { matchAssetEntry, type AliasMeta } from '../../renderer/framework/asset/matchAssetEntry.js'
import { computeVoxelStats, type SelectedLayerSnapshot } from './layerInspector.js'

function resolveAssetAlias(layer: RendererVoxelLayer, aliases?: ReadonlyArray<AliasMeta>): string | undefined {
  if (layer.assetAlias) return layer.assetAlias
  if (!layer.assetName) return undefined
  if (layer.assetName.includes('[')) return layer.assetName
  const attrAlias = typeof layer.attributes?.asset_alias === 'string' ? layer.attributes.asset_alias : undefined
  if (attrAlias) return attrAlias
  const match = aliases ? matchAssetEntry({ assetName: layer.assetName, assetType: layer.assetType }, aliases, false) : null
  return match?.primary
}

export function bakedLayerToSnapshot(layer: RendererVoxelLayer, aliases?: ReadonlyArray<AliasMeta>): SelectedLayerSnapshot {
  const attrs = { ...(layer.attributes ?? {}) }
  if (layer.assetName && !('asset_name' in attrs)) attrs.asset_name = layer.assetName
  if (layer.assetAlias && !('asset_alias' in attrs)) attrs.asset_alias = layer.assetAlias
  if (layer.assetType && !('asset_type' in attrs)) attrs.asset_type = layer.assetType
  return {
    kind: 'baked',
    layerKey: layer.key,
    nodePath: layer.nodePath,
    nodeName: layer.nodeName,
    schema: layer.schema,
    value: layer.value,
    assetName: layer.assetName,
    assetType: layer.assetType,
    assetAlias: resolveAssetAlias(layer, aliases),
    attributes: attrs,
    voxelStats: computeVoxelStats(layer.cells),
    subTokens: layer.subTokens,
    bounds: layer.bounds,
    version: layer.version,
  }
}

export function outputLayerToSnapshot(layer: RendererVoxelLayer, aliases?: ReadonlyArray<AliasMeta>): SelectedLayerSnapshot {
  const attrs: Record<string, unknown> = {}
  if (layer.assetName) attrs.asset_name = layer.assetName
  if (layer.assetAlias) attrs.asset_alias = layer.assetAlias
  if (layer.assetType) attrs.asset_type = layer.assetType
  return {
    kind: 'output',
    layerKey: layer.key,
    nodePath: layer.nodePath,
    nodeName: layer.nodeName,
    schema: layer.schema,
    value: layer.value,
    assetName: layer.assetName,
    assetType: layer.assetType,
    assetAlias: resolveAssetAlias(layer, aliases),
    attributes: attrs,
    voxelStats: computeVoxelStats(layer.cells),
    subTokens: layer.subTokens,
    bounds: layer.bounds,
  }
}
