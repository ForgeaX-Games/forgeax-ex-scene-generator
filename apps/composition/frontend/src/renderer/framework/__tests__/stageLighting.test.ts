import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createStageEnvironment } from '../stageLighting'

function renderer(): THREE.WebGLRenderer {
  return {
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    setClearColor: () => {},
  } as unknown as THREE.WebGLRenderer
}

describe('createStageEnvironment', () => {
  it('provides Z-up daylight without fog and restores previous settings', () => {
    const scene = new THREE.Scene()
    scene.environmentIntensity = 0.3
    scene.environmentRotation.set(0.2, 0.4, 0.1)
    const rotation = scene.environmentRotation.clone()
    const env = createStageEnvironment(scene, renderer())
    const daylight = scene.environment as THREE.DataTexture
    const disposed = vi.fn()
    daylight.addEventListener('dispose', disposed)
    expect(scene.fog).toBeNull()
    expect(env.hemi.position.toArray()).toEqual([0, 0, 1])
    expect(daylight.mapping).toBe(THREE.EquirectangularReflectionMapping)
    expect(Array.from(daylight.image.data as Float32Array).every(Number.isFinite)).toBe(true)
    expect(scene.environmentIntensity).toBe(0.65)
    expect(env.sun.shadow.mapSize.toArray()).toEqual([2048, 2048])
    env.dispose()
    expect(scene.environment).toBeNull()
    expect(scene.environmentIntensity).toBe(0.3)
    expect(scene.environmentRotation.equals(rotation)).toBe(true)
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('preserves host-authored environments instead of replacing or disposing them', () => {
    const scene = new THREE.Scene()
    const authored = new THREE.Texture()
    const disposed = vi.fn()
    authored.addEventListener('dispose', disposed)
    scene.environment = authored
    scene.environmentIntensity = 1.8
    scene.environmentRotation.set(0.5, 0.1, 0.3)
    const rotation = scene.environmentRotation.clone()
    const env = createStageEnvironment(scene, renderer(), { environmentIntensity: 0.2 })
    expect(scene.environment).toBe(authored)
    expect(scene.environmentIntensity).toBe(1.8)
    expect(scene.environmentRotation.equals(rotation)).toBe(true)
    env.dispose()
    expect(scene.environment).toBe(authored)
    expect(scene.environmentIntensity).toBe(1.8)
    expect(scene.environmentRotation.equals(rotation)).toBe(true)
    expect(disposed).not.toHaveBeenCalled()
    authored.dispose()
  })

  it('supports quality overrides and preserves an environment installed later', () => {
    const scene = new THREE.Scene()
    const env = createStageEnvironment(scene, renderer(), { shadowMapSize: 1024, environmentIntensity: 0.2 })
    const daylight = scene.environment!
    const disposed = vi.fn()
    daylight.addEventListener('dispose', disposed)
    expect(env.sun.shadow.mapSize.toArray()).toEqual([1024, 1024])
    expect(scene.environmentIntensity).toBe(0.2)
    const replacement = new THREE.Texture()
    scene.environment = replacement
    scene.environmentIntensity = 2
    scene.environmentRotation.set(0.1, 0.2, 0.3)
    const rotation = scene.environmentRotation.clone()
    env.dispose()
    expect(scene.environment).toBe(replacement)
    expect(scene.environmentIntensity).toBe(2)
    expect(scene.environmentRotation.equals(rotation)).toBe(true)
    expect(disposed).toHaveBeenCalledOnce()
    replacement.dispose()
  })

  it('coalesces layer changes and fits the latest translated, rotated content', () => {
    const env = createStageEnvironment(new THREE.Scene(), renderer())
    const content = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(400, 340, 90), new THREE.MeshBasicMaterial())
    content.add(mesh)
    const fit = vi.spyOn(THREE.Box3.prototype, 'setFromObject')
    try {
      for (let i = 0; i < 100; i++) {
        content.position.set(1200 + i, -900, 50)
        env.invalidateBounds(content)
      }
      content.rotation.z = 0.4
      expect(fit).not.toHaveBeenCalled()
      env.update()
      expect(fit).toHaveBeenCalledOnce()
      env.update()
      expect(fit).toHaveBeenCalledOnce()
      const bounds = new THREE.Box3().setFromObject(content)
      const center = bounds.getCenter(new THREE.Vector3())
      expect(env.sun.target.position.toArray()).toEqual(center.toArray())
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(env.sun.shadow.camera)
        expect(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))).toBeLessThanOrEqual(1)
      }
      expect(env.ground.position.x).toBe(center.x)
      expect(env.ground.position.z).toBeLessThan(bounds.min.z)
    } finally {
      fit.mockRestore()
      mesh.geometry.dispose()
      mesh.material.dispose()
      env.dispose()
    }
  })

  it('hides the catcher for empty content and refits after adding content', () => {
    const env = createStageEnvironment(new THREE.Scene(), renderer())
    const content = new THREE.Group()
    env.invalidateBounds(content)
    env.update()
    expect(env.ground.visible).toBe(false)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.3), new THREE.MeshBasicMaterial())
    content.add(mesh)
    env.invalidateBounds(content)
    env.update()
    expect(env.ground.visible).toBe(true)
    expect(env.sun.shadow.camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true)
    mesh.geometry.dispose()
    mesh.material.dispose()
    env.dispose()
  })
})
