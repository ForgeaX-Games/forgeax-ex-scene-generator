import {describe,expect,it,vi} from 'vitest'
import {writeTraceOutputs} from '../src/scene-script/run/runProject.js'

describe('loop output persistence',()=>{
 it('writes only the final value of each source call without discarding the execution trace',()=>{
  const write=vi.fn(),runtime={outputs:{write}} as any
  const call=(id:string,n:number)=>({id,functionName:'box',args:{width:n},result:{geometry:{kind:'mesh',positions:[n,0,0],indices:[]}},argRefs:[],reused:false})
  const trace=[call('roof',1),call('wall',2),call('roof',3)] as any
  const outputs=writeTraceOutputs(runtime,trace,'revision')
  expect(write).toHaveBeenCalledTimes(2)
  expect(write.mock.calls.map(c=>c[0])).toEqual(['roof','wall'])
  expect(JSON.stringify(outputs.roof)).toContain('3')
  expect(JSON.stringify(outputs.roof)).not.toContain('[1,0,0]')
  expect(trace).toHaveLength(3)
 })
})
