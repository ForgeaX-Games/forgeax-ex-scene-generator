import { describe, expect, it } from 'vitest'
import { buildPlatformClosure, collectSceneImports } from './vendorClosure.js'
import { fingerprintProjection, firstDifference } from './fingerprint.js'
import {
  defineMaterial,
  paintSurfaceMesh,
  SURFACE_VARIANT_BUDGET,
} from '../../../vendor/shared/types/scene/surfacePaint.js'
import {
  PACK_FLOATS_PER_VERTEX,
  projectScene,
  Y_UP_QUAT,
  type BridgeSceneTree,
  type PackProjection,
} from './engineBridge.js'

/**
 * These cover the parts of the export that can silently produce a *wrong* pack
 * rather than a failing one: a closure that misses a transitive file, a
 * fingerprint that calls two different scenes equal, and the placement split —
 * pivot plus axis rotation is the whole of where geometry lands in the engine,
 * and getting it wrong renders something plausible in the wrong place.
 */

describe('collectSceneImports', () => {
  it('collects named imports across files, dedupes and sorts, and ignores other modules', () => {
    const names = collectSceneImports(
      new Map([
        ['main.scene.ts', "import { sceneOutput, box } from '@forgeax/scene'\nimport { x } from './other.ts'\n"],
        ['b.scene.ts', "import type { Geometry } from '@forgeax/scene'\nimport { box } from '@forgeax/scene'\n"],
        ['c.ts', "import { unrelated } from '@forgeax/scene-authoring'\n"],
      ]),
    )
    expect(names).toEqual(['box', 'sceneOutput'])
  })
})

describe('buildPlatformClosure', () => {
  it('emits a barrel line per import and vendors every transitively reachable file', () => {
    const closure = buildPlatformClosure(['sceneOutput', 'heightfieldMesh', 'emptyScene', 'defineGenerator'])
    expect([...closure.files.keys()].some(file => file.includes('/vendor/dist/'))).toBe(false)
    expect(closure.files.get('engineBridge.ts')).toContain('/vendor/shared/types/scene/surfaceTexture.ts')
    expect(closure.imported).toEqual(['defineGenerator', 'emptyScene', 'heightfieldMesh', 'sceneOutput'])
    for (const name of closure.imported) {
      // Either a plain re-export, or the unwrapping const a battery with a
      // primary output port gets. Both make the name importable.
      expect(closure.barrel).toMatch(
        new RegExp(`^(export \\{ ${name} \\} from '\\./|export const ${name} = )`, 'm'),
      )
    }
    // heightfieldMesh returns `{ geometry, _warnings }`; the app hands the scene
    // only `geometry`, so the pack must too or scene code that reads the result
    // sees a different shape in the two runs.
    expect(closure.barrel).toMatch(/^export const heightfieldMesh = \(args: Parameters<typeof heightfieldMesh\$body>\[0\]\) => primary\(heightfieldMesh\$body\(args\), "geometry"\)$/m)
    expect(closure.barrel).toMatch(/^import \{ primary \} from '\.\/primary\.ts'$/m)
    // A non-battery SDK name has no port to unwrap and stays a plain re-export.
    expect(closure.barrel).toMatch(/^export \{ defineGenerator \} from '\.\/generator\.ts'$/m)
    // Every relative specifier the vendored tree mentions must itself be in the tree.
    for (const [file, source] of closure.files) {
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
      for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
        const parts = [...dir.split('/').filter(Boolean), ...match[1]!.split('/')]
        const stack: string[] = []
        for (const part of parts) {
          if (part === '.' || part === '') continue
          if (part === '..') stack.pop()
          else stack.push(part)
        }
        expect(closure.files.has(stack.join('/')), `${file} -> ${match[1]}`).toBe(true)
      }
    }
  })

  it('refuses a name the battery table does not carry instead of emitting a broken barrel', () => {
    expect(() => buildPlatformClosure(['notARealSceneFunction'])).toThrow(/cannot vendor/)
  })
})

