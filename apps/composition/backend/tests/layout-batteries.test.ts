import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSceneModule } from '@forgeax/scene'
import { describe, it, expect } from 'vitest'
import { allocateSpanValues, segmentRunValues, deriveSeedValue } from '../../batteries/_shared/layout.js'
import { localFrameValue, rotatePoint, fitAnchorValue, boundsRelationValue } from '../../batteries/_shared/frames.js'
import { buildPlatformClosure } from '../src/pack-export/vendorClosure.js'
import { firstBatchImplementations } from '../src/scene-script/run/hostImplementations.js'
import { createSceneRunHost, runWithSceneHost, allocateSpans, deriveSeed } from '@forgeax/scene'

describe('portable layout batteries', () => {
 it('binds the new batteries inside an actual bundled Scene Script', async () => {
  const dir=await mkdtemp(join(tmpdir(),'layout-scene-'))
  try {await writeFile(join(dir,'main.scene.ts'),"import {deriveSeed,localFrame} from '@forgeax/scene'; export default function build(){return {seed:deriveSeed({seed:4,path:'a'}),frame:localFrame({origin:[0,0,0],normal:[0,1,0]})}}")
   const result=await runSceneModule({projectDir:dir,entryFile:'main.scene.ts',exportName:'default',implementations:await firstBatchImplementations()})
   expect(result.ok).toBe(true);expect((result.output as any).seed).toBe(deriveSeedValue(4,'a'))
  } finally {await rm(dir,{recursive:true,force:true})}
 })
 it('preserves fixed jamb widths and redistributes capped flexible widths', () => {
  const r=allocateSpanValues(10,[{key:'jamb',min:1,max:1},{key:'window',min:1,max:2},{key:'wall',min:1}],.5)
  expect(r.placements.map(p=>p.width)).toEqual([1,2,6]); expect(r.remainder).toBe(0)
  expect(()=>allocateSpanValues(1,[{key:'a',min:2}])).toThrow('exceed')
  expect(segmentRunValues(19,6,2).map(s=>s.width)).toEqual([4.75,4.75,4.75,4.75])
  expect(()=>segmentRunValues(1,3,2)).toThrow('minimum')
 })
 it('keeps oriented attachments on their anchors at a non-cardinal angle', () => {
  const a=37*Math.PI/180, f=localFrameValue([2,3,4],[-Math.sin(a),Math.cos(a),0])
  const x=rotatePoint([1,0,0],f.quat)
  expect(x[0]).toBeCloseTo(Math.cos(a)); expect(x[1]).toBeCloseTo(Math.sin(a))
  const t=fitAnchorValue([.4,0,1],[9,8,7],f.quat), p=rotatePoint([.4,0,1],t.quat)
  expect(p.map((v,i)=>v+t.pos[i]!)).toEqual([9,8,7])
  expect(()=>localFrameValue([0,0,0],[0,0,1])).toThrow('nonparallel')
 })
 it('distinguishes touching from collision and preserves independent semantic seeds', () => {
  expect(boundsRelationValue({min:[0,0,0],max:[1,1,1]},{min:[1,0,0],max:[2,1,1]}).relation).toBe('touching')
  expect(boundsRelationValue({min:[0,0,0],max:[1,1,1]},{min:[3,0,0],max:[4,1,1]}).clearance).toBe(2)
  const before=deriveSeedValue(123,'floor/2/window/west'); deriveSeedValue(123,'new-sign')
  expect(deriveSeedValue(123,'floor/2/window/west')).toBe(before)
 })
 it('runs through the real host and resolves the same portable implementation',async()=>{
  const host=createSceneRunHost({implementations:await firstBatchImplementations()})
  runWithSceneHost(host,()=>{expect(deriveSeed({seed:4,path:'a'})).toBe(deriveSeedValue(4,'a'));expect((allocateSpans({length:2,spans:[{key:'a',min:1}]}) as any).placements[0].width).toBe(2)})
  expect(host.trace).toHaveLength(2)
  const closure=buildPlatformClosure(['allocateSpans','segmentRun','deriveSeed','localFrame','fitAnchor','boundsRelation'])
  expect([...closure.files.keys()].some(k=>k.endsWith('_shared/layout.ts'))).toBe(true)
  expect([...closure.files.keys()].some(k=>k.endsWith('_shared/frames.ts'))).toBe(true)
 })
})
