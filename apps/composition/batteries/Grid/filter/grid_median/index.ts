import { runGridFilter } from '../_filter/runGridFilter.ts'

export function gridMedian(input: Record<string, unknown>) {
  return runGridFilter('median', input)
}
