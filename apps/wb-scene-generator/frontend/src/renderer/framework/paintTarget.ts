export type PaintTargetDecision =
  | { kind: 'use-active'; key: string }
  | { kind: 'needs-confirmation' }
  | { kind: 'none' }

export function resolvePaintTargetSync(args: {
  activeKey: string | null
  activeAssetName: string | undefined
  activeAssetAlias?: string
  paintAssetName: string
  paintAssetAlias?: string
}): PaintTargetDecision {
  if (!args.activeKey) return { kind: 'none' }
  const sameAsset = args.activeAssetAlias && args.paintAssetAlias
    ? args.activeAssetAlias === args.paintAssetAlias
    : args.activeAssetName === args.paintAssetName
  if (!args.activeAssetName || sameAsset) {
    return { kind: 'use-active', key: args.activeKey }
  }
  return { kind: 'needs-confirmation' }
}

export function defaultPaintTargetName(assetName: string): string {
  const name = assetName.replace(/\//g, ' ').trim()
  return name || 'Layer'
}
