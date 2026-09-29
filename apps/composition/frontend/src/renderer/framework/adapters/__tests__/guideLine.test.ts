import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildGuideObject, isOverviewGuide, scaleGuideBillboards, setGuidePreviewWorld } from '../guideLine'
import type { GuideLayer } from '../../../types'

function layer(style: GuideLayer['style']): GuideLayer {
  return {
    key: 'g:points',
    nodeId: 'g',
    portName: 'points',
    nodeName: 'Peaks',
    points: [{ x: 1, y: 2 }, { x: 8, y: 4 }],
    style,
    visible: true,
    updatedAt: 1,
  }
}

function named(group: THREE.Group, prefix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  group.traverse((c) => { if (c.name.startsWith(prefix)) out.push(c) })
  return out
}

describe('buildGuideObject', () => {
  it('draws a fat tube for curve controls', () => {
    const group = buildGuideObject(layer('polyline'), [])
    expect(named(group, 'guide-line:')).toHaveLength(1)
    expect(named(group, 'guide-dot:')).toHaveLength(8)
    expect(named(group, 'guide-pin:')).toHaveLength(2)
  })

  it('omits the connecting tube for disconnected point handles', () => {
    const group = buildGuideObject(layer('points'), [])
    expect(named(group, 'guide-line:')).toHaveLength(0)
    expect(named(group, 'guide-dot:')).toHaveLength(8)
  })

  it('keeps pin billboards small even from a far camera', () => {
    const group = buildGuideObject(layer('points'), [])
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    camera.position.set(0, 0, 400)
    scaleGuideBillboards(group, camera)
    const pin = named(group, 'guide-pin:')[0]!
    expect(pin.scale.x).toBeGreaterThanOrEqual(1)
    expect(pin.scale.x).toBeLessThanOrEqual(2.1)
  })

  it('keeps continent overview guides out of auto-fit', () => {
    expect(isOverviewGuide('ContinentFrame')).toBe(true)
    expect(isOverviewGuide('ContinentRiver')).toBe(true)
    expect(isOverviewGuide('Peaks')).toBe(false)
    const group = buildGuideObject({
      ...layer('polyline'),
      nodeName: 'ContinentFrame',
    }, [])
    expect(group.userData.skipFit).toBe(true)
  })

  it('moves the selected pin and gizmo to the same world XY', () => {
    const root = new THREE.Group()
    const pins = buildGuideObject(layer('points'), [])
    const gizmo = new THREE.Group()
    gizmo.name = 'guide-gizmo'
    gizmo.position.set(1, -2, 4)
    root.add(pins, gizmo)
    setGuidePreviewWorld(root, 'g:points', 0, 10, -20, 7)
    expect(root.getObjectByName('guide-pin:g:points:0')?.position.toArray()).toEqual([10, -20, 7])
    expect(gizmo.position.toArray()).toEqual([10, -20, 7])
  })
})
