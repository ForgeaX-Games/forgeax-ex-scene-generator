import { describe, expect, it } from 'vitest'

import { sceneCallId } from './ids.js'
import { inspectSceneSource } from './inspect.js'
import ts from 'typescript'

describe('inspectSceneSource', () => {
  it('uses the same call id as injectSceneCallIds', () => {
    const file = 'main.scene.ts'
    const source = `import { basePlane } from '@forgeax/scene'
const worldWidth = 120
const world = basePlane({ width: worldWidth, height: 80 })
`
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    let call: ts.CallExpression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && !call) call = node
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    const sites = inspectSceneSource(source, file)
    expect(sites.find((site) => site.kind === 'call')?.id).toBe(sceneCallId(source, file, call!, sourceFile))
    expect(sites.find((site) => site.binding === 'worldWidth')?.kind).toBe('literal')
    expect(sites.find((site) => site.kind === 'call')?.args.width).toEqual({
      kind: 'reference',
      binding: 'worldWidth',
    })
  })

  it('reads shorthand bindings', () => {
    const sites = inspectSceneSource(
      `const width = 12
const world = basePlane({ width, height: 8 })
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.kind === 'call')?.args.width).toEqual({
      kind: 'reference',
      binding: 'width',
    })
  })

  it('keeps the port on world.geometry', () => {
    const sites = inspectSceneSource(
      `const field = heightfield({ geometry: world.geometry })
const world = basePlane({})
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.binding === 'field')?.args.geometry).toEqual({
      kind: 'reference',
      binding: 'world',
      output: 'geometry',
    })
  })

  it('reads a named JSON record as a literal dict', () => {
    const sites = inspectSceneSource(
      `const edges = [{ from: 0, to: 1 }, { from: 1, to: 2 }]
const paths = network2d({ nodes: [origin.geometry], edges })
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.binding === 'edges')).toEqual(expect.objectContaining({
      kind: 'literal',
      value: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    }))
    expect(sites.find((site) => site.binding === 'paths')?.args.edges).toEqual({
      kind: 'reference',
      binding: 'edges',
    })
  })

  it('reads an inline edge table as a JSON literal, not a list construction', () => {
    const sites = inspectSceneSource(
      `const paths = network2d({ edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] })
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.binding === 'paths')?.args.edges).toEqual({
      kind: 'literal',
      value: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    })
  })

  it('reads bare site bindings as references without a port suffix', () => {
    const sites = inspectSceneSource(
      `const road = polyline2d({ points: [origin, plaza] })
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.binding === 'road')?.args.points).toEqual({
      kind: 'other',
      items: [
        { kind: 'reference', binding: 'origin' },
        { kind: 'reference', binding: 'plaza' },
      ],
    })
  })

  it('walks array items so points: [origin.geometry, plaza.geometry] stays a list construction', () => {
    const sites = inspectSceneSource(
      `const road = polyline2d({ points: [origin.geometry, plaza.geometry] })
`,
      'main.scene.ts',
    )
    expect(sites.find((site) => site.binding === 'road')?.args.points).toEqual({
      kind: 'other',
      items: [
        { kind: 'reference', binding: 'origin', output: 'geometry' },
        { kind: 'reference', binding: 'plaza', output: 'geometry' },
      ],
    })
  })
})
