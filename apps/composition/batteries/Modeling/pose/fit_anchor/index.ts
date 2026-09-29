import { fitAnchorValue, type V3, type Q4 } from '../../../_shared/frames.js'
export function fitAnchor(input: Record<string, unknown>) { return { result: fitAnchorValue(input.local as V3 ?? [0,0,0],input.target as V3 ?? [0,0,0],input.quat as Q4 ?? [0,0,0,1]) } }
