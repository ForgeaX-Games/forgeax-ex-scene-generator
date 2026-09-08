// 💡 关节控制器 hook：维护 jointValues 状态，把数值应用到 THREE 节点（旋转 / 平移），支持 mimic
import { useState, useCallback, useRef, useEffect } from 'react'
import * as THREE from 'three'
import type { UrdfSpec, UrdfJoint } from './urdf-parser'

export interface JointControllerState {
  jointValues: Map<string, number>
  setJointValue: (name: string, value: number) => void
  applyJointValues: (values: Map<string, number>, options?: { commit?: boolean }) => void
  resetAll: () => void
}

interface JointRuntime {
  spec: UrdfJoint
  axis: THREE.Vector3
}

const DEFAULT_AXIS: [number, number, number] = [0, 0, 1]
const tempQuaternion = new THREE.Quaternion()
const tempOffset = new THREE.Vector3()

function resolveJointValues(
  explicitValues: Map<string, number>,
  runtimeMap: Map<string, JointRuntime>,
): Map<string, number> {
  const resolved = new Map<string, number>()
  const resolving = new Set<string>()

  const resolveJoint = (name: string): number => {
    const cached = resolved.get(name)
    if (cached !== undefined) return cached

    const runtime = runtimeMap.get(name)
    if (!runtime) return explicitValues.get(name) ?? 0
    if (resolving.has(name)) return 0

    resolving.add(name)
    const mimic = runtime.spec.mimic
    let value = explicitValues.get(name) ?? 0
    if (mimic) value = resolveJoint(mimic.joint) * mimic.multiplier + mimic.offset
    resolving.delete(name)
    resolved.set(name, value)
    return value
  }

  for (const name of runtimeMap.keys()) resolveJoint(name)
  return resolved
}

function applyResolvedJointValues(
  jointNodes: Map<string, THREE.Object3D> | null,
  runtimeMap: Map<string, JointRuntime>,
  values: Map<string, number>,
): void {
  if (!jointNodes) return
  for (const [name, node] of jointNodes) {
    const runtime = runtimeMap.get(name)
    if (!runtime) continue
    applyJointValue(node, runtime.spec, runtime.axis, values.get(name) ?? 0)
  }
}

export function useJointController(
  jointNodes: Map<string, THREE.Object3D> | null,
  urdfSpec: UrdfSpec | null,
): JointControllerState {
  const [jointValues, setJointValues] = useState<Map<string, number>>(new Map())
  const jointRuntimeMap = useRef<Map<string, JointRuntime>>(new Map())
  const explicitJointValuesRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const map = new Map<string, JointRuntime>()
    if (urdfSpec) {
      for (const joint of urdfSpec.joints) {
        map.set(joint.name, {
          spec: joint,
          axis: new THREE.Vector3(...(joint.axis ?? DEFAULT_AXIS)).normalize(),
        })
      }
    }
    jointRuntimeMap.current = map
    explicitJointValuesRef.current = new Map()
    setJointValues(resolveJointValues(new Map(), map))
  }, [urdfSpec])

  const setJointValue = useCallback(
    (name: string, value: number) => {
      const runtime = jointRuntimeMap.current.get(name)
      if (!runtime || runtime.spec.mimic) return

      const nextExplicit = new Map(explicitJointValuesRef.current)
      nextExplicit.set(name, value)
      explicitJointValuesRef.current = nextExplicit

      const resolved = resolveJointValues(nextExplicit, jointRuntimeMap.current)
      applyResolvedJointValues(jointNodes, jointRuntimeMap.current, resolved)
      setJointValues(resolved)
    },
    [jointNodes],
  )

  const applyJointValues = useCallback(
    (values: Map<string, number>, options?: { commit?: boolean }) => {
      const nextExplicit = new Map<string, number>()
      for (const [name, value] of values) {
        if (!Number.isFinite(value)) continue
        const runtime = jointRuntimeMap.current.get(name)
        if (runtime?.spec.mimic) continue
        nextExplicit.set(name, value)
      }

      explicitJointValuesRef.current = nextExplicit
      const resolved = resolveJointValues(nextExplicit, jointRuntimeMap.current)
      applyResolvedJointValues(jointNodes, jointRuntimeMap.current, resolved)

      if (options?.commit) setJointValues(new Map(resolved))
    },
    [jointNodes],
  )

  const resetAll = useCallback(() => {
    explicitJointValuesRef.current = new Map()
    const resolved = resolveJointValues(new Map(), jointRuntimeMap.current)
    applyResolvedJointValues(jointNodes, jointRuntimeMap.current, resolved)
    setJointValues(resolved)
  }, [jointNodes])

  return { jointValues, setJointValue, applyJointValues, resetAll }
}

function applyJointValue(
  node: THREE.Object3D,
  spec: UrdfJoint,
  axis: THREE.Vector3,
  value: number,
): void {
  switch (spec.type) {
    case 'revolute':
    case 'continuous': {
      tempQuaternion.setFromAxisAngle(axis, value)
      node.quaternion.copy(tempQuaternion)
      break
    }
    case 'prismatic': {
      tempOffset.copy(axis).multiplyScalar(value)
      node.position.copy(tempOffset)
      break
    }
    default:
      break
  }
}
