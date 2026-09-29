import { allocateSpanValues, type SpanSpec } from '../../../_shared/layout.js'
export function allocateSpans(input: Record<string, unknown>) { return { result: allocateSpanValues(input.length as number ?? 10,input.spans as SpanSpec[],input.gap as number ?? 0) } }
