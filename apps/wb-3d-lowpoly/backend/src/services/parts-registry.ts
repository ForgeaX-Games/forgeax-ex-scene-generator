/**
 * parts-registry —— 每项目烘焙清单（Workstream C · 烘焙可发现性）。
 *
 * 维护 `<projectStateDir>/parts.json`：把 g_bake_part 烘出的每个 mesh 按 **名字**
 * （被烘 shape 的 id）登记，记录 sha256 + 未缩放局部 AABB + 尺寸 + 面数。这样 agent
 * 可用廉价的 `lowpoly:parts.list` 查到"我之前烘过哪些 mesh、它们的 sha 与包围盒"，
 * 直接解决"找不到已 bake 的 mesh"的来回摸索，也为 mesh-aware QC 提供真实 bbox。
 *
 * 设计：纯文件读写、无锁（单进程后端 + 每项目串行执行足够）；写失败不抛，只告警。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PartEntry {
  /** 被烘 shape 的 id（= mesh 逻辑名）。 */
  name: string
  /** 内容寻址文件名 `<sha>.obj`。 */
  filename: string
  sha256: string
  /** 未缩放局部 AABB（米）；缺失时为空数组。 */
  bbox_min: number[]
  bbox_max: number[]
  /** 尺寸 [dx,dy,dz]（米）。 */
  dims: number[]
  vertexCount?: number
  triangleCount?: number
  /** 最近登记时间（ISO）。 */
  bakedAt: string
}

export interface PartsRegistry {
  register(entry: Omit<PartEntry, 'bakedAt'>): void
  list(): PartEntry[]
}

interface PartsFile {
  version: 1
  parts: Record<string, PartEntry>
}

function readFile(path: string): PartsFile {
  if (!existsSync(path)) return { version: 1, parts: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PartsFile>
    if (parsed && typeof parsed === 'object' && parsed.parts && typeof parsed.parts === 'object') {
      return { version: 1, parts: parsed.parts as Record<string, PartEntry> }
    }
  } catch {
    /* corrupt → start fresh (do not crash the bake) */
  }
  return { version: 1, parts: {} }
}

/**
 * 为某个项目 state 目录建一个清单句柄。`stateDir` 是 `<project>/state`（graph.json 所在）。
 * parts.json 与 graph.json / history.jsonl 同级。
 */
export function createPartsRegistry(stateDir: string): PartsRegistry {
  const path = join(stateDir, 'parts.json')
  return {
    register(entry) {
      try {
        const file = readFile(path)
        file.parts[entry.name] = { ...entry, bakedAt: new Date().toISOString() }
        if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(file, null, 2), 'utf-8')
      } catch (e) {
        console.warn(`[parts-registry] register "${entry.name}" failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    list() {
      const file = readFile(path)
      return Object.values(file.parts).sort((a, b) => a.name.localeCompare(b.name))
    },
  }
}

/** 直接从 state 目录读清单（供 parts.list 路由用，无需 runtime）。 */
export function readPartsList(stateDir: string): PartEntry[] {
  return createPartsRegistry(stateDir).list()
}
