// 💡 三维场景的灯光 / 网格 / 坐标 / 环境贴图：studio-grade 光照
import * as THREE from 'three'

/** 每盏灯的基础强度存进 userData，供 applyLightingIntensity 按倍率实时重算，
 * 不用为了调强度整个重建 rig（重建会丢阴影贴图、有一帧黑屏）。 */
const BASE_INTENSITY_KEY = 'baseIntensity'

function addLight<T extends THREE.Light>(group: THREE.Group, light: T, baseIntensity: number, multiplier: number): T {
  light.userData[BASE_INTENSITY_KEY] = baseIntensity
  light.intensity = baseIntensity * multiplier
  group.add(light)
  return light
}

export function createLightingRig(intensityMultiplier: number = 1): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lighting-rig'

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd4d4d4, 1)
  hemiLight.name = 'hemisphere-light'
  addLight(group, hemiLight, 0.95, intensityMultiplier)

  const keyLight = new THREE.DirectionalLight(0xfff5e6, 1)
  keyLight.name = 'key-light'
  keyLight.position.set(6, 12, 8)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.width = 2048
  keyLight.shadow.mapSize.height = 2048
  keyLight.shadow.camera.near = 0.1
  keyLight.shadow.camera.far = 50
  keyLight.shadow.camera.left = -10
  keyLight.shadow.camera.right = 10
  keyLight.shadow.camera.top = 10
  keyLight.shadow.camera.bottom = -10
  addLight(group, keyLight, 0.75, intensityMultiplier)

  const fillLight = new THREE.DirectionalLight(0xf0f4ff, 1)
  fillLight.name = 'fill-light'
  fillLight.position.set(-6, 5, -6)
  addLight(group, fillLight, 0.65, intensityMultiplier)

  const rimLight = new THREE.DirectionalLight(0xffffff, 1)
  rimLight.name = 'rim-light'
  rimLight.position.set(0, -6, 10)
  addLight(group, rimLight, 0.35, intensityMultiplier)

  const frontFillLight = new THREE.DirectionalLight(0xfff9f0, 1)
  frontFillLight.name = 'front-fill-light'
  frontFillLight.position.set(0, 6, 10)
  addLight(group, frontFillLight, 0.5, intensityMultiplier)

  return group
}

/** 实时重算 rig 里每盏灯的强度（= 各自 baseIntensity × multiplier），不重建场景/阴影。
 * 供光照强度滑块 / 预设切换调用。 */
export function applyLightingIntensity(rig: THREE.Group, multiplier: number): void {
  rig.traverse((child) => {
    if (!(child instanceof THREE.Light)) return
    const base = child.userData[BASE_INTENSITY_KEY]
    if (typeof base === 'number') child.intensity = base * multiplier
  })
}

/**
 * 网格 / 坐标轴 ── 绝对量纲的标尺（不随模型大小自适应）。
 *
 * 设计原则：网格和坐标轴是"标尺"，刻度必须固定在物理单位（米）上，否则 URDF 里
 * 0.1m 的部件和 1m 的部件看起来一样大，用户失去对真实尺寸的感知。
 *
 * 量纲约定（与 URDF 一致，1 单位 = 1 米）：
 *   - 粗网格：20m × 20m，每格 1m（共 20 格）—— 主刻度
 *   - 细网格：20m × 20m，每格 0.1m（共 200 格）—— 次刻度
 *   - 坐标轴：每条 1m 长，配 0.1m 短刻 —— 让 0.1m / 1m 量级一眼可辨
 *
 * 任何时刻都不要 scale 网格 / 坐标轴；模型大小由 camera 适配处理。
 */

const GRID_TOTAL_M = 20
const GRID_MAJOR_DIVISIONS = 20    // 1m / cell
const GRID_MINOR_DIVISIONS = 200   // 0.1m / cell

