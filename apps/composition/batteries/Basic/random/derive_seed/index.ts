import { deriveSeedValue } from '../../../_shared/layout.js'
export function deriveSeed(input: Record<string, unknown>) { return { result: deriveSeedValue(input.seed as number ?? 1,input.path as string ?? "module") } }
