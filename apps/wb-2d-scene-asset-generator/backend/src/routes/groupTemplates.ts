import type { FastifyInstance } from 'fastify'
import type { NodeGroup, Op } from '@forgeax/node-runtime'
import { applyBatch } from '@forgeax/node-runtime'
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { buildTemplateOps, splitTemplate } from '../lib/templateOps.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

// 成组电池有两类，物理隔离、用途分离（见 wb-scene-generator groupTemplates.ts）。
const appGroupRoot = resolve(repoRoot, 'batteries', 'groups')
const appTemplateRoot = resolve(repoRoot, 'batteries', 'templates')
const groupRoots = [
  ...resolveBatteryScanRoots(repoRoot).map((root) => resolve(root, 'groups')),
  appGroupRoot,
]
const builtinTemplateRoots = [
  ...resolveBatteryScanRoots(repoRoot).map((root) => resolve(root, 'templates')),
  appTemplateRoot,
]

// 用户内容（「保存到模板」）写入 workspace 的 `.forgeax` 区域，跨项目共享，
// 并与内置模板一起被扫描、统一显示。运行时读 FORGEAX_PROJECT_ROOT（与
// runtime.ts 一致），保证测试隔离。固定大标签 = "My templates"，小标签为子目录。
// 路径刻意含字面量 `templates` 段，使前端 getTemplateSubfolder 能解析出小标签。
const USER_TEMPLATE_BIG_LABEL = 'My templates'
function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}
function userTemplateRoot(): string {
  return resolve(resolveWorkspaceRoot(), 'user-content', 'templates')
}
function templateRoots(): string[] {
  return [...builtinTemplateRoots, userTemplateRoot()]
}
// 大标签 → 对应磁盘根列表。displayGroup 前缀即此 kind。
function getKinds(): ReadonlyArray<{ kind: 'groups' | 'templates'; roots: string[] }> {
  return [
    { kind: 'groups', roots: groupRoots },
    { kind: 'templates', roots: templateRoots() },
  ]
}

interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  version?: string
  /** Author persisted in the template json (top-level `author` field). */
  author?: string
  /** Creation timestamp (ms epoch); template json `createdAt`, else the file mtime. */
  createdAt?: number
  iconSvg?: string
  iconPng?: string
  displayGroup?: string
  sourcePath?: string
  /** True for preset templates shipped in the plugin (read-only); false for user templates under `.forgeax`. */
  builtin?: boolean
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

