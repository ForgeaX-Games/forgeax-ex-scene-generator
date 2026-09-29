import { runGridFilter } from '../_filter/runGridFilter.ts'

export function gridNeighborhoodMin(input: Record<string, unknown>) {
  return runGridFilter('nmin', input)
}
