import { segmentRunValues } from '../../../_shared/layout.js'
export function segmentRun(input: Record<string, unknown>) { return { result: segmentRunValues(input.length as number ?? 10,input.maximum as number ?? 3,input.minimum as number ?? 0,input.gap as number ?? 0) } }
