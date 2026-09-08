// 💡 静态场景构建器：SceneSpec → THREE.Group（一组已置位/上色的网格）。
//    URDF 场景图构建器（scene-graph-builder）与角色蒙皮构建器（character-builder）的
//    静态路对应物。复用 geometry-loader 的模板缓存 + flatShading 呈现；导出时整组合并为
//    单个多材质 .glb（exportStaticGlbBlob）。
import * as THREE from 'three'
import { loadGeometryObject } from './geometry-loader'
import { materialSpecFromRgba } from './materials'
import type { SceneSpec, SceneItem } from './scene-spec'

export interface BuildStaticSceneOptions {
  doubleSided?: boolean
  assetRevisionKey?: string | null
}

const SCENE_CONTENT_NAME = '__scene_content__'

/**
 * 构建静态场景内容组（模型根帧，Z-up；调用方负责套外层 Y-up 旋转 + 落地居中）。
 * 逐条并行加载 item 网格（<sha>.obj / .glb，命中模板缓存复用），套 origin/rpy/scale，
 * 有 rgba 覆盖色则上 MaterialSpec、否则保留内嵌色（多材质 GLB）。单条加载失败仅告警跳过，
 * 不整组失败（与 URDF mesh 批量加载的容错一致）。
 */
export async function buildStaticScene(
  sceneSpec: SceneSpec,
  baseUrl: string,
  options: BuildStaticSceneOptions = {},
): Promise<THREE.Group> {
  const content = new THREE.Group()
  content.name = SCENE_CONTENT_NAME

  // 保持 items 顺序稳定（Promise.all 的 add 顺序取决于完成先后，但导出/渲染不依赖顺序）。
  const tasks = sceneSpec.items.map(async (item, index) => {
    try {
      const group = await loadSceneItem(item, baseUrl, options)
      group.userData.sceneItemIndex = index
      content.add(group)
    } catch (err) {
      console.warn(`[viewer/scene-builder] item ${index} (${item.meshFilename}) load failed:`, err)
    }
  })
  await Promise.all(tasks)
  return content
}

async function loadSceneItem(
  item: SceneItem,
  baseUrl: string,
  options: BuildStaticSceneOptions,
): Promise<THREE.Group> {
  const materialSpec = item.rgba
    ? materialSpecFromRgba(item.rgba, { metalness: item.metalness, roughness: item.roughness })
    : undefined

  const group = await loadGeometryObject(
    { type: 'mesh', filename: item.meshFilename, scale: item.scale ?? [1, 1, 1] },
    baseUrl,
    {
      kind: 'visual',
      materialSpec,
      doubleSided: options.doubleSided,
      assetRevisionKey: options.assetRevisionKey ?? null,
    },
  )

  // origin/rpy 置位（模型根帧，ZYX 欧拉——与 URDF visual.origin 换算一致）。
  const origin = item.origin ?? [0, 0, 0]
  const rpy = item.rpy ?? [0, 0, 0]
  if (origin.some((v) => v !== 0) || rpy.some((v) => v !== 0)) {
    const m = new THREE.Matrix4()
    m.makeRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))
    m.setPosition(origin[0], origin[1], origin[2])
    group.applyMatrix4(m)
  }
  return group
}