function projection(
  vertexSeed: number,
  slug = 'a',
  translation: [number, number, number] = [0, 0, 0],
  materialKey = 'a',
): PackProjection {
  const vertices = new Float32Array([vertexSeed, 1, 2, 0, 0, 1, 0, 0])
  return {
    materials: [{ key: materialKey, surface: { baseColor: [1, 1, 1, 1], roughness: 1, metallic: 0 } }],
    entities: [
      {
        slug,
        name: slug,
        parentIndex: null,
        translation,
        mesh: {
          vertices,
          indices: new Uint32Array([0, 0, 0]),
          vertexCount: 1,
          triangleCount: 1,
          runs: [{ material: 0, indexOffset: 0, indexCount: 3 }],
          uvsGenerated: false,
          pivot: translation,
        },
      },
    ],
    meshCount: 1,
    vertexCount: 1,
    triangleCount: 1,
    bounds: { min: [vertexSeed, 1, 2], max: [vertexSeed, 1, 2], diagonal: 0 },
  }
}

describe('fingerprint', () => {
  it('reports identical projections as identical', () => {
    expect(firstDifference(fingerprintProjection(projection(0)), fingerprintProjection(projection(0)))).toBeNull()
  })

  it('catches a vertex-level difference that leaves the counts unchanged', () => {
    const difference = firstDifference(fingerprintProjection(projection(0)), fingerprintProjection(projection(9)))
    expect(difference).toBe('"a" has the same counts but different vertex data')
  })

  it('names the entity that moved when the slugs diverge', () => {
    const difference = firstDifference(
      fingerprintProjection(projection(0, 'a')),
      fingerprintProjection(projection(0, 'b')),
    )
    expect(difference).toBe('entity 0 is "a" in app but "b" standalone')
  })

  it('catches a component that moved even when its vertex data is untouched', () => {
    const difference = firstDifference(
      fingerprintProjection(projection(0, 'a', [1, 2, 3])),
      fingerprintProjection(projection(0, 'a', [1, 2, 4])),
    )
    expect(difference).toBe('"a" sits at [1,2,3] in app but [1,2,4] standalone')
  })

  it('catches a material change that leaves geometry and placement identical', () => {
    const difference = firstDifference(
      fingerprintProjection(projection(0, 'a', [0, 0, 0], 'rock')),
      fingerprintProjection(projection(0, 'a', [0, 0, 0], 'snow')),
    )
    expect(difference).toBe('material 0 is "rock=1|1|1|1|1|0||" in app but "snow=1|1|1|1|1|0||" standalone')
  })
})


/**
 * A quad standing on the ground at (630, 1020), 8 m tall — the shape
 * `placeOnGround({ geometry: box(...), x, y })` bakes out, hung under a
 * mesh-less group node the way `addChild` assembles a village.
 */
const PLACED_QUAD = [628, 1018, 50, 632, 1018, 50, 632, 1022, 58, 628, 1022, 58]

function placedTree(positions: readonly number[] = PLACED_QUAD): BridgeSceneTree {
  return {
    focus: 'root',
    graph: {
      root: { id: 'root', name: 'village', children: { hall: 'hall' } },
      hall: {
        id: 'hall',
        name: 'hall',
        parent: 'root',
        content: { schema: 'mesh', mesh: { positions, indices: [0, 1, 2, 0, 2, 3] } },
      },
    },
  }
}

describe('projectScene placement', () => {
  it('preserves local geometry and uses explicit Transform instead of inferring pivots', () => {
    const { entities } = projectScene(placedTree())
    expect(entities.map((entity) => entity.slug)).toEqual(['root', 'hall'])
    // A mesh-less group has nothing of its own to anchor: pure pass-through.
    expect(entities[0]!.translation).toEqual([0, 0, 0])
    // Footprint centre at the base — where placeOnGround put it.
    expect(entities[1]!.translation).toEqual([0, 0, 0])
  })

  it('reconstructs every authored world position from pos composed with the vertex', () => {
    const entity = projectScene(placedTree()).entities[1]!
    const { mesh, translation } = entity
    for (let v = 0; v < mesh!.vertexCount; v++) {
      for (let axis = 0; axis < 3; axis++) {
        expect(mesh!.vertices[v * PACK_FLOATS_PER_VERTEX + axis]! + translation[axis]!).toBeCloseTo(
          PLACED_QUAD[v * 3 + axis]!,
          3,
        )
      }
    }
  })

  it('keeps bounds in scene space so the emitted sun still sizes shadows off the map', () => {
    // Object-space buffers alone would report a ~9 m extent instead of the real
    // placement, silently shrinking shadowDistanceFor() to its 64 m floor.
    const { bounds } = projectScene(placedTree())
    expect(bounds.min).toEqual([628, 1018, 50])
    expect(bounds.max).toEqual([632, 1022, 58])
  })
})

