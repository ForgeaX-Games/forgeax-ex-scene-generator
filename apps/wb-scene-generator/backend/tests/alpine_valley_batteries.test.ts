import { describe, it, expect } from 'vitest'
import { valleyHeightfield } from '../../batteries/scene/bridge/valley_heightfield/index.js'
import { stoneArchBridge } from '../../batteries/scene/bridge/stone_arch_bridge/index.js'
import { landmarkWatchtower } from '../../batteries/scene/bridge/landmark_watchtower/index.js'
import { watermillBuilding } from '../../batteries/scene/bridge/watermill_building/index.js'
import { villagePlaza } from '../../batteries/scene/bridge/village_plaza/index.js'
import { terraceWalls } from '../../batteries/scene/bridge/terrace_walls/index.js'
import { pineForestScatter } from '../../batteries/scene/bridge/pine_forest_scatter/index.js'
import { multiTierHouses } from '../../batteries/scene/bridge/multi_tier_houses/index.js'

describe('Alpine Valley Procedural Batteries', () => {
  it('generates 64x64 alpine valley terrain with riverbed and zoning masks', () => {
    const terrain = valleyHeightfield({
      width: 64,
      height: 64,
      valleyDepth: 18.0,
      valleyWidth: 18.0,
      riverDepth: 1.6,
      riverWidth: 6.5,
      ridgeNoise: 2.4,
      seed: 27,
      baseElevation: 2.0,
    })

    expect(terrain.heightGrid).toBeDefined()
    expect(terrain.valleyMask).toBeDefined()
    expect(terrain.riverMask).toBeDefined()
    expect(terrain.terraceMask).toBeDefined()
    expect(terrain.cliffMask).toBeDefined()
    expect(terrain.forestMask).toBeDefined()

    const grid = terrain.heightGrid as number[][]
    expect(grid.length).toBe(64)
    expect(grid[0]!.length).toBe(64)
    expect((terrain.maxElevation as number)).toBeGreaterThan(terrain.minElevation as number)
  })

  it('generates stone arch bridge mesh spanning riverbanks', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const bridge = stoneArchBridge({
      start: [28, 26],
      end: [28, 36],
      heightGrid: terrain.heightGrid,
      width: 4.0,
      archHeight: 2.0,
    })

    expect(bridge.mesh).toBeDefined()
    expect(bridge.triangleCount).toBeGreaterThan(20)
    expect(bridge.mesh!.role).toBe('road')
  })

  it('generates village landmark watchtower mesh', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const tower = landmarkWatchtower({
      position: [24, 30],
      heightGrid: terrain.heightGrid,
      baseSize: 4.6,
      height: 15.0,
      yaw: 0.2,
    })

    expect(tower.mesh).toBeDefined()
    expect(tower.triangleCount).toBeGreaterThan(10)
    expect(tower.mesh!.role).toBe('houses')
  })

  it('generates riverfront watermill building with waterwheel', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const mill = watermillBuilding({
      position: [34, 27],
      heightGrid: terrain.heightGrid,
      yaw: 1.57,
    })

    expect(mill.mesh).toBeDefined()
    expect(mill.triangleCount).toBeGreaterThan(30)
    expect(mill.mesh!.role).toBe('houses')
  })

  it('generates village plaza marketplace slab', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const plaza = villagePlaza({
      center: [22, 32],
      heightGrid: terrain.heightGrid,
      radius: 6.5,
    })

    expect(plaza.mesh).toBeDefined()
    expect(plaza.triangleCount).toBeGreaterThan(16)
    expect(plaza.mesh!.role).toBe('road')
  })

  it('generates terrace retaining walls along contour steps', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const walls = terraceWalls({
      heightGrid: terrain.heightGrid,
      terraceMask: terrain.terraceMask,
      wallThickness: 0.5,
      wallHeight: 1.5,
    })

    expect(walls.mesh).toBeDefined()
    expect(walls.triangleCount).toBeGreaterThan(10)
  })

  it('scatters pine trees across forest zone', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const forest = pineForestScatter({
      heightGrid: terrain.heightGrid,
      forestMask: terrain.forestMask,
      count: 28,
      seed: 42,
    })

    expect(forest.mesh).toBeDefined()
    expect(forest.points.length).toBeGreaterThanOrEqual(15)
    expect(forest.triangleCount).toBeGreaterThan(100)
  })

  it('generates multi-tier houses with varied architectural typologies', () => {
    const terrain = valleyHeightfield({ width: 64, height: 64, seed: 27 })
    const houses = multiTierHouses({
      points: [[18, 30], [22, 28], [26, 32], [30, 36], [38, 42]],
      heightGrid: terrain.heightGrid,
      yaw: [0, 0.4, -0.3, 0.8, 1.2],
      types: ['townhouse', 'cottage', 'townhouse', 'barn', 'cabin'],
    })

    expect(houses.mesh).toBeDefined()
    expect(houses.count).toBe(5)
    expect(houses.mesh!.role).toBe('houses')
  })
})