/** 同目录 PNG → data URL；文件不存在或读失败则 undefined。 */
async function readSiblingPng(jsonFile: string, fileName: string): Promise<string | undefined> {
  const pngPath = resolve(dirname(jsonFile), fileName)
  if (!existsSync(pngPath)) return undefined
  try {
    const buf = await readFile(pngPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** Templates 预览图：仅读取同目录下的 `icon.png`，其他文件名一律忽略。 */
async function readPreviewImage(jsonFile: string): Promise<string | undefined> {
  return readSiblingPng(jsonFile, 'icon.png')
}

async function readUsagePng(jsonFile: string): Promise<string | undefined> {
  return readSiblingPng(jsonFile, 'usage.png')
}

async function readReadmeMd(jsonFile: string): Promise<string | undefined> {
  const readmePath = resolve(dirname(jsonFile), 'README.md')
  if (!existsSync(readmePath)) return undefined
  try {
    return await readFile(readmePath, 'utf8')
  } catch {
    return undefined
  }
}

function categoryFor(root: string, file: string): string {
  const rel = relative(root, file).split(/[\\/]/)
  return rel[0] || 'templates'
}

type GroupCatalogScope = 'all' | 'groups' | 'templates'

function parseCatalogScope(raw: unknown): GroupCatalogScope {
  if (raw === 'groups' || raw === 'templates' || raw === 'all') return raw
  return 'all'
}

function kindsForScope(scope: GroupCatalogScope): ReadonlyArray<{ kind: 'groups' | 'templates'; roots: string[] }> {
  if (scope === 'groups') return [{ kind: 'groups', roots: groupRoots }]
  if (scope === 'templates') return [{ kind: 'templates', roots: templateRoots() }]
  return getKinds()
}

async function findGroupFile(groupId: string, scope: 'groups' | 'templates'): Promise<string | null> {
  for (const root of (scope === 'groups' ? groupRoots : templateRoots())) {
    const files: string[] = []
    await collectJsonFiles(root, files)
    for (const file of files) {
      const group = await readGroup(file)
      if (group?.id === groupId || basename(file, '.json') === groupId) return file
    }
  }
  return null
}

async function collectCatalogItems(scope: GroupCatalogScope): Promise<GroupTemplateBattery[]> {
  const items: GroupTemplateBattery[] = []
  const seenPaths = new Set<string>()
  const userRoot = userTemplateRoot()
  for (const { kind, roots } of kindsForScope(scope)) {
    for (const root of roots) {
      const files: string[] = []
      await collectJsonFiles(root, files)
      for (const file of files) {
        const group = await readGroup(file)
        if (!group?.id) continue
        const sourcePath = relative(repoRoot, file)
        if (seenPaths.has(sourcePath)) continue
        seenPaths.add(sourcePath)
        const category = categoryFor(root, file)
        const iconPath = resolve(dirname(file), 'icon.svg')
        const iconSvg = existsSync(iconPath) ? await readFile(iconPath, 'utf8').catch(() => undefined) : undefined
        const iconPng = kind === 'templates' ? await readPreviewImage(file) : undefined
        const meta = group as { version?: unknown; author?: unknown; createdAt?: unknown }
        const createdAt = typeof meta.createdAt === 'number'
          ? meta.createdAt
          : await stat(file).then((s) => s.mtimeMs).catch(() => undefined)
        items.push({
          id: group.id,
          name: group.name ?? basename(file, '.json'),
          nameEn: group.nameEn,
          category,
          displayGroup: `${kind}/${category}`,
          description: kind === 'templates'
            ? `Group template: ${group.name ?? group.id}`
            : `Group battery: ${group.name ?? group.id}`,
          version: typeof meta.version === 'string' && meta.version.trim() ? meta.version : '1.0.0',
          ...(typeof meta.author === 'string' && meta.author.trim() ? { author: meta.author } : {}),
          ...(createdAt !== undefined ? { createdAt } : {}),
          sourcePath,
          // 用户内容（userTemplateRoot 下）= builtin:false（可右击删除）；
          // 其余 groups/ 与内置 templates/ = builtin:true（只读，不可删除）。
          builtin: root !== userRoot,
          ...(iconSvg !== undefined ? { iconSvg } : {}),
          ...(iconPng !== undefined ? { iconPng } : {}),
        })
      }
    }
  }
  return items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

// 只在用户模板根（workspace `.forgeax`）下按 group id 定位文件，用于删除。
// 刻意不搜内置 templates/ 与 groups/，从根上保证预设模板永不可删。
async function findUserTemplateFile(groupId: string): Promise<string | null> {
  const root = userTemplateRoot()
  const files: string[] = []
  await collectJsonFiles(root, files)
  for (const file of files) {
    const group = await readGroup(file)
    if (group?.id === groupId || basename(file, '.json') === groupId) return file
  }
  return null
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/]/g, '-').replace(/\s+/g, ' ') || 'Group'
}

// Persist authoring metadata (version / author / createdAt) into the saved
// template json so the Templates palette can display it. Existing values are
// preserved; only missing ones get a sensible default stamp.
function stampTemplateMeta<T extends NodeGroup>(group: T): T {
  const meta = group as unknown as { version?: unknown; author?: unknown; createdAt?: unknown }
  return {
    ...group,
    version: typeof meta.version === 'string' && meta.version.trim() ? meta.version : '1.0.0',
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
    ...(typeof meta.author === 'string' && meta.author.trim() ? { author: meta.author } : {}),
  }
}

export async function registerGroupTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/group-templates/categories', async () => {
    // 保存按钮默认产出普通成组电池（写入 groups/），故分类候选取 groups/ 子目录。
    const cats = new Set<string>()
    for (const root of groupRoots) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) if (entry.isDirectory()) cats.add(entry.name)
      } catch {
        /* ignore missing roots */
      }
    }
    return [...cats].sort()
  })

  // Templates 模式专用：扫 templates/ 子目录（含尚无模板电池的空占位目录），
  // 供 Templates 栏目大标签列表显示。与上面的 groups/ 分类（保存目标）严格区分。
  app.get('/api/v1/group-templates/template-categories', async () => {
    const cats = new Set<string>()
    for (const root of templateRoots()) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) if (entry.isDirectory()) cats.add(entry.name)
      } catch {
        /* ignore missing roots */
      }
    }
    return [...cats].sort()
  })

  app.get<{ Querystring: { scope?: string } }>('/api/v1/group-templates', async (req) => {
    return collectCatalogItems(parseCatalogScope(req.query.scope))
  })

  app.get<{ Params: { id: string }; Querystring: { scope?: string } }>(
    '/api/v1/group-templates/:id',
    async (req, reply) => {
      const id = req.params.id
      const scopeRaw = req.query.scope
      const scope: 'groups' | 'templates' =
        scopeRaw === 'groups' || scopeRaw === 'templates' ? scopeRaw : 'templates'
      const file = await findGroupFile(id, scope)
      if (!file) return reply.code(404).send(null)
      return readGroup(file)
    },
  )

  // 模板详情面板：同目录 icon.png / usage.png / README.md（缺省字段省略）。
  app.get<{ Params: { id: string } }>(
    '/api/v1/group-templates/:id/docs',
    async (req, reply) => {
      const id = req.params.id
      const file = await findGroupFile(id, 'templates')
      if (!file) return reply.code(404).send({ error: `template not found: ${id}` })
      const [iconPng, usagePng, readme] = await Promise.all([
        readPreviewImage(file),
        readUsagePng(file),
        readReadmeMd(file),
      ])
      return {
        ...(iconPng !== undefined ? { iconPng } : {}),
        ...(usagePng !== undefined ? { usagePng } : {}),
        ...(readme !== undefined ? { readme } : {}),
      }
    },
  )

  app.post<{
    Body: { group: NodeGroup; categoryName: string; batteryName: string }
  }>('/api/v1/group-templates/save', async (req) => {
    const categoryName = safeName(req.body.categoryName)
    const batteryName = safeName(req.body.batteryName)
    // 保存按钮产出普通成组电池 → batteries/groups/<cat>/<name>/<name>.json
    const dir = resolve(appGroupRoot, categoryName, batteryName)
    await mkdir(dir, { recursive: true })
    const filePath = resolve(dir, `${batteryName}.json`)
    const group = stampTemplateMeta({ ...req.body.group, name: batteryName, nameEn: req.body.group.nameEn ?? batteryName })
    await writeFile(filePath, `${JSON.stringify(group, null, 2)}\n`, 'utf8')
    return { filePath, groupId: group.id, categoryName, batteryName }
  })

  // 用户「保存到模板」：把成组电池作为用户内容写入 workspace `.forgeax` 区域，
  // 固定大标签 "My templates"，小标签为子目录，模板自身再占一层文件夹：
  //   <workspaceRoot>/user-content/templates/My templates/<smallTag>/<name>/<name>.json
  // 必须保留「模板文件夹」这一层，使路径与内置模板（templates/{大}/{小}/{模板}/file.json）
  // 同构——前端 getTemplateSmallLabel 据此把 <smallTag> 识别为小标签；若把 json 直接放在
  // <smallTag>/ 下，小标签会被误判为模板文件夹而丢失（小标签失效）。
  // 列表接口 /api/v1/group-templates 会一并扫描该根，内置+用户模板统一显示。
  app.post<{
    Body: { group: NodeGroup; smallTag: string; templateName: string }
  }>('/api/v1/group-templates/save-user', async (req, reply) => {
    const body = req.body as Partial<{ group: NodeGroup; smallTag: unknown; templateName: unknown }> | undefined
    if (!body || typeof body.group !== 'object' || body.group === null) {
      return reply.code(400).send({ error: 'Missing or invalid "group" in request body' })
    }
    if (typeof body.smallTag !== 'string' || body.smallTag.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "smallTag" in request body' })
    }
    if (typeof body.templateName !== 'string' || body.templateName.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "templateName" in request body' })
    }

    const smallTag = safeName(body.smallTag)
    const templateName = safeName(body.templateName)
    const dir = resolve(userTemplateRoot(), USER_TEMPLATE_BIG_LABEL, smallTag, templateName)
    const filePath = resolve(dir, `${templateName}.json`)
    const group = stampTemplateMeta({ ...body.group, name: templateName, nameEn: body.group.nameEn ?? templateName })
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, `${JSON.stringify(group, null, 2)}\n`, 'utf8')
    } catch (err) {
      app.log.error({ err, dir, filePath }, 'failed to save user template')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to save user template: ${message}` })
    }
    return { filePath, groupId: group.id, smallTag, templateName }
  })

  // 删除用户模板：仅限 userTemplateRoot 下的内容（预设模板只读，不在此可达）。
  // 删除 json 后顺手清理变空的小标签目录（保持「My templates」整洁，不留空分组）。
  app.delete('/api/v1/group-templates/user/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const file = await findUserTemplateFile(id)
    if (!file) return reply.code(404).send({ error: 'user template not found' })
    try {
      await rm(file)
      // 删除模板 json 后，自下而上清理变空的目录（模板文件夹 → 小标签文件夹），
      // 到 userTemplateRoot 为止，避免残留空的小标签分组。
      const stopAt = resolve(userTemplateRoot())
      let dir = dirname(file)
      while (resolve(dir).startsWith(stopAt + sep) && resolve(dir) !== stopAt) {
        const remaining = await readdir(dir).catch(() => null)
        if (remaining === null || remaining.length > 0) break
        await rmdir(dir).catch(() => {})
        dir = dirname(dir)
      }
    } catch (err) {
      app.log.error({ err, file }, 'failed to delete user template')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to delete user template: ${message}` })
    }
    return { ok: true }
  })

  // One-shot instantiation of a template group into the active project's graph
  // (twin of wb-scene-generator's same route). Reads the template JSON from
  // `templates/` only (never groups/, which are Develop-only), remaps every
  // inner node/edge/group id to fresh ones while keeping exposed `portName`s
  // stable (in_N/out_N), builds a single atomic batch via buildTemplateOps,
  // and applies it through the kernel applyBatch — so inner member createNodes
  // are materialised as ONE group node, never hand-wired by the agent. It does
  // NOT route through POST /api/v1/projects/:projectId/batch, so nested-group `createNode`s never
  // hit any top-level op gate. The per-agent project lock is enforced via
  // ensureMutationAccess (same as /api/v1/batch).
  app.post<{
    Params: { id: string }
    Body: {
      projectId?: string
      templateId?: string
      position?: { x?: number; y?: number }
      groupId?: string
      opts?: { actor?: string; label?: string }
    }
  }>('/api/v1/group-templates/:id/instantiate', async (req, reply) => {
    const body = (req.body ?? {}) as {
      projectId?: string
      templateId?: string
      position?: { x?: number; y?: number }
      groupId?: string
      opts?: { actor?: string; label?: string }
    }
    const reg = await getProjectRegistry()
    const projectId =
      typeof body.projectId === 'string' && body.projectId.trim()
        ? body.projectId.trim()
        : reg.getViewingProjectId()
    if (!projectId) return reply.code(400).send({ reason: 'project id is required' })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })

    const templateId = body.templateId ?? req.params.id
    if (typeof templateId !== 'string' || !templateId.trim()) {
      return reply.code(400).send({ error: 'missing templateId' })
    }

    const file = await findGroupFile(templateId, 'templates')
    if (!file) return reply.code(404).send({ error: `template not found: ${templateId}` })
    const parsed = await readGroup(file)
    const split = splitTemplate(parsed)
    if (!split) {
      return reply.code(422).send({ error: `template '${templateId}' is not a valid NodeGroup` })
    }

    const rootPosition =
      body.position === undefined
        ? undefined
        : {
            x: typeof body.position.x === 'number' ? body.position.x : 0,
            y: typeof body.position.y === 'number' ? body.position.y : 0,
          }
    const explicitGroupId =
      typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId : undefined

    const { ops, rootGroupId, exposedInputs, exposedOutputs } = buildTemplateOps(
      split.root,
      split.deps,
      rootPosition,
      explicitGroupId,
    )

    // Stamp template provenance on the shadow node so the editor renders the
    // locked template UI (same fields as drag-out from the Templates palette).
    // buildTemplateOps/createGroup only sets `{ groupId }`; without this pass
    // AI-instantiated templates look like ordinary group batteries.
    const batchOps = [...ops] as Op[]
    const templateRoot = templateRoots().find((root) => file.startsWith(resolve(root)))
    if (templateRoot) {
      const category = categoryFor(templateRoot, file)
      const batteryName = split.root.name ?? basename(file, '.json')
      batchOps.push({
        type: 'updateNode',
        nodeId: rootGroupId,
        params: {
          groupId: rootGroupId,
          __groupIsTemplate: true,
          __groupSourceGroupId: split.root.id,
          __groupSourceCategory: category,
          __groupSourceBatteryName: batteryName,
        },
      } as Op)
    }

    const rt = await getRuntimeForProject(projectId)
    const result = await applyBatch(rt, batchOps as never, {
      actor: typeof body.opts?.actor === 'string' ? body.opts.actor : 'instantiate-template',
      label:
        typeof body.opts?.label === 'string'
          ? body.opts.label
          : `instantiate template ${split.root.name ?? templateId}`,
    })

    if (result.status !== 'ok') {
      const detail = result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'
      return reply.code(422).send({ error: `instantiate rejected: ${detail}`, result })
    }

    return {
      ...result,
      groupId: rootGroupId,
      name: split.root.name ?? templateId,
      exposedInputs,
      exposedOutputs,
      opCount: ops.length,
    }
  })
}
