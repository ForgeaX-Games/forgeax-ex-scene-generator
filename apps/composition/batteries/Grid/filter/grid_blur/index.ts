import { runGridFilter } from '../_filter/runGridFilter.ts'

export function gridBlur(input: Record<string, unknown>) {
  return runGridFilter('blur', input)
}
