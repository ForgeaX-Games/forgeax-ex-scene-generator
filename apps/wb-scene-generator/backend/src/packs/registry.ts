import { getSceneContractRegistry } from '../scene-script/contracts/contracts.js'
import type { DomainPackId, DomainPackInfo } from './types.js'

export type { DomainPackId, DomainPackInfo } from './types.js'

const WORLD_MODES = ['default', 'top', 'topBillboard', 'iso', 'free3d', '3DMesh'] as const

const STUB_DIAGNOSTIC: Record<Exclude<DomainPackId, 'world'>, { livesIn: string; diagnostic: string }> = {
  geometry: {
    livesIn: 'wb-3d-lowpoly',
    diagnostic: 'Geometry Pack is not connected. Statements are kept; evaluation is skipped. It currently lives in wb-3d-lowpoly.',
  },
  image: {
    livesIn: 'wb-2d-scene-asset-generator',
    diagnostic: 'Image Pack is not connected. Statements are kept; evaluation is skipped. It currently lives in wb-2d-scene-asset-generator.',
  },
}

type StubLoader = () => Promise<void>

const stubLoaders: Record<Exclude<DomainPackId, 'world'>, StubLoader> = {
  geometry: async () => {},
  image: async () => {},
}

let packsPromise: Promise<readonly DomainPackInfo[]> | undefined

async function loadWorldPack(): Promise<DomainPackInfo> {
  try {
    const registry = await getSceneContractRegistry()
    return {
      id: 'world',
      kind: 'world',
      status: 'active',
      label: 'world',
      batteryCount: registry.list().length,
      modes: WORLD_MODES,
    }
  } catch (err) {
    return {
      id: 'world',
      kind: 'world',
      status: 'error',
      label: 'world',
      diagnostic: err instanceof Error ? err.message : String(err),
    }
  }
}

async function loadStubPack(id: Exclude<DomainPackId, 'world'>): Promise<DomainPackInfo> {
  const stub = STUB_DIAGNOSTIC[id]
  try {
    await stubLoaders[id]()
    return {
      id,
      kind: id,
      status: 'stub',
      label: id,
      livesIn: stub.livesIn,
      diagnostic: stub.diagnostic,
    }
  } catch (err) {
    return {
      id,
      kind: id,
      status: 'error',
      label: id,
      livesIn: stub.livesIn,
      diagnostic: err instanceof Error ? err.message : String(err),
    }
  }
}

async function loadAllPacks(): Promise<readonly DomainPackInfo[]> {
  // Each pack loads in isolation: a geometry/image contract failure must not
  // reject this list or the world Scene Contract registry used by /ops.
  const [world, geometry, image] = await Promise.all([
    loadWorldPack(),
    loadStubPack('geometry'),
    loadStubPack('image'),
  ])
  return [world, geometry, image]
}

export function listPacks(): Promise<readonly DomainPackInfo[]> {
  packsPromise ??= loadAllPacks()
  return packsPromise
}

/** Test-only: inject a throwing geometry/image contract loader, then relist. */
export function __setStubPackLoaderForTests(id: Exclude<DomainPackId, 'world'>, loader: StubLoader): void {
  stubLoaders[id] = loader
  packsPromise = undefined
}

export function __resetPackRegistryForTests(): void {
  stubLoaders.geometry = async () => {}
  stubLoaders.image = async () => {}
  packsPromise = undefined
}
