import { getSceneContractRegistry } from '../scene-script/contracts/contracts.js'
import type { DomainPackInfo } from './types.js'

export type { DomainPackId, DomainPackInfo } from './types.js'

const SCENE_MODES = ['default', 'top', 'topBillboard', 'iso', 'free3d', '3DMesh'] as const

let packsPromise: Promise<readonly DomainPackInfo[]> | undefined

async function loadScenePack(): Promise<DomainPackInfo> {
  try {
    const registry = await getSceneContractRegistry()
    return {
      id: 'scene',
      kind: 'scene',
      status: 'active',
      label: 'scene',
      batteryCount: registry.list().length,
      modes: SCENE_MODES,
    }
  } catch (err) {
    return {
      id: 'scene',
      kind: 'scene',
      status: 'error',
      label: 'scene',
      diagnostic: err instanceof Error ? err.message : String(err),
    }
  }
}

export function listPacks(): Promise<readonly DomainPackInfo[]> {
  packsPromise ??= loadScenePack().then((pack) => [pack])
  return packsPromise
}

export function __resetPackRegistryForTests(): void {
  packsPromise = undefined
}
