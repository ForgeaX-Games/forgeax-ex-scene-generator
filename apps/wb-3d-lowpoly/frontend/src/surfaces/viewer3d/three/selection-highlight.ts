// 💡 Best-effort editor-selection → URDF link highlight.
//
//    The workbench host forwards the kernel editor's node selection over the
//    `workbench:editor-selection` postMessage channel. The surface maps each
//    selected node's `id` param to a candidate URDF `<link name>` and asks this
//    module to emissive-tint the meshes that belong to those links.
//
//    DESIGN: this module is intentionally isolated and totally defensive — any
//    mapping miss, missing material, or unexpected scene shape is a silent
//    no-op. A selection highlight can NEVER throw into the render path. Each
//    mesh's owning link is resolved by walking up to the nearest ancestor that
//    carries `userData.urdfLinkName` (set on link groups + primitive meshes by
//    `scene-graph-builder.ts`), so async-loaded mesh children resolve too.
import * as THREE from 'three'

const LINK_USER_DATA_KEY = 'urdfLinkName'
/** Per-material slot stashing the pre-highlight emissive so we can restore it. */
const PREV_KEY = '__urdfHighlightPrev'
/** Cool blue tint applied to highlighted link meshes. */
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x2f6dff)
const HIGHLIGHT_INTENSITY = 0.55

interface EmissiveMaterial extends THREE.Material {
  emissive?: THREE.Color
  emissiveIntensity?: number
}

interface PrevEmissive {
  emissive: THREE.Color
  intensity: number
}

function hasEmissive(mat: THREE.Material): mat is EmissiveMaterial {
  return (mat as EmissiveMaterial).emissive instanceof THREE.Color
}

/** Walk up the parent chain to the nearest object tagged with a link name. */
function ownerLinkName(object: THREE.Object3D): string | undefined {
  let cur: THREE.Object3D | null = object
  while (cur) {
    const name = cur.userData?.[LINK_USER_DATA_KEY]
    if (typeof name === 'string' && name) return name
    cur = cur.parent
  }
  return undefined
}

function setMaterialHighlight(mat: THREE.Material | null | undefined, on: boolean): void {
  if (!mat || !hasEmissive(mat)) return
  const emissive = mat.emissive
  if (!emissive) return
  const store = mat.userData as Record<string, unknown>
  if (on) {
    if (!store[PREV_KEY]) {
      store[PREV_KEY] = {
        emissive: emissive.clone(),
        intensity: mat.emissiveIntensity ?? 1,
      } satisfies PrevEmissive
    }
    emissive.copy(HIGHLIGHT_EMISSIVE)
    mat.emissiveIntensity = HIGHLIGHT_INTENSITY
    mat.needsUpdate = true
  } else {
    const prev = store[PREV_KEY] as PrevEmissive | undefined
    if (prev) {
      emissive.copy(prev.emissive)
      mat.emissiveIntensity = prev.intensity
      mat.needsUpdate = true
      delete store[PREV_KEY]
    }
  }
}

function setMeshHighlight(mesh: THREE.Mesh, on: boolean): void {
  const mat = mesh.material
  if (Array.isArray(mat)) mat.forEach((m) => setMaterialHighlight(m, on))
  else setMaterialHighlight(mat, on)
}

/**
 * Apply an emissive tint to every mesh whose owning link is in `linkNames`,
 * and clear the tint on every other mesh. Pass an empty set to clear all.
 * Fully defensive: a null root or any error is a quiet no-op.
 */
export function applyLinkHighlight(
  root: THREE.Object3D | null | undefined,
  linkNames: ReadonlySet<string>,
): void {
  if (!root) return
  try {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const owner = ownerLinkName(object)
      const shouldHighlight = owner != null && linkNames.has(owner)
      setMeshHighlight(object, shouldHighlight)
    })
  } catch (err) {
    // Best-effort only — never let a highlight pass break rendering.
    console.warn('[viewer/selection-highlight] apply failed', err)
  }
}
