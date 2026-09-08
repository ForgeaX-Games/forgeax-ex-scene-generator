// Faithful sidebar smoke test — render the ported BatteryBar and PropertiesPanel
// over a mock-ApiClient-backed store and assert they mount with the real legacy
// CSS classes (BatteryBar's .battery-bar / .bb-body / .battery-row, the
// inspector's .sidebar / .sidebar-tabs) without throwing. The seeded battery
// also appears as a draggable .battery-row, exercising the catalog render path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import BatteryBar from '../components/sidebar/BatteryBar.js'
import PropertiesPanel from '../components/sidebar/PropertiesPanel.js'
import type { Battery, Pipeline } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  nameEn: 'Echo',
  type: 'ts',
  category: 'base/general',
  description: 'echoes its input',
  version: '1.0.0',
  inputs: [{ name: 'in', type: 'string' }],
  outputs: [{ name: 'out', type: 'string' }],
  params: [],
}

function seededPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-smoke',
    name: 'smoke',
    description: '',
    nodes: [{ id: 'n1', batteryId: 'demo.echo', name: 'Echo', position: { x: 40, y: 40 }, params: { in: 'hi' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

let transport: EditorTransport

beforeEach(() => {
  const client = createMockApiClient({
    ops: [{ id: 'demo.echo', name: 'Echo', inputs: [], outputs: [], params: [], execute: () => null }],
  })
  transport = createEditorTransport(client)
  configureEditorTransport(transport)
  usePipelineStore.setState({
    batteries: [echoBattery],
    categories: [],
    batteryOrder: { bigLabels: [], smallLabels: {} },
    currentPipeline: seededPipeline(),
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    compileInfo: null,
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('faithful sidebar smoke', () => {
  it('mounts the BatteryBar catalog with the real legacy CSS classes', () => {
    const { container } = render(<BatteryBar />)

    // Root + body containers from BatteryBar.css.
    const bar = container.querySelector('.battery-bar')
    expect(bar).not.toBeNull()
    expect(bar?.classList.contains('battery-bar--vertical')).toBe(true)
    expect(container.querySelector('.bb-body')).not.toBeNull()
    expect(container.querySelector('.bb-rail-scroll-region')).not.toBeNull()
    expect(container.querySelector('.bb-scroller')).not.toBeNull()

    // The seeded battery renders as a draggable .battery-row with its name.
    const row = container.querySelector('.battery-row')
    expect(row).not.toBeNull()
    expect(container.querySelector('.battery-row-name')?.textContent).toBe('Echo')
  })

  it('pins the big-label rail expanded via the always-visible bottom footer button (not the scrollable rail)', () => {
    const { container } = render(<BatteryBar />)

    // The pin button lives in a dedicated footer sibling of `.bb-body`, not inside
    // the scrollable `.bb-big-rail` — so it can never be scrolled out of view by a
    // long category list.
    const footer = container.querySelector('.bb-pin-footer')
    expect(footer).not.toBeNull()
    const pinButton = footer?.querySelector<HTMLButtonElement>('.bb-rail-button--pin')
    expect(pinButton).not.toBeNull()

    const rail = container.querySelector('.bb-big-rail')
    expect(rail).not.toBeNull()
    expect(rail?.classList.contains('bb-big-rail--expanded')).toBe(false)
    expect(pinButton?.classList.contains('active')).toBe(false)

    // Clicking pins the rail expanded, marks the button active, and — critically —
    // does NOT render the hover-only overlay spacer, since a pinned rail pushes
    // `.bb-scroller` in normal flow instead of floating on top of it.
    fireEvent.click(pinButton!)
    expect(pinButton?.classList.contains('active')).toBe(true)
    expect(rail?.classList.contains('bb-big-rail--expanded')).toBe(true)
    expect(rail?.classList.contains('bb-big-rail--pinned')).toBe(true)
    expect(container.querySelector('.bb-big-rail-spacer')).toBeNull()

    // Clicking again unpins it.
    fireEvent.click(pinButton!)
    expect(pinButton?.classList.contains('active')).toBe(false)
    expect(rail?.classList.contains('bb-big-rail--expanded')).toBe(false)
  })

  it('mounts the PropertiesPanel inspector with the real legacy CSS classes', () => {
    const { container } = render(<PropertiesPanel />)

    // Inspector shell + tab bar from Sidebar.css.
    expect(container.querySelector('.sidebar')).not.toBeNull()
    expect(container.querySelector('.sidebar-header')).not.toBeNull()
    expect(container.querySelectorAll('.sidebar-tab').length).toBe(3)

    // No node selected → the empty-state placeholder renders.
    expect(container.querySelector('.sidebar-empty')).not.toBeNull()
  })
})
