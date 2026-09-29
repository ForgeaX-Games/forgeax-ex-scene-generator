import { runGridFilter } from '../_filter/runGridFilter.ts'

export function gridSharpen(input: Record<string, unknown>) {
  return runGridFilter('sharpen', input)
}
