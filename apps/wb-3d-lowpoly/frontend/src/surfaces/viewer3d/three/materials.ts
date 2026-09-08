// 💡 URDF 材质处理：根据 URDF material 节点解析 + 应用命名预设 + 生成 THREE 物理材质
//    迁移自 CAD viewer，逻辑保持一致
import * as THREE from 'three'
import type { UrdfVisual } from './urdf-parser'

export interface MaterialSpec {
  name?: string
  color: THREE.Color
  opacity: number
  metalness: number
  roughness: number
  transmission: number
  thickness: number
  ior: number
  clearcoat: number
  clearcoatRoughness: number
  envMapIntensity: number
}

export function depthBiasForOrdinal(ordinal: number): number {
  return 1 + ordinal * 0.25
}

function srgbColor(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function softenBrightDiffuse(spec: MaterialSpec): void {
  const maxChannel = Math.max(spec.color.r, spec.color.g, spec.color.b)
  const minChannel = Math.min(spec.color.r, spec.color.g, spec.color.b)
  const isBrightNeutral = maxChannel > 0.78 && maxChannel - minChannel < 0.08
  if (!isBrightNeutral || spec.metalness > 0.2 || spec.transmission > 0.01) return

  spec.color.lerp(new THREE.Color(0.82, 0.82, 0.78), 0.38)
  spec.roughness = Math.max(spec.roughness, 0.62)
  spec.clearcoat = Math.min(spec.clearcoat, 0.08)
  spec.envMapIntensity = Math.min(spec.envMapIntensity, 0.55)
}

export function resolveVisualMaterialSpec(visual: UrdfVisual): MaterialSpec {
  const defaultSpec: MaterialSpec = {
    name: undefined,
    color: srgbColor(0.74, 0.74, 0.72),
    opacity: 1.0,
    metalness: 0.05,
    roughness: 0.48,
    transmission: 0,
    thickness: 0,
    ior: 1.45,
    clearcoat: 0,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.8,
  }
  if (!visual.material) return defaultSpec

  const spec = { ...defaultSpec }
  spec.name = visual.material.name
  if (visual.material.color) {
    const [r, g, b, a] = visual.material.color.rgba
    spec.color = srgbColor(r, g, b)
    spec.opacity = a
  }
  const tuned = applyNamedMaterialPreset(spec)
  // g_material 电池给的显式 metalness/roughness（g_to_urdf 输出的 <pbr .../> 扩展）比
  // 按材质名字符串关键词猜测的启发式更可信——覆盖掉上面 applyNamedMaterialPreset 猜的值；
  // 没有显式值时该启发式仍是唯一的兜底。
  const pbr = visual.material.pbr
  if (pbr?.metalness !== undefined) tuned.metalness = clamp01(pbr.metalness)
  if (pbr?.roughness !== undefined) tuned.roughness = clamp01(pbr.roughness)
  softenBrightDiffuse(tuned)
  return tuned
}

/**
 * 静态路（SceneSpec item）：从 rgba + 可选 metalness/roughness 构建 MaterialSpec。
 * rgba 按 sRGB 解释（与 resolveVisualMaterialSpec 的颜色空间一致）；套同样的
 * softenBrightDiffuse 让亮中性色贴合 low-poly 观感。缺省 pbr 值与默认灰一致。
 */
export function materialSpecFromRgba(
  rgba: [number, number, number, number],
  extras?: { metalness?: number; roughness?: number },
): MaterialSpec {
  const [r, g, b, a] = rgba
  const spec: MaterialSpec = {
    name: undefined,
    color: srgbColor(r, g, b),
    opacity: a,
    metalness: extras?.metalness !== undefined ? clamp01(extras.metalness) : 0.05,
    roughness: extras?.roughness !== undefined ? clamp01(extras.roughness) : 0.48,
    transmission: 0,
    thickness: 0,
    ior: 1.45,
    clearcoat: 0,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.8,
  }
  softenBrightDiffuse(spec)
  return spec
}

function applyNamedMaterialPreset(spec: MaterialSpec): MaterialSpec {
  const name = spec.name?.toLowerCase() ?? ''
  const tuned = { ...spec }
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean)
  const hasToken = (token: string): boolean => tokens.includes(token)
  const hasAnyToken = (...candidates: string[]): boolean => candidates.some(hasToken)

  const mentionsTransparentDescriptor = hasAnyToken('clear', 'glass', 'transparent', 'translucent', 'smoked', 'frosted')
  const mentionsTransparentPlasticFamily = hasAnyToken('polycarbonate', 'acrylic', 'plexi', 'plexiglass', 'lexan')
  const isClearRigidMaterial = mentionsTransparentDescriptor
    || (mentionsTransparentPlasticFamily && tuned.opacity < 0.999)

  if (isClearRigidMaterial) {
    tuned.metalness = 0.0
    tuned.roughness = 0.08
    tuned.transmission = Math.max(0.45, 1.0 - tuned.opacity * 0.55)
    tuned.thickness = 0.006
    tuned.ior = 1.45
    tuned.clearcoat = 0.9
    tuned.clearcoatRoughness = 0.06
    tuned.envMapIntensity = 1.25
    return tuned
  }

  if (name.includes('reflector')) {
    tuned.metalness = 0.9
    tuned.roughness = 0.18
    tuned.opacity = Math.max(tuned.opacity, 0.78)
    tuned.clearcoat = 0.18
    tuned.clearcoatRoughness = 0.12
    tuned.envMapIntensity = 1.4
    return tuned
  }

  if (name.includes('brass') || name.includes('metal')) {
    tuned.metalness = 0.88
    tuned.roughness = 0.22
    tuned.clearcoat = 0.16
    tuned.clearcoatRoughness = 0.18
    tuned.envMapIntensity = 1.3
    return tuned
  }

  if (name.includes('bakelite')) {
    tuned.metalness = 0.02
    tuned.roughness = 0.38
    tuned.clearcoat = 0.24
    tuned.clearcoatRoughness = 0.2
    tuned.envMapIntensity = 0.7
    return tuned
  }

  if (name.includes('felt')) {
    tuned.metalness = 0.0
    tuned.roughness = 0.92
    tuned.clearcoat = 0.0
    tuned.envMapIntensity = 0.25
  }

  return tuned
}

export function createMaterial(spec: MaterialSpec, options?: {
  wireframe?: boolean
  transparent?: boolean
  side?: THREE.Side
  depthBias?: number
  /** 平面/faceted 着色（low-poly 烘焙网格逐面法线，而非平滑插值）。 */
  flatShading?: boolean
}): THREE.MeshPhysicalMaterial {
  const transparent = options?.transparent ?? (spec.opacity < 0.999 || spec.transmission > 0.01)
  const side = options?.side ?? THREE.FrontSide
  const depthBias = options?.depthBias ?? 0

  return new THREE.MeshPhysicalMaterial({
    color: spec.color,
    opacity: spec.opacity,
    metalness: spec.metalness,
    roughness: spec.roughness,
    transmission: spec.transmission,
    thickness: spec.thickness,
    ior: spec.ior,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    envMapIntensity: spec.envMapIntensity,
    transparent,
    depthWrite: !transparent,
    forceSinglePass: transparent,
    wireframe: options?.wireframe ?? false,
    flatShading: options?.flatShading ?? false,
    side,
    polygonOffset: depthBias !== 0,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: depthBias,
  })
}

export function createEdgeLines(geometry: THREE.BufferGeometry, color: number = 0x000000): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry, 15)
  const lineMaterial = new THREE.LineBasicMaterial({ color, opacity: 0.3, transparent: true })
  return new THREE.LineSegments(edges, lineMaterial)
}