describe('Y_UP_QUAT', () => {
  it('rotates scene (x, y, z) to engine (x, z, -y) instead of mirroring it', () => {
    // det = -1 would be a mirror: every triangle's winding flips and the whole
    // scene renders as its own inside surface under back-face culling.
    const [qx, qy, qz, qw] = Y_UP_QUAT
    const rotate = (v: readonly [number, number, number]): [number, number, number] => {
      const tx = 2 * (qy * v[2]! - qz * v[1]!)
      const ty = 2 * (qz * v[0]! - qx * v[2]!)
      const tz = 2 * (qx * v[1]! - qy * v[0]!)
      return [
        v[0]! + qw * tx + (qy * tz - qz * ty),
        v[1]! + qw * ty + (qz * tx - qx * tz),
        v[2]! + qw * tz + (qx * ty - qy * tx),
      ]
    }
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [630, 1020, 50]] as const) {
      const rotated = rotate(v)
      const expected = [v[0], v[2], -v[1]]
      for (let axis = 0; axis < 3; axis++) expect(rotated[axis]!).toBeCloseTo(expected[axis]!, 6)
    }
  })
})

/**
 * Two triangles of a quad, far apart in z so a rule can tell them apart.
 * Triangle 0 sits at z=0, triangle 1 at z=10.
 */
const TWO_TRIANGLE_MESH = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 10, 1, 0, 10, 1, 1, 10],
  indices: [0, 1, 2, 3, 4, 5],
}

const ROCK = { baseColor: [0.4, 0.4, 0.4, 1] as const, roughness: 0.9 }
const SNOW = { baseColor: [0.9, 0.95, 1, 1] as const, roughness: 0.3 }

describe('paintSurfaceMesh', () => {
  it('splits a mesh into one contiguous run per distinct appearance', () => {
    const rule = defineMaterial({
      name: 'alpine',
      surface: (sample) => (sample.z > 5 ? SNOW : ROCK),
    })
    const { mesh, warnings } = paintSurfaceMesh(TWO_TRIANGLE_MESH, rule)
    expect(warnings).toEqual([])
    expect(mesh.material?.id).toBe('alpine')
    expect(mesh.material?.palette).toHaveLength(2)
    // Runs must tile the index buffer exactly and in order — the exporter throws
    // otherwise, and a gap would silently drop triangles from the draw.
    const runs = mesh.material!.runs!
    expect(runs.map((run) => [run.indexOffset, run.indexCount])).toEqual([[0, 3], [3, 3]])
    expect(runs.reduce((sum, run) => sum + run.indexCount, 0)).toBe(mesh.indices.length)
  })

  it('reorders whole triangles only, so every authored triangle survives', () => {
    // Rule returns snow for the FIRST triangle, forcing a reorder rather than a
    // no-op pass-through.
    const rule = defineMaterial({ name: 'flip', surface: (s) => (s.z < 5 ? SNOW : ROCK) })
    const { mesh } = paintSurfaceMesh(TWO_TRIANGLE_MESH, rule)
    const triples = (indices: readonly number[]): string[] => {
      const out: string[] = []
      for (let i = 0; i < indices.length; i += 3) out.push([...indices.slice(i, i + 3)].sort().join(','))
      return out.sort()
    }
    expect(triples(mesh.indices)).toEqual(triples(TWO_TRIANGLE_MESH.indices))
  })

  it('dedupes by value, so one appearance over the whole mesh is one palette entry', () => {
    const rule = defineMaterial({ name: 'uniform', surface: () => ({ ...ROCK }) })
    const { mesh } = paintSurfaceMesh(TWO_TRIANGLE_MESH, rule)
    expect(mesh.material?.palette).toHaveLength(1)
    expect(mesh.material?.runs).toEqual([{ surface: 0, indexOffset: 0, indexCount: 6 }])
  })

  it('warns instead of silently exporting a draw call per triangle', () => {
    // A rule keyed on a continuous value is the realistic way to blow this up.
    const positions: number[] = []
    const indices: number[] = []
    for (let t = 0; t <= SURFACE_VARIANT_BUDGET; t++) {
      const base = t * 3
      positions.push(0, 0, t, 1, 0, t, 1, 1, t)
      indices.push(base, base + 1, base + 2)
    }
    const rule = defineMaterial({
      name: 'gradient',
      surface: (s) => ({ baseColor: [s.z / 100, 0.5, 0.5, 1] }),
    })
    const { mesh, warnings } = paintSurfaceMesh({ positions, indices }, rule)
    expect(mesh.material?.palette).toHaveLength(SURFACE_VARIANT_BUDGET + 1)
    expect(warnings.map((warning) => warning.code)).toEqual(['SCENE_MATERIAL_VARIANTS'])
  })

  it('fails loudly on a rule that returns no baseColor rather than defaulting', () => {
    const rule = defineMaterial({ name: 'broken', surface: () => ({}) as never })
    expect(() => paintSurfaceMesh(TWO_TRIANGLE_MESH, rule)).toThrow(/no baseColor/)
  })
})

