// Display Index: schema-tagged drawables for the Default preview.
//
// Specialized modes (top / billboard / iso / free3d / 3DMesh) may keep reading
// voxelLayers / gridLayers directly. Default must not treat
// `projectSceneToVoxelLayers` as the only path — Voxel and Grid stay separate
// schemas even when both come from today's store buckets.
//
// S1 stub: adapt existing renderer store keys. Later stages add mesh / curves
// ports without folding them into voxel layers first.

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBakedLayerKeys, useGridLayerKeys, useGuideLayerKeys, useVoxelLayerKeys } from './useLayer'
import { useRenderStore } from '../store'
import { meshRoleToSchema, type DisplaySchema, type GridLayer, type GuideLayer, type MeshLayer, type RendererVoxelLayer } from '../types'
import { stagePathForSchema } from './stagePaths'
import { stageRootOf } from './sceneWorldXform.js'
import { childrenOf, pathOf, type NodeId, type SceneGraph } from '../../../../vendor/shared/types/scene/graph.js'
import { contentSchema } from '../../../../vendor/shared/types/scene/content.js'
import type { ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'

export type { DisplaySchema }

export type DisplaySource = 'output' | 'baked' | 'grid' | 'mesh' | 'guide'

export interface DisplayDrawable {
  id: string
  schema: DisplaySchema
  source: DisplaySource
  layerKey: string
  path: string
  label: string
  sceneNodeId?: string
  graphIndex?: number
  nodeId?: string
}

export interface DisplayIndex {
  drawables: DisplayDrawable[]
}

function meshFromContent(content: unknown): { role?: 'terrain' | 'road' | 'houses' } | undefined {
  if (!content || typeof content !== 'object' || !('mesh' in content)) return undefined
  const mesh = (content as { mesh?: { role?: 'terrain' | 'road' | 'houses' } }).mesh
  return mesh
}

function isGroundMeshLayer(layer: MeshLayer): boolean {
  if (layer.mesh.role === 'terrain') return true
  if (layer.mesh.role) return false
  return layer.nodeName === 'Terrain' || /terrain/i.test(layer.portName)
}

function pickGroundMeshLayer(meshLayers: Record<string, MeshLayer>): MeshLayer | undefined {
  const layers = Object.values(meshLayers)
  const named = layers.find((layer) => isGroundMeshLayer(layer))
  if (named) return named
  // Heightfield ports are unnamed and unroled. Prototype boxes are too —
  // pick the largest leftover so Terrain does not bind a 12-triangle house.
  const unroled = layers.filter((layer) => !layer.mesh.role)
  if (unroled.length === 0) return undefined
  return unroled.reduce((best, layer) => (layer.triangleCount > best.triangleCount ? layer : best))
}

function findMeshLayer(
  path: string,
  nodeName: string,
  content: unknown,
  meshesByPort: Map<string, MeshLayer>,
  meshesByName: Map<string, MeshLayer>,
  meshLayers: Record<string, MeshLayer>,
): MeshLayer | undefined {
  const byPath = meshesByPort.get(`mesh:${path}`) ?? meshesByPort.get(`ref:${path}`)
  if (byPath) return byPath
  const byName = meshesByName.get(nodeName)
  if (byName) return byName
  const role = meshFromContent(content)?.role
  if (role) {
    const byRole = Object.values(meshLayers).find((layer) => layer.mesh.role === role)
    if (byRole) return byRole
  }
  // Heightfield mesh_to_node layers are keyed by the battery node id (listNodes
  // name is often null) and frequently have no role, while the scene prim is
  // named Terrain. Only that prim may claim leftover ground geometry — a bare
  // `!role` fallback used to bind Road/Houses to the same terrain layer, so
  // Default drew ground three times and dropped the real road/house meshes.
  if (role === 'terrain' || nodeName === 'Terrain') {
    return pickGroundMeshLayer(meshLayers)
  }
  return undefined
}

function uniqueNamedGuide(
  byName: Map<string, GuideLayer>,
  layers: Record<string, GuideLayer>,
  nodeName: string,
): GuideLayer | undefined {
  let count = 0
  let last: GuideLayer | undefined
  for (const layer of Object.values(layers)) {
    if (layer.nodeName !== nodeName) continue
    count += 1
    last = layer
  }
  if (count === 1) return last
  return count === 0 ? byName.get(nodeName) : undefined
}

/** Mesh/guide ports that the scene-graph walk did not bind still need to draw. */
export function mergeUnclaimedStoreLayers(
  graphDrawables: DisplayDrawable[],
  meshLayers: Record<string, MeshLayer>,
  guideLayers: Record<string, GuideLayer> = {},
): DisplayDrawable[] {
  const boundKeys = new Set(
    graphDrawables
      .filter((d) => meshLayers[d.layerKey] || guideLayers[d.layerKey])
      .map((d) => d.layerKey),
  )
  const boundSchemas = new Set(
    graphDrawables.filter((d) => boundKeys.has(d.layerKey)).map((d) => d.schema),
  )
  const out = [...graphDrawables]
  const boundLayers = Object.values(meshLayers).filter((layer) => boundKeys.has(layer.key))
  for (const layer of Object.values(meshLayers)) {
    if (!layer.visible) continue
    if (boundKeys.has(layer.key)) continue
    const schema = meshRoleToSchema(layer.mesh.role)
    // A composed city has dozens of unroled house meshes (schema `mesh`).
    // Skipping every leftover `mesh` port then drops the heightfield.
    const boundHasGround = boundLayers.some((bound) => isGroundMeshLayer(bound) || bound.triangleCount >= 256)
    if (schema === 'mesh' && isGroundMeshLayer(layer) && boundHasGround) continue
    if (schema === 'mesh' && boundHasGround && !layer.mesh.role && layer.triangleCount >= 256) continue
    // mesh_to_node copies producer geometry onto the scene prim. Hydration then
    // binds that copy by name; skip the original port when triangle counts match.
    const duplicateOfBound = boundLayers.some((bound) =>
      bound.mesh.role === layer.mesh.role
      && bound.triangleCount === layer.triangleCount
      && (bound.mesh.role != null || schema === 'mesh'),
    )
    if (duplicateOfBound) continue
    out.push({
      id: layer.key,
      schema,
      source: 'mesh',
      layerKey: layer.key,
      path: stagePathForSchema(schema, layer.nodeName),
      label: layer.nodeName,
      nodeId: layer.nodeId,
    })
    boundKeys.add(layer.key)
    boundSchemas.add(schema)
  }
  const boundGuideKeys = new Set(
    out.filter((d) => d.schema === 'guide').map((d) => d.layerKey),
  )
  for (const layer of Object.values(guideLayers)) {
    if (!layer.visible) continue
    if (boundKeys.has(layer.key) || boundGuideKeys.has(layer.key)) continue
    // points_to_node also hydrates a bare `points` port; the composed scene
    // already owns the same prim under points:/path. Skip the raw duplicate,
    // but keep other same-named guides that have their own path keys.
    if (layer.portName === 'points' && out.some((d) => d.schema === 'guide' && d.label === layer.nodeName)) continue
    out.push({
      id: layer.key,
      schema: 'guide',
      source: 'guide',
      layerKey: layer.key,
      path: stagePathForSchema('guide', layer.nodeName),
      label: layer.nodeName,
      nodeId: layer.nodeId,
    })
    boundKeys.add(layer.key)
  }
  return out
}

export function projectSceneGraphToDisplayIndex(
  graph: SceneGraph,
  focus: NodeId,
  storeState?: {
    layers?: Record<string, RendererVoxelLayer>
    meshLayers?: Record<string, MeshLayer>
    guideLayers?: Record<string, GuideLayer>
  },
  graphIndex = 0,
): DisplayDrawable[] {
  const drawables: DisplayDrawable[] = []
  const focusNode = graph.get(focus)
  if (!focusNode) return drawables

  const layersByPath = new Map<string, RendererVoxelLayer>()
  for (const l of Object.values(storeState?.layers ?? {})) {
    if (l.nodePath) layersByPath.set(l.nodePath, l)
    if (l.nodeName) layersByPath.set(l.nodeName, l)
  }

  const meshesByName = new Map<string, MeshLayer>()
  const meshesByPort = new Map<string, MeshLayer>()
  for (const m of Object.values(storeState?.meshLayers ?? {})) {
    meshesByName.set(m.nodeName, m)
    meshesByPort.set(m.portName, m)
  }

  const guidesByPort = new Map<string, GuideLayer>()
  const guidesByName = new Map<string, GuideLayer>()
  for (const g of Object.values(storeState?.guideLayers ?? {})) {
    guidesByPort.set(g.portName, g)
    if (!guidesByName.has(g.nodeName)) guidesByName.set(g.nodeName, g)
  }

  function walk(id: NodeId): void {
    const node = graph.get(id)
    if (!node) return
    if (node.name === 'Prototypes') return
    if (typeof node.attributes?.prototypeKey === 'string') return
    const p = pathOf(graph, id) ?? `/${node.name}`
    const schemaType = node.schema || contentSchema(node.content)

    if (schemaType === 'mesh' || schemaType === 'ref') {
      const meshLayer = findMeshLayer(
        p,
        node.name,
        node.content,
        meshesByPort,
        meshesByName,
        storeState?.meshLayers ?? {},
      )
      const role = meshFromContent(node.content)?.role ?? meshLayer?.mesh.role
      const displaySchema = schemaType === 'ref' ? 'ref' : meshRoleToSchema(role)
      const layerKey = meshLayer?.key ?? `mesh:${p}`
      drawables.push({
        id: `${schemaType}:${p}`,
        schema: displaySchema,
        source: 'mesh',
        layerKey,
        path: p,
        label: node.name,
        sceneNodeId: id,
        graphIndex,
        nodeId: meshLayer?.nodeId,
      })
    } else if (schemaType === 'points') {
      const guideLayer = guidesByPort.get(`points:${p}`)
        ?? guidesByPort.get(p)
        ?? uniqueNamedGuide(guidesByName, storeState?.guideLayers ?? {}, node.name)
      const layerKey = guideLayer?.key ?? `guide:${p}`
      drawables.push({
        id: `guide:${p}`,
        schema: 'guide',
        source: 'guide',
        layerKey,
        path: p,
        label: node.name,
        sceneNodeId: id,
        graphIndex,
        nodeId: guideLayer?.nodeId,
      })
    } else if (schemaType === 'voxel') {
      const voxelLayer = layersByPath.get(p) ?? layersByPath.get(node.name)
      const layerKey = voxelLayer?.key ?? `voxel:${p}`
      drawables.push({
        id: `voxel:${p}`,
        schema: 'voxel',
        source: 'output',
        layerKey,
        path: p,
        label: node.name,
        sceneNodeId: id,
        graphIndex,
        nodeId: voxelLayer?.nodeId,
      })
    } else if (node.name && schemaType !== 'unknown') {
      drawables.push({
        id: `${schemaType}:${p}`,
        schema: schemaType as DisplaySchema,
        source: 'output',
        layerKey: `${schemaType}:${p}`,
        path: p,
        label: node.name,
        sceneNodeId: id,
        graphIndex,
      })
    }

    for (const child of childrenOf(graph, id)) {
      walk(child.id)
    }
  }

  walk(focus)
  return drawables
}

export function projectKeysToDisplayIndex(input: {
  voxelKeys: readonly string[]
  bakedKeys: readonly string[]
  gridKeys: readonly string[]
  meshKeys?: readonly string[]
  meshItems?: ReadonlyArray<{ key: string; schema?: DisplaySchema; nodeId?: string; label?: string }>
  guideKeys?: readonly string[]
  guideItems?: ReadonlyArray<{ key: string; nodeId?: string; label?: string }>
}): DisplayIndex {
  const drawables: DisplayDrawable[] = []
  for (const layerKey of input.voxelKeys) {
    drawables.push({
      id: layerKey,
      schema: 'voxel',
      source: 'output',
      layerKey,
      path: layerKey.includes('/') ? layerKey.slice(layerKey.indexOf('/')) : `/${layerKey}`,
      label: layerKey,
    })
  }
  for (const layerKey of input.bakedKeys) {
    drawables.push({
      id: layerKey,
      schema: 'voxel',
      source: 'baked',
      layerKey,
      path: layerKey.includes('/') ? layerKey.slice(layerKey.indexOf('/')) : `/${layerKey}`,
      label: layerKey,
    })
  }
  for (const layerKey of input.gridKeys) {
    drawables.push({
      id: layerKey,
      schema: 'grid',
      source: 'grid',
      layerKey,
      path: stagePathForSchema('grid', layerKey),
      label: layerKey,
    })
  }
  const meshItems: ReadonlyArray<{ key: string; schema?: DisplaySchema; nodeId?: string; label?: string }> =
    input.meshItems ?? (input.meshKeys ?? []).map((key) => ({ key, schema: 'mesh' as const }))
  for (const item of meshItems) {
    const schema = item.schema ?? 'mesh'
    const label = item.label ?? item.key
    drawables.push({
      id: item.key,
      schema,
      source: 'mesh',
      layerKey: item.key,
      path: stagePathForSchema(schema, label),
      label,
      nodeId: item.nodeId,
    })
  }
  const guideItems: ReadonlyArray<{ key: string; nodeId?: string; label?: string }> =
    input.guideItems ?? (input.guideKeys ?? []).map((key) => ({ key }))
  for (const item of guideItems) {
    const label = item.label ?? item.key
    drawables.push({
      id: item.key,
      schema: 'guide',
      source: 'guide',
      layerKey: item.key,
      path: stagePathForSchema('guide', label),
      label,
      nodeId: item.nodeId,
    })
  }
  return { drawables }
}

export function drawablesForSchema(index: DisplayIndex, schema: DisplaySchema): DisplayDrawable[] {
  return index.drawables.filter((drawable) => drawable.schema === schema)
}

export interface SceneNodePointer {
  id: string
  path?: string
  graphIndex?: number
}

/** Resolve bounded lineage references; path/index keep duplicate graph ids unambiguous. */
export function layerKeysForSceneNodePointers(
  index: DisplayIndex,
  pointers: readonly SceneNodePointer[],
): string[] {
  const keys = new Set<string>()
  for (const pointer of pointers) {
    const exact = index.drawables.filter((drawable) =>
      drawable.sceneNodeId === pointer.id
      && (pointer.graphIndex === undefined || drawable.graphIndex === pointer.graphIndex)
      && (pointer.path === undefined || drawable.path === pointer.path))
    const matches = exact.length > 0
      ? exact
      : index.drawables.filter((drawable) =>
          pointer.path !== undefined
          && drawable.path === pointer.path
          && (pointer.graphIndex === undefined || drawable.graphIndex === pointer.graphIndex))
    for (const drawable of matches) keys.add(drawable.layerKey)
  }
  return [...keys]
}

/** Keys + schema only. Per-layer cell payloads stay on the per-layer hooks. */
export function useDisplayIndex(): DisplayIndex {
  const scenePorts = useRenderStore((s) => s.scenePorts)
  const storeLayers = useRenderStore((s) => s.layers)
  const storeMeshLayers = useRenderStore((s) => s.meshLayers)
  const storeGuideLayers = useRenderStore((s) => s.guideLayers)

  const voxelKeys = useVoxelLayerKeys()
  const bakedKeys = useBakedLayerKeys()
  const gridKeys = useGridLayerKeys()
  const meshItems = useRenderStore(useShallow((s) =>
    Object.values(s.meshLayers).map((layer) => ({
      key: layer.key,
      schema: meshRoleToSchema(layer.mesh.role),
      nodeId: layer.nodeId,
      label: layer.nodeName,
    })),
  ))
  const guideItems = useRenderStore(useShallow((s) =>
    Object.values(s.guideLayers).map((layer) => ({
      key: layer.key,
      nodeId: layer.nodeId,
      label: layer.nodeName,
    })),
  ))
  const guideKeys = useGuideLayerKeys()

  return useMemo(() => {
    const activeScenePort = Object.values(scenePorts)[0]
    if (activeScenePort && activeScenePort.graph) {
      const graphDrawables = mergeUnclaimedStoreLayers(
        projectSceneGraphToDisplayIndex(
          activeScenePort.graph,
          stageRootOf(activeScenePort.graph, activeScenePort.focus),
          { layers: storeLayers, meshLayers: storeMeshLayers, guideLayers: storeGuideLayers },
        ),
        storeMeshLayers,
        storeGuideLayers,
      )
      // Append baked layers
      for (const layerKey of bakedKeys) {
        graphDrawables.push({
          id: layerKey,
          schema: 'voxel',
          source: 'baked',
          layerKey,
          path: layerKey.includes('/') ? layerKey.slice(layerKey.indexOf('/')) : `/${layerKey}`,
          label: layerKey,
        })
      }
      // Intermediate height/density grids are 1 m/cell heatmaps. Hide them once
      // the composed scene already has terrain / houses, or they stack at origin.
      const hasComposedMesh = graphDrawables.some((d) =>
        d.source === 'mesh' || d.schema === 'mesh' || d.schema === 'houses' || d.schema === 'ref',
      )
      if (!hasComposedMesh) {
        for (const layerKey of gridKeys) {
          graphDrawables.push({
            id: layerKey,
            schema: 'grid',
            source: 'grid',
            layerKey,
            path: stagePathForSchema('grid', layerKey),
            label: layerKey,
          })
        }
      }
      return { drawables: graphDrawables }
    }
    return projectKeysToDisplayIndex({ voxelKeys, bakedKeys, gridKeys, meshItems, guideItems, guideKeys })
  }, [scenePorts, storeLayers, storeMeshLayers, storeGuideLayers, voxelKeys, bakedKeys, gridKeys, meshItems, guideItems, guideKeys])
}
