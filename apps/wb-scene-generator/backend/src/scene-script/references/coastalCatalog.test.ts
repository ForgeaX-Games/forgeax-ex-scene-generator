import { describe, expect, it } from 'vitest'

import { COASTAL_REFERENCE_TOPICS, loadCoastalReference } from './coastalCatalog.js'

describe('Coastal reference manifests', () => {
  it.each(COASTAL_REFERENCE_TOPICS)('keeps %s topic-scoped while verifying its dependency closure', async (topic) => {
    const payload = await loadCoastalReference(topic) as {
      referenceManifest: {
        roots: string[]
        files: Array<{ path: string; directDependencyCount: number; dependencyCount: number }>
        fileCount: number
        dependencyCount: number
        closureFileCount: number
        closureVerified: boolean
        sourceIncluded: boolean
        maxRoots: number
      }
      starterManifest: {
        included: boolean
        tool: string
      }
    }
    expect(payload.referenceManifest.closureVerified).toBe(true)
    expect(payload.referenceManifest.sourceIncluded).toBe(false)
    expect(payload.referenceManifest.fileCount).toBe(payload.referenceManifest.files.length)
    expect(payload.referenceManifest.fileCount).toBe(payload.referenceManifest.roots.length)
    expect(payload.referenceManifest.fileCount).toBeLessThanOrEqual(payload.referenceManifest.maxRoots)
    expect(payload.referenceManifest.maxRoots).toBe(8)
    expect(payload.referenceManifest.closureFileCount).toBe(
      payload.referenceManifest.fileCount + payload.referenceManifest.dependencyCount,
    )
    expect(payload.referenceManifest.files.every((file) =>
      file.directDependencyCount >= 0 && file.dependencyCount >= file.directDependencyCount)).toBe(true)
    expect(JSON.stringify(payload)).not.toContain('"excerpt"')
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(12 * 1024)
    expect(payload.starterManifest).toEqual(expect.objectContaining({
      included: false,
      tool: 'scene:script.scaffold',
    }))
    expect(payload.starterManifest).not.toHaveProperty('files')
  })

  it('uses distinct roots and excludes whole-city composition roots', async () => {
    const rootsByTopic = await Promise.all(COASTAL_REFERENCE_TOPICS.map(async (topic) => {
      const payload = await loadCoastalReference(topic) as {
        referenceManifest: { roots: string[] }
      }
      return payload.referenceManifest.roots
    }))
    expect(new Set(rootsByTopic.map((roots) => JSON.stringify(roots))).size).toBe(COASTAL_REFERENCE_TOPICS.length)
    expect(rootsByTopic.flat()).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/districts\.scene\.ts$/),
      expect.stringMatching(/\/main\.scene\.ts$/),
    ]))
  })
})
