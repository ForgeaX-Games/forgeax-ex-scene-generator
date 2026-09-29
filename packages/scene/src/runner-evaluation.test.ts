import { describe, expect, it } from 'vitest'
import { evaluateSceneBundle } from './runner.js'

describe('fresh scene bundle scope',()=>{
  it('supports top-level await, named exports and async default entry functions',async()=>{
    const result=await evaluateSceneBundle(`let count=await Promise.resolve(4); async function start(){count+=2;return count} export {count,start as default};`)
    expect(result.count).toBe(4)
    expect(await (result.default as ()=>Promise<number>)()).toBe(6)
    expect(result.count).toBe(6)
  })
  it('keeps repeated module variables isolated without a process-wide import cache',async()=>{
    const source=`const state=[];function append(v){state.push(v);return state.length};export {state,append};`
    const a=await evaluateSceneBundle(source),b=await evaluateSceneBundle(source)
    expect((a.append as (n:number)=>number)(1)).toBe(1)
    expect(b.state).toEqual([])
    expect(a.state).not.toBe(b.state)
  })
  it('preserves import.meta URL and identity without rewriting source strings',async()=>{
    const result=await evaluateSceneBundle(`const __sceneImportMeta=7; export const label='import.meta.url'; export const meta=import.meta; export function read(){return [import.meta.url,import.meta===meta,__sceneImportMeta]}`, 'file:///scene/scene.bundle.mjs')
    expect(result.label).toBe('import.meta.url')
    expect((result.read as ()=>unknown)()).toEqual(['file:///scene/scene.bundle.mjs',true,7])
  })
})
