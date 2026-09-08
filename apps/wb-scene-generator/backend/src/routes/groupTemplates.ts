import type { FastifyInstance } from 'fastify'
import type { NodeGroup } from '@forgeax/node-runtime'
import type { NodeFunctionContract, PortContract } from '@forgeax/scene-authoring'
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { getProjectDir, getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { extractCaller, ensureMutationAccess } from './projects.js'
import { readSceneModule } from '../scene-script/persist/store.js'
import { getSceneContractRegistry } from '../scene-script/contracts/contracts.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

// 成组电池有两类，物理隔离、用途分离：
//   groups/<cat>    → Develop 可编辑开发版（保存默认落盘）
//   templates/<cat> → Templates 稳定发布版（供只读 UI catalog 与拖放实例化）
// GET ?scope=groups|templates|all 控制列表/读取范围；实例化仅扫 templates/。
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
  /** Base64 data URL loaded from icon.png beside the template json, when present. */
  iconPng?: string
  displayGroup?: string
  sourcePath?: string
  /** True for preset templates shipped in the plugin (read-only); false for user templates under `.forgeax`. */
  builtin?: boolean
  /** Public callable surface only; the sealed Definition body is never catalogued. */
  nativeDefinition?: {
    functionName: string
    kind: 'group' | 'template'
    contractVersion: string
    definitionId?: string
    definitionVersion?: string
    description: string
    inputs: Array<Omit<PortContract, 'parameterTarget'>>
    outputs: Array<Omit<PortContract, 'parameterTarget'>>
  }
}

