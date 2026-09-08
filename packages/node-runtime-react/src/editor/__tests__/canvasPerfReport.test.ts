import { describe, expect, it } from 'vitest'
import { isCanvasPerfReportEnabled } from '../utils/canvasPerfReport.js'

describe('canvas performance reporting', () => {
  it('enables reporting only for the Vite string flag', () => {
    expect(isCanvasPerfReportEnabled({ VITE_CANVAS_PERF_DEBUG: 'true' })).toBe(true)
    expect(isCanvasPerfReportEnabled({ VITE_CANVAS_PERF_DEBUG: 'false' })).toBe(false)
    expect(isCanvasPerfReportEnabled({})).toBe(false)
  })
})
