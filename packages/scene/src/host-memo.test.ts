import {describe,expect,it} from 'vitest'
import {createSceneRunHost,runWithSceneHost,invoke,serializeArgs} from './host.js'

describe('nested procedural component memoization',()=>{
 it('evaluates same-length meshes from the same source call independently and propagates changes to their parent',()=>{
  const host=createSceneRunHost({implementations:{sceneNode:({geometry})=>({scene:{geometry}}),addChild:({nodes})=>({scene:{nodes}})}})
  runWithSceneHost(host,()=>{
   const make=(width:number)=>{
    const mesh=invoke('sceneNode',{__sceneId:'roof',geometry:{positions:Array(90).fill(width),indices:[0,1,2]}})
    return invoke('addChild',{__sceneId:'building',nodes:[mesh]})
   }
   const a=make(4),b=make(8),repeat=make(8)
   expect(a).not.toBe(b)
   expect(repeat).toBe(b)
   expect((b as any).scene.nodes[0].scene.geometry.positions[0]).toBe(8)
  })
 })
 it('distinguishes local placements even when a group reuses the same child',()=>{
  const host=createSceneRunHost({implementations:{addChild:args=>({scene:args})}})
  runWithSceneHost(host,()=>{
   const make=(x:number)=>invoke('addChild',{__sceneId:'place',scene:{focus:'group',graph:new Map([['group',{transform:{pos:[x,0,0]}}]])},nodes:[]})
   expect(make(1)).not.toBe(make(2))
  })
 })
 it('detects deep palette edits and typed buffer contents, including edits to reused input objects',()=>{
  const value={geometry:{material:{palette:[{baseColor:[1,0,0,1]}]}},positions:new Float32Array(90)}
  const a=serializeArgs(value);value.geometry.material.palette[0]!.baseColor[0]=.5
  const b=serializeArgs(value);expect(a).not.toBe(b)
  value.positions[89]=4;expect(serializeArgs(value)).not.toBe(b)
  expect(serializeArgs({value:Infinity})).not.toBe(serializeArgs({value:null}))
 })
})