function paintedTree(): BridgeSceneTree {
  // Two nodes painting with the SAME rule and landing the same appearance.
  const rule = defineMaterial({ name: 'brick', surface: () => ({ ...ROCK }) })
  const houseA = paintSurfaceMesh({ positions: [0, 0, 0, 4, 0, 0, 4, 4, 0], indices: [0, 1, 2] }, rule).mesh
  const houseB = paintSurfaceMesh({ positions: [40, 0, 0, 44, 0, 0, 44, 4, 0], indices: [0, 1, 2] }, rule).mesh
  return {
    focus: 'root',
    graph: {
      root: { id: 'root', name: 'village', children: { a: 'a', b: 'b' } },
      a: { id: 'a', name: 'house-a', parent: 'root', order: 0, content: { schema: 'mesh', mesh: houseA } },
      b: { id: 'b', name: 'house-b', parent: 'root', order: 1, content: { schema: 'mesh', mesh: houseB } },
    },
  }
}

describe('projectScene materials', () => {
  it('does not export palette entries unreferenced by triangle runs', () => {
    const original = placedTree();
    const hall=original.graph.hall!;
    const tree:BridgeSceneTree={...original,graph:{...original.graph,hall:{...hall,content:{schema:'mesh',mesh:{...hall.content!.mesh!,material:{ id:'surfaces', palette:[
      {baseColor:[1,0,0,1]}, {baseColor:[0,1,0,1]}, {baseColor:[0,0,1,1]},
    ],runs:[{surface:2,indexOffset:0,indexCount:6}]}}}}}};
    const projected=projectScene(tree);
    expect(projected.materials.map(material=>material.key)).toEqual(['surfaces.2']);
    expect(projected.entities[1]!.mesh!.runs).toEqual([{material:0,indexOffset:0,indexCount:6}]);
  })
  it('dedupes one shared material into a single scene-global asset', () => {
    const { materials, entities } = projectScene(paintedTree())
    expect(materials.map((material) => material.key)).toEqual(['brick.0'])
    // Both meshes point their single run at the same table entry.
    expect(entities[1]!.mesh!.runs).toEqual([{ material: 0, indexOffset: 0, indexCount: 3 }])
    expect(entities[2]!.mesh!.runs).toEqual([{ material: 0, indexOffset: 0, indexCount: 3 }])
  })

  it('keeps an unpainted mesh on its entity-slug material key', () => {
    // This is the pre-materials shape; moving the key would move the GUID and
    // orphan every already-cooked asset.
    const { materials, entities } = projectScene(placedTree())
    expect(materials.map((material) => material.key)).toEqual(['hall'])
    expect(entities[1]!.mesh!.runs).toEqual([{ material: 0, indexOffset: 0, indexCount: 6 }])
  })
})