/** Templates 预览图：仅读取同目录下的 `icon.png`，其他文件名一律忽略。 */
async function readIconPng(file: string): Promise<string | undefined> {
  const iconPath = resolve(dirname(file), 'icon.png')
  if (!existsSync(iconPath)) return undefined
  try {
    const buf = await readFile(iconPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
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

async function readUsagePng(file: string): Promise<string | undefined> {
  return readSiblingPng(file, 'usage.png')
}

async function readReadmeMd(file: string): Promise<string | undefined> {
  const readmePath = resolve(dirname(file), 'README.md')
  if (!existsSync(readmePath)) return undefined
  try {
    return await readFile(readmePath, 'utf8')
  } catch {
    return undefined
  }
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

async function collectSceneDefinitionFiles(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectSceneDefinitionFiles(full, out)
    else if (entry.isFile() && entry.name.endsWith('.scene.ts')) out.push(full)
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

function publicPort(port: PortContract): Omit<PortContract, 'parameterTarget'> {
  const { parameterTarget: _sealedTarget, ...visible } = port
  return visible
}

async function nativeDefinitionFor(
  scenePath: string,
  registry: Awaited<ReturnType<typeof getSceneContractRegistry>>,
): Promise<GroupTemplateBattery['nativeDefinition']> {
  const source = await readFile(scenePath, 'utf8').catch(() => '')
  const functionName = source.match(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineGroup\s*\(/)?.[1]
  if (!functionName) return undefined
  const contract: NodeFunctionContract | undefined = registry.get(functionName)
  if (!contract || (contract.kind !== 'group' && contract.kind !== 'template')) return undefined
  return {
    functionName: contract.functionName,
    kind: contract.kind,
    contractVersion: contract.contractVersion,
    ...(contract.definitionId ? { definitionId: contract.definitionId } : {}),
    ...(contract.definitionVersion ? { definitionVersion: contract.definitionVersion } : {}),
    description: contract.description,
    inputs: contract.inputs.map(publicPort),
    outputs: contract.outputs.map(publicPort),
  }
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

/**
 * Locate a develop group battery folder by its on-disk folder name when the json
 * is already gone (README-only orphans after a partial delete).
 */
async function findGroupBatteryFolder(batteryFolderName: string): Promise<string | null> {
  for (const root of groupRoots) {
    let categories: import('node:fs').Dirent[]
    try {
      categories = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const cat of categories) {
      if (!cat.isDirectory()) continue
      const dir = resolve(root, cat.name, batteryFolderName)
      if (!existsSync(dir)) continue
      try {
        const info = await stat(dir)
        if (info.isDirectory()) return dir
      } catch {
        continue
      }
    }
  }
  return null
}

/** Remove a group battery folder (<cat>/<name>/) and prune an empty category dir. */
async function removeGroupBatteryDirectory(dir: string, owningRoot: string): Promise<void> {
  const resolvedDir = resolve(dir)
  if (resolvedDir === resolve(owningRoot)) return
  await rm(resolvedDir, { recursive: true, force: true })
  const categoryDir = dirname(resolvedDir)
  if (resolve(categoryDir) === resolve(owningRoot)) return
  const remaining = await readdir(categoryDir).catch(() => null)
  if (remaining !== null && remaining.length === 0) {
    await rmdir(categoryDir).catch(() => {})
  }
}

async function collectCatalogItems(scope: GroupCatalogScope): Promise<GroupTemplateBattery[]> {
  const items: GroupTemplateBattery[] = []
  const registry = await getSceneContractRegistry()
  const seenPaths = new Set<string>()
  const userRoot = userTemplateRoot()
  for (const { kind, roots } of kindsForScope(scope)) {
    for (const root of roots) {
      const files: string[] = []
      await collectSceneDefinitionFiles(root, files)
      for (const file of files) {
        const sourcePath = relative(repoRoot, file)
        if (seenPaths.has(sourcePath)) continue
        seenPaths.add(sourcePath)
        const category = categoryFor(root, file)
        const iconSvg = kind === 'groups'
          ? (existsSync(resolve(dirname(file), 'icon.svg'))
              ? await readFile(resolve(dirname(file), 'icon.svg'), 'utf8').catch(() => undefined)
              : undefined)
          : undefined
        const iconPng = kind === 'templates' ? await readIconPng(file) : undefined
        const nativeDefinition = await nativeDefinitionFor(file, registry)
        if (!nativeDefinition) continue
        const createdAt = await stat(file).then((s) => s.mtimeMs).catch(() => undefined)
        items.push({
          id: nativeDefinition.definitionId ?? nativeDefinition.functionName,
          name: nativeDefinition.functionName,
          nameEn: nativeDefinition.functionName,
          category,
          displayGroup: `${kind}/${category}`,
          description: nativeDefinition.description,
          version: nativeDefinition.definitionVersion ?? nativeDefinition.contractVersion,
          ...(createdAt !== undefined ? { createdAt } : {}),
          sourcePath,
          // 用户内容（userTemplateRoot 下）= builtin:false（可右击删除）；
          // 其余 groups/ 与内置 templates/ = builtin:true（只读，不可删除）。
          builtin: root !== userRoot,
          nativeDefinition,
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

function safeName(value: unknown): string {
  // Tolerate non-string input (a malformed body would otherwise throw
  // `value.trim is not a function` → opaque 500). Coerce/skip before trimming.
  if (typeof value !== 'string') return 'Group'
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
    async (_req, reply) => reply.code(410).send({
      status: 'rejected',
      code: 'legacy-template-body-removed',
      reason: 'Raw JSON template bodies are not a production catalog API. Use the native Definition contract.',
    }),
  )

  // 模板详情面板：同目录 icon.png / usage.png / README.md（缺省字段省略）。
  app.get<{ Params: { id: string } }>(
    '/api/v1/group-templates/:id/docs',
    async (req, reply) => {
      const id = req.params.id
      const file = await findGroupFile(id, 'templates')
      if (!file) return reply.code(404).send({ error: `template not found: ${id}` })
      const [iconPng, usagePng, readme] = await Promise.all([
        readIconPng(file),
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

  app.post('/api/v1/group-templates/save', async (_req, reply) =>
    reply.code(410).send({
      status: 'rejected',
      code: 'json-template-authoring-removed',
      reason: 'JSON Group authoring has been removed. Extract or edit a native .scene.ts Definition.',
    }),
  )

  // 删除 GROUPS 标签下的成组电池：从本地电池目录（groups/<cat>/<name>/）物理删除。
  // 只允许删 groupRoots 范围内的文件（templates/ 与项目外路径一律拒绝），删掉 json
  // 后顺手清理只剩 icon 边车或已空的电池文件夹，保持 GROUPS 目录整洁。
  app.delete('/api/v1/group-templates/groups/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const file = await findGroupFile(id, 'groups')
    const orphanDir = file ? null : await findGroupBatteryFolder(id)
    if (!file && !orphanDir) return reply.code(404).send({ error: 'group battery not found' })

    const batteryDir = file ? dirname(file) : orphanDir!
    const resolvedDir = resolve(batteryDir)

    // Defense-in-depth: resolved path must stay inside a groupRoot — never let a
    // crafted id escape into templates/ or outside the battery tree.
    const owningRoot = groupRoots.find(
      (root) => resolvedDir === resolve(root) || resolvedDir.startsWith(resolve(root) + sep),
    )
    if (!owningRoot) return reply.code(403).send({ error: 'group battery is outside the deletable battery roots' })
    if (resolve(batteryDir) === resolve(owningRoot)) {
      return reply.code(403).send({ error: 'refusing to delete a group root directory' })
    }

    try {
      await removeGroupBatteryDirectory(batteryDir, owningRoot)
    } catch (err) {
      app.log.error({ err, dir: resolvedDir }, 'failed to delete group battery')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to delete group battery: ${message}` })
    }
    return { ok: true }
  })

  // 用户「保存到模板」：把成组电池作为用户内容写入 workspace `.forgeax` 区域，
  // 固定大标签 "My templates"，小标签为子目录，模板自身再占一层文件夹：
  //   <workspaceRoot>/user-content/templates/My templates/<smallTag>/<name>/<name>.json
  // 必须保留「模板文件夹」这一层，使路径与内置模板（templates/{大}/{小}/{模板}/file.json）
  // 同构——前端 getTemplateSmallLabel 据此把 <smallTag> 识别为小标签；若把 json 直接放在
  // <smallTag>/ 下，小标签会被误判为模板文件夹而丢失（小标签失效）。
  // 列表接口 /api/v1/group-templates 会一并扫描该根，内置+用户模板统一显示。
  app.post('/api/v1/group-templates/save-user', async (_req, reply) =>
    reply.code(410).send({
      status: 'rejected',
      code: 'json-template-authoring-removed',
      reason: 'User JSON templates have been removed. Publish a versioned .scene.ts Definition.',
    }),
  )

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

  // Instantiate a saved group template INTO the active project's graph as one
  // first-class `__group__` shadow node (the HTTP twin of dragging a saved group
  // from the library onto the canvas). Resolves the template by id /
  // file-basename, remaps every inner node/edge/group id to fresh ones (so the
  // same template can be dropped many times without collision) while keeping the
  // exposed `portName`s stable (in_N/out_N), then applies a single ordered batch
  // of createNode + connect + createGroup against the active runtime.
  // This human/workbench HTTP route remains separate from
  // POST /api/v1/projects/:projectId/batch.
  // The per-agent project lock is still enforced via ensureMutationAccess.
  app.post('/api/v1/group-templates/:id/instantiate', async (_req, reply) =>
    reply.code(410).send({
      status: 'rejected',
      code: 'legacy-template-instantiate-removed',
      reason: 'Legacy Runtime Graph instantiation has been removed. Instantiate the native Definition through Scene Script.',
    }),
  )
}
