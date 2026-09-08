import { describe, expect, it } from 'vitest'
import { hydrateCapturedOutputs } from '../src/captured-outputs.js'

describe('canonical execution output references', () => {
  it('hydrates only omitted final ports without changing the wire result', () => {
    const data = [{ path: [0], items: [{ graph: {}, focus: 'terrain' }] }]
    const full: any = { status: 'completed', outputs: { final: { names: [] } }, resultMetadata: {
      final: { scene: { value: { inline: false, ref: 'outputs/final/scene' } } },
      intermediate: { mesh: { value: { inline: false, ref: 'outputs/intermediate/mesh' } } },
    } }
    const reads: string[] = []
    const result = hydrateCapturedOutputs(full, (node, port) => { reads.push(`${node}/${port}`); return data }, ['final'])
    expect(result.outputs.final.scene).toEqual(data)
    expect(reads).toEqual(['final/scene'])
    expect(full.outputs.final.scene).toBeUndefined()
  })
  it('does not silently accept missing final output data', () => {
    const full: any = { outputs: {}, resultMetadata: { final: { scene: { value: { inline: false } } } } }
    expect(() => hydrateCapturedOutputs(full, () => undefined, ['final'])).toThrow('final/scene')
  })
})
