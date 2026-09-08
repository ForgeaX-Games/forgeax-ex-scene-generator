import { useEffect } from 'react'
import type { ApiClient } from '@forgeax/node-runtime-react'
import type { GraphNode } from '@forgeax/node-runtime'
import { flattenWire } from './flattenWire'
import { useViewerStore } from './store/viewerStore'
import type { AuthoredJointAnimationClip } from './three/urdf-joint-motion'
import { isRigSpec } from './three/rig-spec'
import { isSceneSpec } from './three/scene-spec'
import { pluginUrl } from '../../api/pluginHttp'

// Live-sync the embedded URDF viewer to the graph. Modeled on the scene
// generator's `useNodePreviews`: the kernel exec bus carries no payloads, so the
// URDF XML is PULLED via the ApiClient whenever a node executes or the graph
// mutates, then pushed into the vendored viewer store.
//
// Source-of-truth node: the `urdf_preview` battery's `urdf` output. FALLBACK: a
// bare `…→ g_to_urdf` graph (no preview node yet) still previews off the
// `g_to_urdf.urdf` output, so wiring the converter is enough to see the model.
//
// STALE: if no `urdf_preview` / `g_to_urdf` node remains (deleted / disconnected
// chain that yields no URDF), the source is cleared so the viewport empties —
// the faithful analog of the renderer's stale eviction.

const PREVIEW_OP = 'urdf_preview'
const FALLBACK_OP = 'g_to_urdf'
const URDF_PORT = 'urdf'
// Character path (RigSpec): the `rig_preview` battery passes through the
// `g_to_rig` RigSpec on its `rigSpec` port. Modeled exactly on the URDF pair
// (urdf_preview / g_to_urdf): prefer rig_preview nodes, else the g_to_rig
// converter. When a valid RigSpec is present, the viewer switches to character
// mode and this takes precedence over any URDF source.
const RIG_PREVIEW_OP = 'rig_preview'
const RIG_FALLBACK_OP = 'g_to_rig'
const RIG_PORT = 'rigSpec'
// Static path (SceneSpec): the `scene_preview` battery passes through the
// `g_to_scene` SceneSpec on its `sceneSpec` port. Same shape as the URDF /
// character pairs: prefer scene_preview nodes, else the g_to_scene converter.
// A valid SceneSpec switches the viewer to static mode. Precedence sits between
// character (highest) and URDF (lowest).
const SCENE_PREVIEW_OP = 'scene_preview'
const SCENE_FALLBACK_OP = 'g_to_scene'
const SCENE_PORT = 'sceneSpec'
// Authored joint animation: the g_bake_animation battery emits a parsed
// JointAnimationClip on its `animation` port. We pull it alongside the URDF so
// the GLB export can bake the authored motion instead of the procedural preview.
const ANIMATION_OP = 'g_bake_animation'
const ANIMATION_PORT = 'animation'

/** Duck-type guard: a wire value shaped like an AuthoredJointAnimationClip. */
function isAuthoredClip(value: unknown): value is AuthoredJointAnimationClip {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<AuthoredJointAnimationClip>
  if (typeof c.fps !== 'number' || typeof c.frameCount !== 'number') return false
  if (!c.channels || typeof c.channels !== 'object') return false
  return true
}

/**
 * Pick the best URDF source node: prefer `urdf_preview` nodes; if none exist,
 * fall back to `g_to_urdf`. Among the chosen bucket, prefer the most recently
 * `completed` one (last in list order — the kernel exposes no exec timestamp),
 * else the last node so a freshly-wired graph still previews.
 */
function pickSourceNode(nodes: readonly GraphNode[]): GraphNode | null {
  const previews = nodes.filter((n) => n.opId === PREVIEW_OP)
  const bucket = previews.length ? previews : nodes.filter((n) => n.opId === FALLBACK_OP)
  if (!bucket.length) return null
  const completed = bucket.filter((n) => n.status === 'completed')
  const pool = completed.length ? completed : bucket
  return pool[pool.length - 1] ?? null
}

