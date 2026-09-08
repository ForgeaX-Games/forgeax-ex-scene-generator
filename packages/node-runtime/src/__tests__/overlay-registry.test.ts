import { describe, expect, it } from 'vitest'

import { OpRegistry, OverlayOpRegistry } from '../layer1/op-registry.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

function spec(id: string, revision?: string): OpSpec {
  return {
    id,
    inputs: [],
    outputs: [{ name: 'out', type: 'number' }],
    params: [],
    execute: () => ({ out: id }),
    ...(revision ? { implementationRevision: revision } : {}),
  }
}

describe('OverlayOpRegistry', () => {
  it('merges get/list/has and isolates local mutations', () => {
    const base = new OpRegistry()
    base.register(spec('platform.echo'))
    const projectA = new OverlayOpRegistry(base)
    const projectB = new OverlayOpRegistry(base)
    projectA.register(spec('local/coastal-terrain', 'rev-a'))

    expect(projectA.has('platform.echo')).toBe(true)
    expect(projectA.has('local/coastal-terrain')).toBe(true)
    expect(projectB.has('local/coastal-terrain')).toBe(false)
    expect(projectB.get('local/coastal-terrain')).toBeUndefined()
    expect(projectA.list().map((item) => item.id).sort()).toEqual(['local/coastal-terrain', 'platform.echo'])
    expect(projectB.list().map((item) => item.id)).toEqual(['platform.echo'])
  })

  it('refuses to shadow or replace a platform opId', () => {
    const base = new OpRegistry()
    base.register(spec('control_points'))
    const overlay = new OverlayOpRegistry(base)
    expect(() => overlay.register(spec('control_points'))).toThrow(/cannot shadow platform op/)
    expect(() => overlay.replace(spec('control_points'))).toThrow(/cannot replace platform op/)
    expect(overlay.unregister('control_points')).toBe(false)
    expect(overlay.has('control_points')).toBe(true)
  })
})
