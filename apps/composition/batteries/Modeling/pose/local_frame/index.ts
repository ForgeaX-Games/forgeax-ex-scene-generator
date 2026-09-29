import { localFrameValue, type V3 } from '../../../_shared/frames.js'
export function localFrame(input: Record<string, unknown>) { return { result: localFrameValue(input.origin as V3 ?? [0,0,0],input.normal as V3 ?? [0,1,0],input.up as V3 ?? [0,0,1]) } }