export function createGridHelper(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'grid-group'

  const fineGrid = new THREE.GridHelper(GRID_TOTAL_M, GRID_MINOR_DIVISIONS, 0xc0c0c0, 0xd0d0d0)
  fineGrid.name = 'grid-fine-0.1m'
  const fineMat = fineGrid.material
  if (Array.isArray(fineMat)) {
    for (const m of fineMat) { m.transparent = true; m.opacity = 0.25 }
  } else {
    fineMat.transparent = true
    fineMat.opacity = 0.25
  }
  group.add(fineGrid)

  const coarseGrid = new THREE.GridHelper(GRID_TOTAL_M, GRID_MAJOR_DIVISIONS, 0x666666, 0x999999)
  coarseGrid.name = 'grid-coarse-1m'
  const coarseMat = coarseGrid.material
  if (Array.isArray(coarseMat)) {
    for (const m of coarseMat) { m.transparent = true; m.opacity = 0.55 }
  } else {
    coarseMat.transparent = true
    coarseMat.opacity = 0.55
  }
  group.add(coarseGrid)

  return group
}

/**
 * 坐标轴：3 条 1m 主轴（红 X / 绿 Y / 蓝 Z）+ 0.1m 处 / 0.5m 处的小刻度立方块，
 * 让用户在不依赖文字标注的情况下也能直接读出 "这是 0.1 米还是 1 米"。
 *
 * size 默认 1（= 1m）；这是个 URDF 常见量级 sweet spot。
 * 不要从外面再乘 scale；要更长就改 size 默认值。
 */
export function createAxisHelper(size: number = 1): THREE.Group {
  const group = new THREE.Group()
  group.name = 'axis-helper'

  const axes: Array<{ dir: THREE.Vector3; color: number }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xe74c3c },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x2ecc71 },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x3498db },
  ]

  // 主轴线段
  for (const { dir, color } of axes) {
    const points = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(size)]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color, linewidth: 2 })
    const line = new THREE.Line(geometry, material)
    group.add(line)
  }

  // 0.1m / 0.5m 处的小立方刻度，给视觉上一个"0.1m 是这么大"的锚点
  const tickPositions = [0.1, 0.5]
  const tickSize = 0.012
  for (const { dir, color } of axes) {
    for (const t of tickPositions) {
      if (t > size) continue
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(tickSize, tickSize, tickSize),
        new THREE.MeshBasicMaterial({ color }),
      )
      tick.position.copy(dir).multiplyScalar(t)
      group.add(tick)
    }
  }

  return group
}

/**
 * 早期版本会按模型 bbox 缩放网格 / 坐标轴；现在禁止——它们必须保持绝对量纲（1m 网格、
 * 1m 坐标轴），充当"米尺"。保留这个签名是为了不动调用点，但内部退化为固定原点 + 单位
 * scale，多次调用幂等。模型适配交给 camera fit + clip 来做。
 */
export function positionGroundHelpers(
  gridGroup: THREE.Group,
  axisGroup: THREE.Group,
  _robotGroup: THREE.Object3D,
): void {
  gridGroup.position.set(0, 0, 0)
  gridGroup.scale.set(1, 1, 1)
  axisGroup.position.set(0, 0, 0)
  axisGroup.scale.set(1, 1, 1)
}

export function createEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  pmremGenerator.compileEquirectangularShader()

  const envScene = new THREE.Scene()
  const topColor = new THREE.Color(0xf7f8fa)
  const bottomColor = new THREE.Color(0xd9dde3)
  const midColor = new THREE.Color(0xffffff)

  const envGeometry = new THREE.SphereGeometry(100, 32, 16)
  const envMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: topColor },
      midColor: { value: midColor },
      bottomColor: { value: bottomColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color;
        if (h > 0.0) {
          color = mix(midColor, topColor, h);
        } else {
          color = mix(midColor, bottomColor, -h);
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })

  const envMesh = new THREE.Mesh(envGeometry, envMaterial)
  envScene.add(envMesh)

  const envMap = pmremGenerator.fromScene(envScene, 0.04).texture
  pmremGenerator.dispose()
  envGeometry.dispose()
  envMaterial.dispose()

  return envMap
}
