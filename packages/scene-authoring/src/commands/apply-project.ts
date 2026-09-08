import type {
  ActorKind,
  ContractRegistry,
  SceneAuthoringConfirmation,
  SceneDiagnostic,
  SceneProjectAst,
} from '../model/types.js'
import { applyAuthoringCommands } from './apply-module.js'
import {
  applyExtractDefinition,
  applyMoveStatement,
  findDefinition,
  inlineInstance,
} from './apply-project-ops.js'
import {
  cloneModule,
  commandDiagnostic,
  verifyCanonicalRoundTrip,
} from './helpers.js'
import type {
  ApplyProjectAuthoringCommandsResult,
  AuthoringCommand,
} from './types.js'

export function applyProjectAuthoringCommands(
  input: SceneProjectAst,
  commands: readonly AuthoringCommand[],
  options: {
    actor: ActorKind
    registry: ContractRegistry
    resolveImport?: (fromModuleId: string, specifier: string) => string
  },
): ApplyProjectAuthoringCommandsResult {
  const modules = Object.fromEntries(Object.entries(input.modules).map(([id, module]) => [id, cloneModule(module)]))
  const diagnostics: SceneDiagnostic[] = []
  const confirmations: SceneAuthoringConfirmation[] = []
  const changed = new Set<string>()
  let applied = 0
  const resolveImport = options.resolveImport ?? ((_from: string, specifier: string) => specifier)

  for (const [commandIndex, command] of commands.entries()) {
    const statementId = 'statementId' in command ? command.statementId : undefined
    const owner = (command.moduleId ? modules[command.moduleId] : undefined)
      ?? (command.file ? Object.values(modules).find((module) => module.file === command.file) : undefined)
      ?? (statementId
        ? Object.values(modules).find((module) => module.statements.some((item) => item.statementId === statementId))
        : modules[input.entryModuleId])
    if (!owner) {
      diagnostics.push(commandDiagnostic(
        'SCENE_COMMAND_MODULE_NOT_FOUND',
        `No owning Scene Script module was found for '${statementId ?? ''}'.`,
        'resolve',
        statementId,
      ))
      continue
    }

    if (command.type === 'moveStatement') {
      const result = applyMoveStatement(modules, owner, command)
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      else {
        result.changed.forEach((moduleId) => changed.add(moduleId))
        applied += 1
      }
      continue
    }

    if (command.type === 'extractDefinition' || command.type === 'wrapInGroup') {
      const result = applyExtractDefinition(modules, owner, command, options.registry)
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      if (result.confirmation) confirmations.push({ ...result.confirmation, commandIndex })
      if (!result.diagnostic && !result.confirmation) {
        result.changed.forEach((moduleId) => changed.add(moduleId))
        applied += 1
      }
      continue
    }

    if (command.type === 'inlineDefinition' || command.type === 'ungroup') {
      const target = owner.statements.find((statement) => statement.statementId === command.statementId)
      if (!target) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_TARGET_NOT_FOUND',
          `Authoring entity '${command.statementId}' does not exist.`,
          'resolve',
          command.statementId,
        ))
        continue
      }
      const found = findDefinition(modules, owner, target.functionName, resolveImport)
      const instances = command.strategy === 'shared-definition' && found
        ? Object.values(modules).flatMap((module) => module.statements.flatMap((statement) => {
            const candidate = findDefinition(modules, module, statement.functionName, resolveImport)
            return candidate?.definition.definitionId === found.definition.definitionId ? [{ module, statement }] : []
          }))
        : [{ module: owner, statement: target }]
      let successful = true
      for (const candidate of instances) {
        const result = inlineInstance(
          modules,
          candidate.module,
          candidate.statement,
          options.registry,
          options.actor,
          resolveImport,
        )
        if (result.diagnostic) {
          diagnostics.push(result.diagnostic)
          successful = false
          break
        }
        result.changed.forEach((moduleId) => changed.add(moduleId))
      }
      if (successful) applied += 1
      continue
    }

    let commandInput = owner
    let syntheticStatementId: string | undefined
    if ((command.type === 'connectValue' || command.type === 'disconnectValue' || command.type === 'setCapturedOutput')
      && command.sourceStatementId) {
      const localSource = owner.statements.find((item) => item.statementId === command.sourceStatementId)
      if (!localSource) {
        const sourceModule = Object.values(modules).find((module) =>
          module.statements.some((item) => item.statementId === command.sourceStatementId))
        const source = sourceModule?.statements.find((item) => item.statementId === command.sourceStatementId)
        const exported = source?.binding
          ? sourceModule?.exports.find((item) => item.local === source.binding)
          : undefined
        const imported = sourceModule && exported
          ? owner.imports.flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
            .find(({ item, specifier }) =>
              resolveImport(owner.moduleId, item.from) === sourceModule.moduleId
              && specifier.imported === exported.exported)
          : undefined
        if (source && imported) {
          syntheticStatementId = source.statementId
          commandInput = {
            ...owner,
            statements: [
              ...owner.statements,
              { ...source, binding: imported.specifier.local, source: { ...source.source, file: owner.file } },
            ],
          }
        }
      }
    }
    const result = applyAuthoringCommands(commandInput, [command], options)
    const module = syntheticStatementId
      ? { ...result.module, statements: result.module.statements.filter((item) => item.statementId !== syntheticStatementId) }
      : result.module
    diagnostics.push(...result.diagnostics)
    if (result.applied) {
      modules[owner.moduleId] = module
      changed.add(owner.moduleId)
      applied += result.applied
    }
  }
  if (!diagnostics.some((item) => item.severity === 'error') && confirmations.length === 0) {
    for (const moduleId of changed) diagnostics.push(...verifyCanonicalRoundTrip(modules[moduleId], options.registry))
  }
  const rejected = diagnostics.some((item) => item.severity === 'error') || confirmations.length > 0
  return {
    project: rejected ? input : { ...input, modules },
    diagnostics,
    applied: rejected ? 0 : applied,
    changedModuleIds: rejected ? [] : [...changed],
    confirmations,
  }
}
