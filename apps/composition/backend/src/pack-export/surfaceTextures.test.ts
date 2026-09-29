import { describe, expect, it } from 'vitest'
import { decodeSurfaceTexture, projectSurfaceUvs, surfaceTextureKey, validateSurfaceTextureMaps, type SurfaceTexture } from '../../../vendor/shared/types/scene/surfaceTexture.js'
import { defineMaterial, paintSurfaceMesh } from '../../../vendor/shared/types/scene/surfacePaint.js'
import { collectMaterialTextures, projectScene, type BridgeSceneTree } from './engineBridge.js'
import { emitPackSource } from './emitPack.js'
import { fingerprintProjection, firstDifference } from './fingerprint.js'
const texture: SurfaceTexture = { width: 1, height: 1, rgba8: 'gID//w==', colorSpace: 'linear' }
const geometry = {positions:[0,0,0, 2,0,0, 0,0,3], indices:[0,1,2], normals:[0,-1,0,0,-1,0,0,-1,0]}
function scene(t:SurfaceTexture):BridgeSceneTree {
  return {focus:'root',graph:{root:{id:'root',content:{schema:'mesh',mesh:{...geometry,material:{id:'wall',surface:{baseColor:[1,1,1,1],normalTexture:t}}}}}}}
}
describe('portable surface textures',()=>{
  it('decodes exact RGBA8 pixels and rejects dimensions or non-linear normal data',()=>{
    expect([...decodeSurfaceTexture(texture)]).toEqual([128,128,255,255])
    expect(()=>decodeSurfaceTexture({...texture,width:2})).toThrow(/dimensions/)
    expect(()=>validateSurfaceTextureMaps({normalTexture:{...texture,colorSpace:'srgb'}})).toThrow(/linear/)
  })
  it('keeps texture bytes and repeat when painting, and separates appearances with different repeats',()=>{
    const mesh={...geometry,indices:[0,1,2,0,2,1]}
    const painted=paintSurfaceMesh(mesh,defineMaterial({name:'wall',surface:s=>({baseColor:[1,1,1,1],normalTexture:{...texture,scale:[s.triangle+1,1]}})}))
    expect(painted.mesh.material?.palette).toHaveLength(2)
    expect(painted.mesh.material?.palette?.[0]?.normalTexture).toEqual({...texture,scale:[1,1]})
    const p=projectScene({focus:'a',graph:{a:{id:'a',content:{schema:'mesh',mesh:painted.mesh}}}})
    expect(collectMaterialTextures(p.materials)).toHaveLength(1)
  })
  it('matches preview/export metre UVs and fingerprints image changes',()=>{
    const a=projectScene(scene(texture)),b=projectScene(scene({...texture,rgba8:'AAAA/w=='}))
    expect([...projectSurfaceUvs(geometry.positions,geometry.normals)]).toEqual([0,0,2,0,0,3])
    expect(firstDifference(fingerprintProjection(a),fingerprintProjection(b))).toMatch(/material/)
    expect(surfaceTextureKey({...texture,scale:[2,2]})).toBe(surfaceTextureKey(texture))
  })
  it('emits dynamic texture outputs under the native 2.0.0 build contract',()=>{
    const options={packageUuid:'00000000-0000-0000-0000-000000000000',packName:'test',sceneSlug:'test',}
    expect(emitPackSource(options)).toContain("outputs['texture/' + key]")
    expect(emitPackSource(options)).not.toContain("externalAssets:")
  })
})
