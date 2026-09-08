// 💡 URDF → THREE.Group 场景图构建：parent link → joint frame → motion group → child link
import * as THREE from 'three'
import type { UrdfSpec, UrdfLink } from './urdf-parser'
import { describeLinkVisuals, findRootLink, originToMatrix4 } from './urdf-parser'
import { depthBiasForOrdinal, resolveVisualMaterialSpec } from './materials'
import { buildPrimitiveMesh } from './geometry-loader'

export interface SceneGraphOptions {
  showVisuals?: boolean
  showCollisions?: boolean
  opacity?: number
}

export interface RobotSceneGraph {
  root: THREE.Group
  jointNodes: Map<string, THREE.Object3D>
  jointFrames: Map<string, THREE.Group>
  linkNodes: Map<string, THREE.Group>
  /** mesh-type visuals are not built synchronously; we expose them so the caller can load async */
  pendingMeshVisuals: Array<{
    link: string
    visualIndex: number
    parent: THREE.Group
    geometryFilename: string
  }>
}

const VISUAL_USER_DATA_KEY = 'urdfVisual'
const COLLISION_USER_DATA_KEY = 'urdfCollision'
/** Link-name tag shared with meshes (`userData.urdfLinkName`) and the highlighter. */
const LINK_USER_DATA_KEY = 'urdfLinkName'
const COLLISION_DEBUG_PALETTE = [
  '#ff5a36', '#00b3ff', '#ffd400', '#16c47f', '#ff2f92',
  '#7c5cff', '#ff8a00', '#00c2a8', '#ff6b6b', '#5dd62c',
] as const

export function collisionColorForIndex(index: number): THREE.Color {
  return new THREE.Color(COLLISION_DEBUG_PALETTE[index % COLLISION_DEBUG_PALETTE.length])
}

function createCollisionMaterial(color: THREE.Color, depthBias: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: depthBias,
  })
}

function createCollisionEdges(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.LineSegments {
  const edgeGeometry = new THREE.EdgesGeometry(geometry, 20)
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: color.clone().offsetHSL(0, 0, -0.32),
    transparent: true,
    opacity: 1,
  })
  return new THREE.LineSegments(edgeGeometry, edgeMaterial)
}

export function buildRobotSceneGraph(
  urdfSpec: UrdfSpec,
  options: SceneGraphOptions = {},
): RobotSceneGraph {
  const { showVisuals = true, showCollisions = false, opacity } = options

  const linkNodes = new Map<string, THREE.Group>()
  const jointNodes = new Map<string, THREE.Object3D>()
  const jointFrames = new Map<string, THREE.Group>()
  const pendingMeshVisuals: RobotSceneGraph['pendingMeshVisuals'] = []

  const linkByName = new Map<string, UrdfLink>()
  for (const link of urdfSpec.links) linkByName.set(link.name, link)

  let collisionIndex = 0
  let visualIndex = 0
  for (const link of urdfSpec.links) {
    const linkGroup = new THREE.Group()
    linkGroup.name = `link:${link.name}`
    // Tag the link group with its URDF link name so consumers (e.g. the
    // editor-selection highlighter) can resolve the owning link of ANY
    // descendant mesh — including async-loaded mesh visuals whose meshes are
    // added under this group and never carry `urdfLinkName` themselves.
    linkGroup.userData[LINK_USER_DATA_KEY] = link.name
    const visualDescriptors = describeLinkVisuals(link)

    if (showVisuals) {
      for (const [iWithinLink, visual] of link.visuals.entries()) {
        const matSpec = resolveVisualMaterialSpec(visual)
        if (opacity !== undefined) matSpec.opacity = opacity

        const descriptor = visualDescriptors[iWithinLink]
        const mesh = buildPrimitiveMesh(visual.geometry, matSpec, {
          depthBias: depthBiasForOrdinal(visualIndex),
        })
        visualIndex += 1

        if (mesh) {
          if (visual.origin) mesh.applyMatrix4(originToMatrix4(visual.origin))
          mesh.userData[VISUAL_USER_DATA_KEY] = true
          mesh.userData[LINK_USER_DATA_KEY] = link.name
          mesh.userData.urdfVisualKey = descriptor.key
          mesh.userData.urdfVisualLabel = descriptor.label
          mesh.name = visual.name ?? `visual:${link.name}`
          linkGroup.add(mesh)
        } else if (visual.geometry.type === 'mesh' && visual.geometry.filename) {
          pendingMeshVisuals.push({
            link: link.name,
            visualIndex: iWithinLink,
            parent: linkGroup,
            geometryFilename: visual.geometry.filename,
          })
        }
      }
    }

    if (showCollisions) {
      for (const collision of link.collisions) {
        const depthBias = depthBiasForOrdinal(collisionIndex)
        const debugColor = collisionColorForIndex(collisionIndex)
        collisionIndex += 1
        const mesh = buildPrimitiveMesh(collision.geometry, {
          name: 'collision_debug',
          color: debugColor,
          opacity: 0.88,
          metalness: 0,
          roughness: 1,
          transmission: 0,
          thickness: 0,
          ior: 1.45,
          clearcoat: 0,
          clearcoatRoughness: 0.2,
          envMapIntensity: 0.8,
        }, { depthBias })
        if (mesh) {
          if (collision.origin) mesh.applyMatrix4(originToMatrix4(collision.origin))
          const mat = createCollisionMaterial(debugColor, depthBias)
          mesh.material = mat
          mesh.visible = false
          mesh.userData[COLLISION_USER_DATA_KEY] = true
          mesh.renderOrder = 10
          mesh.add(createCollisionEdges(mesh.geometry, debugColor))
          mesh.name = collision.name ?? `collision:${link.name}`
          linkGroup.add(mesh)
        }
      }
    }

    linkNodes.set(link.name, linkGroup)
  }

  for (const joint of urdfSpec.joints) {
    const parentGroup = linkNodes.get(joint.parent)
    const childGroup = linkNodes.get(joint.child)
    if (!parentGroup || !childGroup) continue

    const jointFrame = new THREE.Group()
    jointFrame.name = `joint-frame:${joint.name}`
    if (joint.origin) jointFrame.applyMatrix4(originToMatrix4(joint.origin))

    const motionGroup = new THREE.Group()
    motionGroup.name = `joint-motion:${joint.name}`
    motionGroup.add(childGroup)
    jointFrame.add(motionGroup)
    parentGroup.add(jointFrame)

    jointFrames.set(joint.name, jointFrame)
    jointNodes.set(joint.name, motionGroup)
  }

  const rootLinkName = findRootLink(urdfSpec)
  const root = new THREE.Group()
  root.name = `robot:${urdfSpec.name}`
  if (rootLinkName) {
    const rootLinkGroup = linkNodes.get(rootLinkName)
    if (rootLinkGroup) root.add(rootLinkGroup)
  }

  return { root, jointNodes, jointFrames, linkNodes, pendingMeshVisuals }
}
