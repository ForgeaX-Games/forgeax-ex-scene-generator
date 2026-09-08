import type { FastifyInstance } from 'fastify'
import type { NodeGroup } from '@forgeax/node-runtime'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const appTemplateRoot = resolve(repoRoot, 'batteries', 'templates')
const templateRoots = [
  ...resolveBatteryScanRoots(repoRoot).map((root) => resolve(root, 'templates')),
  appTemplateRoot,
]

interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  version?: string
  /** Base64 data URL loaded from icon.png beside the template json, when present. */
  iconPng?: string
  displayGroup?: string
  sourcePath?: string
}

async function collectJsonFiles(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectJsonFiles(full, out)
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full)
  }
}

async function readGroup(file: string): Promise<NodeGroup | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as NodeGroup
  } catch {
    return null
  }
}

function categoryFor(root: string, file: string): string {
  const rel = relative(root, file).split(/[\\/]/)
  return rel[0] || 'templates'
}

async function findTemplateFile(groupId: string): Promise<string | null> {
  for (const root of templateRoots) {
    const files: string[] = []
    await collectJsonFiles(root, files)
    for (const file of files) {
      const group = await readGroup(file)
      if (group?.id === groupId || basename(file, '.json') === groupId) return file
    }
  }
  return null
}

// Sanitize a user-supplied path segment: strip any directory components and
// neutralize `..` / leading dots so the value can never climb out of the
// template root. A defence-in-depth prefix check still runs at the call site.
function safeName(value: string): string {
  const cleaned = basename(value.trim())
    .replace(/[\\/]/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Group'
}

export async function registerGroupTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/group-templates/categories', async () => {
    const cats = new Set<string>()
    for (const root of templateRoots) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) if (entry.isDirectory()) cats.add(entry.name)
      } catch {
        /* ignore missing roots */
      }
    }
    return [...cats].sort()
  })

  app.get('/api/v1/group-templates', async () => {
    const items: GroupTemplateBattery[] = []
    const seen = new Set<string>()
    for (const root of templateRoots) {
      const files: string[] = []
      await collectJsonFiles(root, files)
      for (const file of files) {
        const group = await readGroup(file)
        if (!group?.id || seen.has(group.id)) continue
        seen.add(group.id)
        const category = categoryFor(root, file)
        // Templates 预览图：仅读取同目录下的 `icon.png`，其他文件名一律忽略。
        const iconPath = resolve(dirname(file), 'icon.png')
        let iconPng: string | undefined
        if (existsSync(iconPath)) {
          try {
            const buf = await readFile(iconPath)
            iconPng = `data:image/png;base64,${buf.toString('base64')}`
          } catch {
            iconPng = undefined
          }
        }
        items.push({
          id: group.id,
          name: group.name ?? basename(file, '.json'),
          nameEn: group.nameEn,
          category,
          displayGroup: `templates/${category}`,
          description: `Group template: ${group.name ?? group.id}`,
          version: '1.0.0',
          sourcePath: relative(repoRoot, file),
          ...(iconPng !== undefined ? { iconPng } : {}),
        })
      }
    }
    return items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  })

  app.get('/api/v1/group-templates/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const file = await findTemplateFile(id)
    if (!file) return reply.code(404).send(null)
    return readGroup(file)
  })

  // 模板详情面板：同目录 icon.png / usage.png / README.md（缺省字段省略）。
  app.get('/api/v1/group-templates/:id/docs', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const file = await findTemplateFile(id)
    if (!file) return reply.code(404).send({ error: `template not found: ${id}` })
    const dir = dirname(file)
    const readPng = async (name: string): Promise<string | undefined> => {
      const p = resolve(dir, name)
      if (!existsSync(p)) return undefined
      try {
        const buf = await readFile(p)
        return `data:image/png;base64,${buf.toString('base64')}`
      } catch {
        return undefined
      }
    }
    const [iconPng, usagePng, readme] = await Promise.all([
      readPng('icon.png'),
      readPng('usage.png'),
      (async () => {
        const p = resolve(dir, 'README.md')
        if (!existsSync(p)) return undefined
        try {
          return await readFile(p, 'utf8')
        } catch {
          return undefined
        }
      })(),
    ])
    return {
      ...(iconPng !== undefined ? { iconPng } : {}),
      ...(usagePng !== undefined ? { usagePng } : {}),
      ...(readme !== undefined ? { readme } : {}),
    }
  })

  app.post<{
    Body: { group: NodeGroup; categoryName: string; batteryName: string }
  }>('/api/v1/group-templates/save', async (req, reply) => {
    const categoryName = safeName(req.body.categoryName)
    const batteryName = safeName(req.body.batteryName)
    const dir = resolve(appTemplateRoot, categoryName, batteryName)
    // Defence-in-depth: even after safeName, confirm the resolved dir stays under
    // the template root before any mkdir / write (path-traversal guard).
    const rootPrefix = resolve(appTemplateRoot)
    if (dir !== rootPrefix && !dir.startsWith(rootPrefix + sep)) {
      return reply.code(400).send({ reason: 'invalid template path' })
    }
    await mkdir(dir, { recursive: true })
    const filePath = resolve(dir, `${batteryName}.json`)
    const group = { ...req.body.group, name: batteryName, nameEn: req.body.group.nameEn ?? batteryName }
    await writeFile(filePath, `${JSON.stringify(group, null, 2)}\n`, 'utf8')
    return { filePath, groupId: group.id, categoryName, batteryName }
  })
}
