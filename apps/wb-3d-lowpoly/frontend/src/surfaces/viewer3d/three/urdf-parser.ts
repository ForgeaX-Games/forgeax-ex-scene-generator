// 💡 URDF 解析器：将 URDF XML 文本解析为结构化 spec（links / joints / 材质库）
//    迁移自 CAD viewer，保持纯函数 + 浏览器 DOMParser 实现
import * as THREE from 'three';

export interface UrdfJoint {
  name: string;
  type: 'fixed' | 'revolute' | 'continuous' | 'prismatic' | 'floating' | 'planar';
  parent: string;
  child: string;
  origin?: {
    xyz?: [number, number, number];
    rpy?: [number, number, number];
  };
  axis?: [number, number, number];
  limit?: {
    lower?: number;
    upper?: number;
    effort?: number;
    velocity?: number;
  };
  mimic?: {
    joint: string;
    multiplier: number;
    offset: number;
  };
}

export interface UrdfVisualGeometry {
  type: 'box' | 'cylinder' | 'sphere' | 'mesh';
  size?: [number, number, number]; // box
  radius?: number; // cylinder, sphere
  length?: number; // cylinder
  filename?: string; // mesh
  scale?: [number, number, number]; // mesh
}

export interface UrdfVisual {
  name?: string;
  origin?: {
    xyz?: [number, number, number];
    rpy?: [number, number, number];
  };
  geometry: UrdfVisualGeometry;
  material?: {
    name?: string;
    color?: { rgba: [number, number, number, number] };
    texture?: { filename: string };
    /** 非标准 URDF 扩展（g_to_urdf 的 `<pbr metalness=".." roughness=".."/>`）。 */
    pbr?: { metalness?: number; roughness?: number };
  };
}

type UrdfMaterial = NonNullable<UrdfVisual['material']>;

export interface UrdfLink {
  name: string;
  visuals: UrdfVisual[];
  collisions: UrdfVisual[];
}

export interface UrdfSpec {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
}

export interface UrdfVisualDescriptor {
  key: string;
  label: string;
  index: number;
}

export function parseVec3(str: string | undefined): [number, number, number] {
  if (!str) return [0, 0, 0]
  const parts = str.trim().split(/\s+/).map(parseFloat)
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ]
}

export function parseVec4(str: string | undefined): [number, number, number, number] {
  if (!str) return [1, 1, 1, 1]
  const parts = str.trim().split(/\s+/).map(parseFloat)
  return [
    Number.isFinite(parts[0]) ? parts[0] : 1,
    Number.isFinite(parts[1]) ? parts[1] : 1,
    Number.isFinite(parts[2]) ? parts[2] : 1,
    Number.isFinite(parts[3]) ? parts[3] : 1,
  ]
}

export function buildUrdfVisualKey(linkName: string, visualIndex: number): string {
  return `${linkName}::visual:${visualIndex}`
}

