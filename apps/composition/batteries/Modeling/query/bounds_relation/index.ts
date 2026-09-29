import { boundsRelationValue, type Bounds3 } from '../../../_shared/frames.js'
export function boundsRelation(input: Record<string, unknown>) { return { result: boundsRelationValue(input.a as Bounds3,input.b as Bounds3,input.tolerance as number ?? 0) } }
