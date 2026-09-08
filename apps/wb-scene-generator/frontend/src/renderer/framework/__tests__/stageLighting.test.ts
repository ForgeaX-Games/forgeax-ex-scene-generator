import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createStageEnvironment } from '../stageLighting'

describe('createStageEnvironment', () => {
  it('does not install distance fog that would wash out a continent overview', () => {
    const scene = new THREE.Scene()
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
      setClearColor() {},
    } as unknown as THREE.WebGLRenderer
    const env = createStageEnvironment(scene, renderer)
    expect(scene.fog).toBeNull()
    env.dispose()
    expect(scene.fog).toBeNull()
  })
})