function meshFilenameStem(filename: string | undefined): string | null {
  if (!filename) return null
  const normalized = filename.split(/[?#]/, 1)[0] ?? ''
  const basename = normalized.split('/').at(-1)?.trim() ?? ''
  if (!basename) return null
  const stem = basename.replace(/\.[^.]+$/, '')
  return stem || null
}

function baseVisualLabel(visual: UrdfVisual, index: number): string {
  const explicitName = visual.name?.trim()
  if (explicitName) return explicitName
  if (visual.geometry.type === 'mesh') {
    const stem = meshFilenameStem(visual.geometry.filename)
    if (stem) return stem
  }
  return `${visual.geometry.type} ${index + 1}`
}

export function describeLinkVisuals(link: UrdfLink): UrdfVisualDescriptor[] {
  const baseLabels = link.visuals.map((v, i) => baseVisualLabel(v, i))
  const labelTotals = new Map<string, number>()
  for (const label of baseLabels) labelTotals.set(label, (labelTotals.get(label) ?? 0) + 1)

  const seenLabels = new Map<string, number>()
  return baseLabels.map((baseLabel, index) => {
    const nextCount = (seenLabels.get(baseLabel) ?? 0) + 1
    seenLabels.set(baseLabel, nextCount)
    return {
      key: buildUrdfVisualKey(link.name, index),
      label: (labelTotals.get(baseLabel) ?? 0) > 1 ? `${baseLabel} ${nextCount}` : baseLabel,
      index,
    }
  })
}

/**
 * URDF 固定轴 RPY (roll, pitch, yaw) 转 THREE.Matrix4：Rz(yaw)·Ry(pitch)·Rx(roll)。
 */
export function rpyToMatrix4(rpy: [number, number, number]): THREE.Matrix4 {
  const [roll, pitch, yaw] = rpy
  const mx = new THREE.Matrix4().makeRotationX(roll)
  const my = new THREE.Matrix4().makeRotationY(pitch)
  const mz = new THREE.Matrix4().makeRotationZ(yaw)
  return new THREE.Matrix4().multiplyMatrices(mz, new THREE.Matrix4().multiplyMatrices(my, mx))
}

export function originToMatrix4(origin?: { xyz?: [number, number, number]; rpy?: [number, number, number] }): THREE.Matrix4 {
  const xyz = origin?.xyz ?? [0, 0, 0]
  const rpy = origin?.rpy ?? [0, 0, 0]
  const translation = new THREE.Matrix4().makeTranslation(xyz[0], xyz[1], xyz[2])
  const rotation = rpyToMatrix4(rpy)
  return new THREE.Matrix4().multiplyMatrices(translation, rotation)
}

function parseOrigin(originEl: Element | null): { xyz?: [number, number, number]; rpy?: [number, number, number] } | undefined {
  if (!originEl) return undefined
  const xyzStr = originEl.getAttribute('xyz') ?? undefined
  const rpyStr = originEl.getAttribute('rpy') ?? undefined
  const result: { xyz?: [number, number, number]; rpy?: [number, number, number] } = {}
  if (xyzStr) result.xyz = parseVec3(xyzStr)
  if (rpyStr) result.rpy = parseVec3(rpyStr)
  return Object.keys(result).length > 0 ? result : undefined
}

function parseGeometry(geomEl: Element | null): UrdfVisualGeometry | null {
  if (!geomEl) return null

  const boxEl = geomEl.querySelector('box')
  if (boxEl) {
    return { type: 'box', size: parseVec3(boxEl.getAttribute('size') ?? undefined) }
  }

  const cylinderEl = geomEl.querySelector('cylinder')
  if (cylinderEl) {
    return {
      type: 'cylinder',
      radius: parseFloat(cylinderEl.getAttribute('radius') || '1'),
      length: parseFloat(cylinderEl.getAttribute('length') || '1'),
    }
  }

  const sphereEl = geomEl.querySelector('sphere')
  if (sphereEl) {
    return { type: 'sphere', radius: parseFloat(sphereEl.getAttribute('radius') || '1') }
  }

  const meshEl = geomEl.querySelector('mesh')
  if (meshEl) {
    const scaleStr = meshEl.getAttribute('scale') ?? undefined
    return {
      type: 'mesh',
      filename: meshEl.getAttribute('filename') || '',
      scale: scaleStr ? parseVec3(scaleStr) : undefined,
    }
  }

  return null
}

function parsePbrAttr(pbrEl: Element, attr: string): number | undefined {
  const raw = pbrEl.getAttribute(attr)
  if (raw === null) return undefined
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseMaterial(matEl: Element | null): UrdfVisual['material'] | undefined {
  if (!matEl) return undefined
  const name = matEl.getAttribute('name') || undefined
  const colorEl = matEl.querySelector('color')
  const textureEl = matEl.querySelector('texture')
  const pbrEl = matEl.querySelector('pbr')
  const material: UrdfVisual['material'] = { name }
  if (colorEl) {
    material.color = { rgba: parseVec4(colorEl.getAttribute('rgba') ?? undefined) }
  }
  if (textureEl) {
    material.texture = { filename: textureEl.getAttribute('filename') || '' }
  }
  if (pbrEl) {
    const metalness = parsePbrAttr(pbrEl, 'metalness')
    const roughness = parsePbrAttr(pbrEl, 'roughness')
    if (metalness !== undefined || roughness !== undefined) {
      material.pbr = { ...(metalness !== undefined ? { metalness } : {}), ...(roughness !== undefined ? { roughness } : {}) }
    }
  }
  return material
}

function resolveMaterial(
  material: UrdfVisual['material'],
  materialLibrary: Map<string, UrdfMaterial>,
): UrdfVisual['material'] {
  if (!material?.name) return material
  const libraryMaterial = materialLibrary.get(material.name)
  if (!libraryMaterial) return material
  return {
    ...libraryMaterial,
    ...material,
    color: material.color ?? libraryMaterial.color,
    texture: material.texture ?? libraryMaterial.texture,
    pbr: material.pbr ?? libraryMaterial.pbr,
  }
}

function parseVisual(visualEl: Element, materialLibrary: Map<string, UrdfMaterial>): UrdfVisual | null {
  const name = visualEl.getAttribute('name') || undefined
  const originEl = visualEl.querySelector('origin')
  const geomEl = visualEl.querySelector('geometry')
  const matEl = visualEl.querySelector('material')

  const geometry = parseGeometry(geomEl)
  if (!geometry) {
    // 关键：单个 visual 缺几何体时只跳过它，不要 throw。否则一个坏元素会让整段 URDF
    // 解析失败、整模型一片空白（用户侧表现为"渲染报错、什么都看不到"）。
    console.warn('[viewer/urdf-parser] skipping visual with no renderable geometry', { name })
    return null
  }
  return {
    name,
    origin: parseOrigin(originEl),
    geometry,
    material: resolveMaterial(parseMaterial(matEl), materialLibrary),
  }
}

function parseLink(linkEl: Element, materialLibrary: Map<string, UrdfMaterial>): UrdfLink {
  const name = linkEl.getAttribute('name') || ''
  const visuals: UrdfVisual[] = []
  for (const v of linkEl.querySelectorAll(':scope > visual')) {
    const visual = parseVisual(v, materialLibrary)
    if (visual) visuals.push(visual)
  }
  const collisions: UrdfVisual[] = []
  for (const c of linkEl.querySelectorAll(':scope > collision')) {
    const collision = parseVisual(c, materialLibrary)
    if (collision) collisions.push(collision)
  }
  return { name, visuals, collisions }
}

function parseJoint(jointEl: Element): UrdfJoint {
  const name = jointEl.getAttribute('name') || ''
  const type = (jointEl.getAttribute('type') || 'fixed') as UrdfJoint['type']
  const parent = jointEl.querySelector('parent')?.getAttribute('link') || ''
  const child = jointEl.querySelector('child')?.getAttribute('link') || ''
  const originEl = jointEl.querySelector('origin')
  const axisEl = jointEl.querySelector('axis')
  const limitEl = jointEl.querySelector('limit')
  const mimicEl = jointEl.querySelector('mimic')

  const joint: UrdfJoint = { name, type, parent, child }
  if (originEl) joint.origin = parseOrigin(originEl)
  if (axisEl) joint.axis = parseVec3(axisEl.getAttribute('xyz') ?? undefined)
  if (limitEl) {
    joint.limit = {
      lower: parseFloat(limitEl.getAttribute('lower') || '0'),
      upper: parseFloat(limitEl.getAttribute('upper') || '0'),
      effort: parseFloat(limitEl.getAttribute('effort') || '0'),
      velocity: parseFloat(limitEl.getAttribute('velocity') || '0'),
    }
  }
  if (mimicEl) {
    const mimicJoint = mimicEl.getAttribute('joint') || ''
    if (mimicJoint) {
      joint.mimic = {
        joint: mimicJoint,
        multiplier: parseFloat(mimicEl.getAttribute('multiplier') || '1'),
        offset: parseFloat(mimicEl.getAttribute('offset') || '0'),
      }
    }
  }
  return joint
}

/**
 * 将 package:// 路径改写为相对路径（用于直接 fetch 时去掉包名前缀）。
 */
export function rewriteAbsoluteMeshFilenames(urdfSpec: UrdfSpec): UrdfSpec {
  const rewrite = (filename: string): string => {
    if (filename.startsWith('package://')) {
      const match = filename.match(/^package:\/\/[^/]+\/(.+)$/)
      return match ? match[1] : filename
    }
    return filename
  }
  const rewriteVisuals = (visuals: UrdfVisual[]): UrdfVisual[] =>
    visuals.map((v) => {
      if (v.geometry.type === 'mesh' && v.geometry.filename) {
        return { ...v, geometry: { ...v.geometry, filename: rewrite(v.geometry.filename) } }
      }
      return v
    })
  return {
    ...urdfSpec,
    links: urdfSpec.links.map((link) => ({
      ...link,
      visuals: rewriteVisuals(link.visuals),
      collisions: rewriteVisuals(link.collisions),
    })),
  }
}

/** 找根 link（不在任何 joint 的 child 列表里的 link） */
export function findRootLink(urdfSpec: UrdfSpec): string | null {
  const childLinks = new Set(urdfSpec.joints.map((j) => j.child))
  const rootLink = urdfSpec.links.find((link) => !childLinks.has(link.name))
  return rootLink?.name || null
}

/**
 * 解析 URDF XML 字符串为结构化 spec
 * 失败时抛出 Error（调用方应捕获并向用户展示）。
 */
export function parseUrdf(urdfXml: string): UrdfSpec {
  const parser = new DOMParser()
  const doc = parser.parseFromString(urdfXml, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`URDF XML 解析失败：${parserError.textContent?.trim() || 'unknown parser error'}`)
  }

  const robotEl = doc.querySelector('robot')
  if (!robotEl) {
    throw new Error('URDF missing <robot> root element')
  }

  const name = robotEl.getAttribute('name') || 'robot'
  const materialLibrary = new Map<string, UrdfMaterial>()
  for (const materialEl of robotEl.querySelectorAll(':scope > material')) {
    const material = parseMaterial(materialEl)
    if (!material?.name) continue
    materialLibrary.set(material.name, material)
  }

  const links: UrdfLink[] = []
  for (const linkEl of robotEl.querySelectorAll(':scope > link')) {
    links.push(parseLink(linkEl, materialLibrary))
  }

  const joints: UrdfJoint[] = []
  for (const jointEl of robotEl.querySelectorAll(':scope > joint')) {
    joints.push(parseJoint(jointEl))
  }

  return { name, links, joints }
}
