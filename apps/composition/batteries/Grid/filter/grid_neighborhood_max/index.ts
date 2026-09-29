import { runGridFilter } from '../_filter/runGridFilter.ts'

export function gridNeighborhoodMax(input: Record<string, unknown>) {
  return runGridFilter('nmax', input)
}
