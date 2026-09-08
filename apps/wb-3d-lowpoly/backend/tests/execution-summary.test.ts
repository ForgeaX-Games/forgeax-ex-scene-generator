import { describe, it, expect } from 'vitest'
import { summarizeExecutionResult } from '../src/execution-summary.js'

// DataTreeEntry[] wire-format helper: one branch at path [0] holding a single item.
function scalarPort(value: unknown): unknown {
  return [{ path: [0], items: [value] }]
}

describe('summarizeExecutionResult', () => {
  it('keeps g_geometry_qc report text readable instead of collapsing to a length note', () => {
    const report = [
      'aabb_overlap: parts "wheel_fl" and "chassis" interpenetrate in rest pose (min depth=0.0120m, tol=0.0010m). note: AABB-only check, conservative for rotated meshes.',
      'floating_link: 1 part(s) have no joint path to the root: [antenna]. URDF only renders the root-connected tree, so these will be dropped at runtime — attach them with g_joint_* (fixed/revolute/...).',
    ].join('\n')
    expect(report.length).toBeGreaterThan(256) // would have been nuked under the old 256-char cap

    const full = {
      executionId: 'exec-1',
      status: 'completed',
      durationMs: 12,
      outputs: {
        qc1: {
          valid: scalarPort(false),
          report: scalarPort(report),
        },
      },
    }

    const summary = summarizeExecutionResult(full) as any
    const reportItem = summary.outputs.qc1.report.items[0]
    // The full multiline report text must be present verbatim, not just a length note.
    expect(reportItem.value).toBe(report)
  })

  it('inlines structured QC signals[] (code/severity/message) instead of collapsing to {kind:"array"}', () => {
    const signals = [
      { code: 'aabb_overlap', severity: 'warning', message: 'parts "a" and "b" interpenetrate', ids: ['a', 'b'] },
      { code: 'floating_link', severity: 'warning', message: 'part "c" has no joint path to root', ids: ['c'] },
    ]
    const full = {
      executionId: 'exec-2',
      status: 'completed',
      durationMs: 5,
      outputs: {
        qc1: { signals: scalarPort(signals) },
      },
    }

    const summary = summarizeExecutionResult(full) as any
    const signalsItem = summary.outputs.qc1.signals.items[0]
    // Previously: signalsItem.value === { kind: 'array', length: 2 } — no content at all.
    expect(Array.isArray(signalsItem.value)).toBe(true)
    expect(signalsItem.value).toHaveLength(2)
    expect(signalsItem.value[0]).toMatchObject({
      code: 'aabb_overlap',
      severity: 'warning',
      message: 'parts "a" and "b" interpenetrate',
    })
    expect(signalsItem.value[1].code).toBe('floating_link')
  })

  it('keeps g_to_urdf.report fields (fingerprint, bakeFallbacks, signalBundle) visible', () => {
    const report = {
      meshFileCount: 3,
      meshTotalBytes: 40960,
      totalVertices: 812,
      totalTriangles: 400,
      bakeMs: 42,
      cacheHits: 1,
      bakeFallbacks: 0,
      fingerprint: 'a1b2c3d4',
      signalBundle: { errors: 0, warnings: 1, notes: 2, codes: { AUTO_WRAP_ORPHAN_SHAPE: 1 } },
    }
    const full = {
      executionId: 'exec-3',
      status: 'completed',
      durationMs: 8,
      outputs: {
        urdf1: { report: scalarPort(report) },
      },
    }

    const summary = summarizeExecutionResult(full) as any
    const reportItem = summary.outputs.urdf1.report.items[0]
    expect(reportItem.fingerprint).toBe('a1b2c3d4')
    expect(reportItem.bakeFallbacks).toBe(0)
    expect(reportItem.signalBundle.warnings).toBe(1)
    expect(reportItem.signalBundle.codes.AUTO_WRAP_ORPHAN_SHAPE).toBe(1)
  })

  it('still collapses opaque blobs (data URIs / base64) and large numeric buffers', () => {
    const dataUri = 'data:image/png;base64,' + 'A'.repeat(5000)
    const bigArray = Array.from({ length: 500 }, (_, i) => i)
    const full = {
      executionId: 'exec-4',
      status: 'completed',
      durationMs: 3,
      outputs: {
        node1: {
          image: scalarPort(dataUri),
          vertices: scalarPort(bigArray),
        },
      },
    }

    const summary = summarizeExecutionResult(full) as any
    const imageItem = summary.outputs.node1.image.items[0]
    expect(imageItem.kind).toBe('string')
    expect(imageItem.length).toBe(dataUri.length)
    expect(imageItem.value).toBeUndefined()

    const verticesItem = summary.outputs.node1.vertices.items[0]
    expect(verticesItem.kind).toBe('array')
    expect(verticesItem.length).toBe(500)
  })

  it('still truncates a very long readable report with a bounded preview instead of unbounded growth', () => {
    const longReport = Array.from({ length: 400 }, (_, i) => `issue ${i}: something is wrong here`).join('\n')
    const full = {
      executionId: 'exec-5',
      status: 'completed',
      durationMs: 1,
      outputs: { qc1: { report: scalarPort(longReport) } },
    }
    const summary = summarizeExecutionResult(full) as any
    const reportItem = summary.outputs.qc1.report.items[0]
    expect(reportItem.length).toBe(longReport.length)
    expect(reportItem.preview.length).toBeLessThan(longReport.length)
    expect(longReport.startsWith(reportItem.preview)).toBe(true)
  })
})
