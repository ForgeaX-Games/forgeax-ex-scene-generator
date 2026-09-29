import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { tools } from '../src/tool-handlers.ts'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const agentRoot = resolve(pluginRoot, 'agents', 'sino')

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('Sino Scene Script contract', () => {
  const pluginManifest = readJson(resolve(pluginRoot, 'forgeax-plugin.json'))
  const agent = pluginManifest.contributes.agents.find(
    (candidate: Record<string, any>) => candidate.id === 'sino',
  ) as Record<string, any>
  const contributedTools = new Map<string, Record<string, any>>(
    pluginManifest.contributes.tools.map((tool: Record<string, any>) => [tool.id, tool]),
  )

  it('registers Sino as a bundled Scene Generator agent', () => {
    const page = pluginManifest.contributes.pages.find(
      (candidate: Record<string, any>) => candidate.id === 'scene-generator',
    )
    expect(page.preferredAgent).toBe('sino')
    expect(agent.id).toBe('sino')
    expect(agent.card.cnTitle).toBe('场景设计师')
    expect(agent.card.enTitle).toBe('Scene Designer')
    expect(agent.multiInstance).toBe(false)
    expect(existsSync(resolve(agentRoot, 'persona', 'zh.md'))).toBe(true)
  })

  it('loads only the canonical Scene Script composition skill', () => {
    expect(agent.defaultSkills).toEqual([{
      source: 'inline',
      skillId: 'compose-scene-script',
    }])
    const skillIds = pluginManifest.contributes.skills.map((skill: Record<string, any>) => skill.id)
    expect(skillIds).toContain('compose-scene-script')
    expect(skillIds).not.toContain('compose-sino-scene')
    expect(skillIds).not.toContain('design-scene-brief')
    expect(skillIds).not.toContain('review-scene')
    expect(skillIds).not.toContain('compose-scene-pipeline')
    expect(skillIds).not.toContain('connect-node-task')
    expect(skillIds).not.toContain('create-scene-template')
    for (const retired of [
      'design-scene-brief',
      'review-scene',
      'compose-scene-pipeline',
      'connect-node-task',
      'create-scene-template',
      'Agent_0',
    ]) {
      expect(existsSync(resolve(pluginRoot, 'skills', retired))).toBe(false)
    }
    expect(readdirSync(resolve(pluginRoot, 'skills', 'compose-scene-script')).sort()).toEqual(['SKILL.md'])
    expect(agent.memoryDir).toBeUndefined()
  })

  it('publishes enough plugin-local routing metadata for Forge to select Sino', () => {
    expect(pluginManifest.description.zh).toMatch(/完整场景.*sino/i)
    expect(pluginManifest.description.en).toMatch(/complete-scene.*sino/i)

    const guide = pluginManifest.contributes.skills.find(
      (candidate: Record<string, any>) => candidate.id === 'scene-generator:author-guide',
    )
    expect(guide.description.zh).toMatch(/delegate_to_subagent.*sino/i)
    expect(guide.description.en).toMatch(/delegate_to_subagent.*sino/i)

    const guideBody = read(resolve(pluginRoot, 'SKILL.md'))
    expect(guideBody).toMatch(/delegate_to_subagent/)
    expect(guideBody).toMatch(/agent: "sino"/)
    expect(guideBody).toMatch(/spatial requirements|spatial brief/)
    expect(guideBody).toMatch(/sampleHeight/)
    expect(guideBody).toMatch(/verification\.ok/)
    expect(guideBody).toMatch(/Do not ask Sino to read|Do not put in the brief/)
    expect(guideBody).toMatch(/game manifest|game `main\.ts`/)
    expect(guideBody).toMatch(/SceneAsset/)
    expect(guideBody).toMatch(/heightfieldExplode/)
    expect(guideBody).toMatch(/heightfield/)
    expect(guideBody).not.toMatch(/cityLayoutFromJson\(/)
    expect(guideBody).toMatch(/scene:export\.glb/)
    expect(guideBody).toMatch(/ends the task|scene is done/)
    expect(guide.description.zh).toMatch(/manifest|SceneAsset/)
    expect(guide.description.en).toMatch(/spatial brief/)
    expect(guide.description.en).toMatch(/manifest|SceneAsset/)
    expect(guideBody).toMatch(/basePlane/)
    expect(guide.description.zh).toMatch(/spatial brief|SceneAsset|terrain/)
    expect(guide.description.en).toMatch(/spatial brief|terrain/)
  })

  it('uses a static high-level tool allowlist with visual evidence', () => {
    expect(agent.tools).not.toContain('scene:*')
    expect(agent.tools).toEqual(expect.arrayContaining([
      'scene:script.get',
      'scene:script.draft',
      'scene:script.commitProject',
      'scene:script.verify',
      'scene:authoring.lens',
      'scene:authoring.applyCommands',
      'scene:screenshot.capture',
      'scene:screenshot.latest',
      'scene:export.glb',
    ]))
    expect(agent.tools).toHaveLength(17)
    expect(agent.tools).not.toContain('scene:script.scaffold')
    expect(agent.tools).not.toContain('scene:script.contracts')
    expect(agent.tools).not.toContain('scene:script.references')
    expect((agent.tools as string[]).every((toolId) =>
      /^scene:(projects|script|authoring|renderer|screenshot|export)\./u.test(toolId))).toBe(true)
    const wireNames = (agent.tools as string[]).map((toolId) =>
      toolId.replace(/[^a-zA-Z0-9_-]/g, '_'))
    expect(new Set(wireNames).size).toBe(wireNames.length)
    expect(wireNames).toEqual(expect.arrayContaining([
      'scene_projects_list',
      'scene_script_draft',
      'scene_script_commitProject',
      'scene_script_verify',
      'scene_authoring_lens',
      'scene_authoring_applyCommands',
      'scene_renderer_info',
      'scene_screenshot_capture',
      'scene_export_glb',
    ]))
    expect(wireNames).not.toContain('scene_script_completion')
    expect(agent.tools).not.toContain('scene:script.completion')
    expect(agent.tools).not.toContain('scene:script.validate')
    expect(agent.tools).not.toContain('scene:script.put')
    for (const toolId of agent.tools as string[]) {
      expect(contributedTools.has(toolId), `${toolId} must be declared by the plugin`).toBe(true)
      expect(tools[toolId], `${toolId} must have a backend handler`).toBeDefined()
    }
    const exposedTools = [...contributedTools.values()]
      .filter((tool) => tool.exposedToAI)
      .map((tool) => tool.id)
      .sort()
    expect(exposedTools).toEqual([...(agent.tools as string[])].sort())
  })

  it('does not register leftover scaffold or Scene Agent transaction tools', () => {
    for (const toolId of [
      'scene:script.scaffold',
      'scene:agent.resumeSceneWork',
      'scene:agent.locateSceneTarget',
      'scene:agent.openEditLens',
      'scene:agent.proposeSceneEdit',
      'scene:agent.applySceneEdit',
      'scene:agent.previewSemanticDiff',
      'scene:agent.verifySceneEdit',
      'scene:agent.acceptOrRevertSceneEdit',
    ]) {
      expect(contributedTools.has(toolId), toolId).toBe(false)
      expect(tools[toolId], toolId).toBeUndefined()
      expect(agent.tools).not.toContain(toolId)
    }
    expect(contributedTools.get('scene:script.contracts')?.exposedToAI).toBe(false)
    expect(contributedTools.has('scene:script.references')).toBe(false)
  })

  it('keeps isolated multi-file draft as an optional preview tool', () => {
    const draft = contributedTools.get('scene:script.draft')
    expect(draft?.args.required).toEqual([
      'draftId',
      'files',
      'entryFile',
      'expectedProjectRevision',
      'execute',
    ])
    expect(draft?.args.properties.generation).toEqual(expect.objectContaining({
      type: 'integer',
      minimum: 1,
    }))
    expect(draft?.exposedToAI).toBe(true)
    expect(draft?.description.zh).toMatch(/可选/)
    expect(draft?.description.en).toMatch(/Optional/)
    const commit = contributedTools.get('scene:script.commitProject')
    expect(commit?.args.properties.stage).toBeUndefined()
    expect(agent.tools).not.toContain('scene:script.previewProject')
  })

  it('keeps lower-level and external asset bridges outside the AI surface', () => {
    for (const toolId of [
      'scene:batteries.list',
      'scene:batteries.get',
      'scene:pipeline.get',
      'scene:pipeline.export',
      'scene:library.useGameTextures',
      'scene:library.publishExternal',
    ]) {
      expect(contributedTools.get(toolId)?.exposedToAI, toolId).toBe(false)
      expect(agent.tools).not.toContain(toolId)
    }
  })

  it('keeps the recursive Scene Script core in one canonical skill', () => {
    const skill = read(resolve(pluginRoot, 'skills', 'compose-scene-script', 'SKILL.md'))
    const prompt = [read(resolve(agentRoot, 'persona', 'zh.md')), skill].join('\n')
    expect(prompt).not.toMatch(
      /compose-sino-scene|pipeline\.applyBatch|instantiateTemplate|\bin_\d|\bout_\d|\bMira\b|\bDirector\b|asset-requirements|sino-critic/i,
    )
    expect(skill).toMatch(/操作几何/)
    expect(skill).toMatch(/场景树/)
    expect(skill).toMatch(/互相引用/)
    expect(skill).toMatch(/heightfieldExplode/)
    expect(skill).toMatch(/heightfield\(\{ geometry, height/)
    expect(skill).not.toMatch(/subPlane\(\{|fieldComposite\(\{|meshSceneNode\(\{/)
    expect(skill).toMatch(/sceneOutput/)
    expect(prompt).toMatch(/Scene Script/)
    expect(prompt).toMatch(/commitProject/)
    expect(skill).toMatch(/不通过新建替代项目/)
    expect(skill).toMatch(/ifRevision/)
    expect(skill).toMatch(/projectId \+ projectRevision/)
    expect(prompt).toMatch(/看 Default|Look at Default/)
    expect(skill).toMatch(/对得上 brief[\s\S]*scene:export\.glb/)
    expect(prompt).not.toMatch(/verify 通过后[\s\S]*这是任务收口/)
    expect(prompt).not.toMatch(/That is task closure/)
    expect(prompt).toMatch(/sampleHeight/)
    expect(skill).toMatch(/commitProject[\s\S]*draft[\s\S]*(只用于|不是)/)
    expect(prompt).not.toMatch(/scene:script\.scaffold/)
    expect(prompt).not.toMatch(/scene:script\.contracts/)
    expect(prompt).not.toMatch(/scene:script\.references/)
    expect(prompt).not.toMatch(/scene:agent\./)
    expect(prompt).not.toMatch(/scene:agent\.designReferences|evaluateSceneQuality/)
    expect(prompt).toMatch(/SCENE_EXECUTE_SUMMARY_CHANNEL|channel-error/)
    expect(prompt).toMatch(/Authoring Lens/)
    expect(prompt).toMatch(/projectRevision/)
    expect(prompt).not.toMatch(/cityLayoutFromJson/)
    expect(prompt).not.toMatch(/不要发明 `plot_1`|Do not invent `plot_1`/)
    expect(prompt).not.toMatch(/Terrain[\s\S]*Regions[\s\S]*Routes[\s\S]*Parcels[\s\S]*Blockout/)
  })
})