/** Rig-path twin of pickSourceNode: prefer `rig_preview`, else `g_to_rig`. */
function pickRigNode(nodes: readonly GraphNode[]): GraphNode | null {
  const previews = nodes.filter((n) => n.opId === RIG_PREVIEW_OP)
  const bucket = previews.length ? previews : nodes.filter((n) => n.opId === RIG_FALLBACK_OP)
  if (!bucket.length) return null
  const completed = bucket.filter((n) => n.status === 'completed')
  const pool = completed.length ? completed : bucket
  return pool[pool.length - 1] ?? null
}

/** Static-path twin of pickSourceNode: prefer `scene_preview`, else `g_to_scene`. */
function pickSceneNode(nodes: readonly GraphNode[]): GraphNode | null {
  const previews = nodes.filter((n) => n.opId === SCENE_PREVIEW_OP)
  const bucket = previews.length ? previews : nodes.filter((n) => n.opId === SCENE_FALLBACK_OP)
  if (!bucket.length) return null
  const completed = bucket.filter((n) => n.status === 'completed')
  const pool = completed.length ? completed : bucket
  return pool[pool.length - 1] ?? null
}

// `projectKey` gates + re-keys the sync: the client is project-scoped, so a pull
// before the viewing project is bound throws "no viewing project". Passing the
// resolved project id (null until known) re-runs this effect once it lands and
// again on every project switch, so a freshly-bound viewer pulls immediately
// instead of waiting for the next exec/graph event.
export function useViewer3DLiveSync(client: ApiClient, projectKey?: string | null): void {
  useEffect(() => {
    let cancelled = false
    // Track the last source we pushed so we can skip redundant setSource calls
    // (which rebuild the viewer scene + drop selection/camera) when neither the
    // source node nor its URDF changed across a refresh.
    let lastNodeId: string | null = null
    let lastUrdf: string | null = null
    let lastRig: string | null = null
    let lastScene: string | null = null

    const clearViewer = (): void => {
      const st = useViewerStore.getState()
      if (st.source || st.rigSpec || st.sceneSpec) st.setSource('', { baseUrl: '' })
      lastNodeId = null
      lastUrdf = null
      lastRig = null
      lastScene = null
    }

    // Character path: pull the RigSpec (rig_preview → g_to_rig). Returns true when
    // it took ownership of the viewer (valid RigSpec found) so the URDF path is
    // skipped; false when no rig node / invalid output so the URDF path proceeds.
    async function trySyncRig(nodes: readonly GraphNode[]): Promise<boolean> {
      const node = pickRigNode(nodes)
      if (!node) return false
      const value = await client.getNodeOutput(node.id, RIG_PORT)
      if (cancelled) return true
      const rig = flattenWire<unknown>(value)[0]
      if (!isRigSpec(rig)) return false
      const key = JSON.stringify(rig)
      if (node.id === lastNodeId && key === lastRig) return true
      lastNodeId = node.id
      lastUrdf = null
      lastRig = key
      lastScene = null
      useViewerStore.getState().setRig(rig, {
        baseUrl: pluginUrl('/api/v1/library/blob'),
        sourceLabel: rig.meshFilename,
      })
      return true
    }

    // Static path: pull the SceneSpec (scene_preview → g_to_scene). Returns true
    // when it took ownership of the viewer (valid SceneSpec found) so the URDF
    // path is skipped; false when no scene node / invalid output so the URDF path
    // proceeds. Sits below the character path, above the URDF path.
    async function trySyncScene(nodes: readonly GraphNode[]): Promise<boolean> {
      const node = pickSceneNode(nodes)
      if (!node) return false
      const value = await client.getNodeOutput(node.id, SCENE_PORT)
      if (cancelled) return true
      const scene = flattenWire<unknown>(value)[0]
      if (!isSceneSpec(scene)) return false
      const key = JSON.stringify(scene)
      if (node.id === lastNodeId && key === lastScene) return true
      lastNodeId = node.id
      lastUrdf = null
      lastRig = null
      lastScene = key
      useViewerStore.getState().setScene(scene, {
        baseUrl: pluginUrl('/api/v1/library/blob'),
        sourceLabel: `scene · ${scene.itemCount} item${scene.itemCount === 1 ? '' : 's'}`,
      })
      return true
    }

    // Pull the authored joint animation clip (if any g_bake_animation node
    // exists) and push it into the viewer store. Independent of the URDF source:
    // runs even when the viewer is cleared, so a stale clip never lingers.
    async function syncAuthoredAnimation(nodes: readonly GraphNode[]): Promise<void> {
      const animNodes = nodes.filter((n) => n.opId === ANIMATION_OP)
      const completed = animNodes.filter((n) => n.status === 'completed')
      const pool = completed.length ? completed : animNodes
      const node = pool[pool.length - 1] ?? null
      const setAuthoredAnimation = useViewerStore.getState().setAuthoredAnimation
      if (!node) {
        if (useViewerStore.getState().authoredAnimation) setAuthoredAnimation(null)
        return
      }
      const value = await client.getNodeOutput(node.id, ANIMATION_PORT)
      if (cancelled) return
      const clip = flattenWire<unknown>(value)[0]
      setAuthoredAnimation(isAuthoredClip(clip) ? clip : null)
    }

    async function refresh(): Promise<void> {
      const nodes = await client.listNodes()
      if (cancelled) return
      // Keep the authored-animation mirror fresh regardless of URDF state below.
      await syncAuthoredAnimation(nodes)
      if (cancelled) return
      // Character path takes precedence: a valid RigSpec switches to character
      // mode and short-circuits the pulls below.
      if (await trySyncRig(nodes)) return
      if (cancelled) return
      // Static path next: a valid SceneSpec switches to static mode and
      // short-circuits the URDF pull below.
      if (await trySyncScene(nodes)) return
      if (cancelled) return
      const node = pickSourceNode(nodes)
      if (!node) {
        // STALE eviction: no source node left → empty the viewer.
        clearViewer()
        return
      }
      const value = await client.getNodeOutput(node.id, URDF_PORT)
      if (cancelled) return
      const urdf = flattenWire<string>(value)[0]
      if (typeof urdf !== 'string' || !urdf.includes('<robot')) {
        // Source node still present but this output is empty/invalid (chain
        // disconnected, upstream errored, not executed yet) → clear too, so the
        // viewport never lingers on a stale model from a previous good run.
        clearViewer()
        return
      }
      // Unchanged node + identical URDF → nothing to do; avoid a needless rebuild.
      if (node.id === lastNodeId && urdf === lastUrdf) return
      lastNodeId = node.id
      lastUrdf = urdf
      lastRig = null
      lastScene = null
      // Baked composite Parts/Gears emit <mesh filename="<sha>.obj"/>; the
      // viewer's geometry loader fetches `baseUrl + '/' + filename`, so point
      // it at the content-addressed blob route. URDF-native primitives
      // (box/cylinder/sphere) carry no filename and ignore baseUrl.
      useViewerStore.getState().setSource(urdf, { baseUrl: pluginUrl('/api/v1/library/blob') })
    }

    // Coalesce bursts (a delete fires graph:applied; downstream re-exec fires
    // exec:completed) into one refresh, and never overlap two in-flight; if a
    // trigger lands mid-flight, run exactly one more.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let pending = false
    async function runRefresh(): Promise<void> {
      if (inFlight) { pending = true; return }
      inFlight = true
      try {
        await refresh()
      } catch {
        /* transient fetch failure — a later trigger will retry */
      } finally {
        inFlight = false
        if (pending && !cancelled) { pending = false; scheduleRefresh() }
      }
    }
    function scheduleRefresh(): void {
      if (cancelled || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void runRefresh()
      }, 30)
    }

    const unsubExec = client.subscribe('execution', (e) => {
      if (e.kind === 'exec:completed') scheduleRefresh()
    })
    const unsubGraph = client.subscribe('graph', (e) => {
      if (e.kind === 'graph:applied') scheduleRefresh()
    })
    void runRefresh()

    return () => {
      cancelled = true
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubExec()
      unsubGraph()
    }
  }, [client, projectKey])
}
