import { hasGroupCapability } from '../contracts/contracts.js'
import { stableEntityId } from '../model/identity.js'
import type {
  ActorKind,
  ContractRegistry,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
} from '../model/types.js'
import {
  cloneModule,
  commandDiagnostic,
  referencesBinding,
  removeReference,
  rewriteExpression,
  validBinding,
} from './helpers.js'
import type { ApplyAuthoringCommandsResult, AuthoringCommand } from './types.js'

export function applyAuthoringCommands(
  input: SceneModuleAst,
  commands: readonly AuthoringCommand[],
  options: { actor: ActorKind; registry: ContractRegistry },
): ApplyAuthoringCommandsResult {
  const module = cloneModule(input)
  const diagnostics: SceneDiagnostic[] = []
  let applied = 0

  for (const command of commands) {
    if (command.type === 'addCall') {
      const contract = options.registry.get(command.functionName)
      if (!contract) {
        diagnostics.push(
          commandDiagnostic('SCENE_COMMAND_UNKNOWN_FUNCTION', `Unknown Scene function '${command.functionName}'.`, 'resolve'),
        )
        continue
      }
      const statementId =
        command.statementId ??
        stableEntityId('stmt', `${module.moduleId}:${command.functionName}:${command.binding ?? ''}:${module.statements.length}`)
      const statement = {
        kind: 'call' as const,
        statementId,
        ...(command.binding ? { binding: command.binding } : {}),
        functionName: command.functionName,
        args: { ...(command.args ?? {}) },
        contractKind: contract.kind,
        source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
      }
      const afterIndex = command.afterStatementId
        ? module.statements.findIndex((item) => item.statementId === command.afterStatementId)
        : -1
      module.statements.splice(afterIndex >= 0 ? afterIndex + 1 : module.statements.length, 0, statement)
      applied += 1
      continue
    }

    if (command.type === 'moveStatement'
      || command.type === 'extractDefinition'
      || command.type === 'wrapInGroup'
      || command.type === 'inlineDefinition'
      || command.type === 'ungroup') {
      diagnostics.push(commandDiagnostic(
        'SCENE_COMMAND_PROJECT_CONTEXT_REQUIRED',
        `Command '${command.type}' requires a Scene Project transaction.`,
        'capability',
        'statementId' in command ? command.statementId : command.statementIds[0],
      ))
      continue
    }

    const index = module.statements.findIndex((item) => item.statementId === command.statementId)
    const statement = module.statements[index]
    if (!statement) {
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_TARGET_NOT_FOUND',
          `Authoring entity '${command.statementId}' does not exist.`,
          'resolve',
          command.statementId,
        ),
      )
      continue
    }
    const contract = options.registry.get(statement.functionName)

    if (command.type === 'renameBinding') {
      if (!statement.binding) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Authoring entity '${statement.statementId}' has no binding.`,
          'resolve',
          statement.statementId,
        ))
        continue
      }
      if (!validBinding(command.binding)) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_INVALID_BINDING',
          `'${command.binding}' is not a valid Scene Script binding.`,
          'parse',
          statement.statementId,
        ))
        continue
      }
      if (module.statements.some((item) => item !== statement && item.binding === command.binding)
        || module.definitions.some((item) => item.exportName === command.binding)
        || module.imports.some((item) => item.specifiers.some((specifier) => specifier.local === command.binding))) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_DUPLICATE_BINDING',
          `Binding '${command.binding}' already exists in module '${module.file}'.`,
          'resolve',
          statement.statementId,
        ))
        continue
      }
      const previous = statement.binding
      statement.binding = command.binding
      for (const candidate of module.statements) {
        candidate.args = Object.fromEntries(
          Object.entries(candidate.args).map(([name, value]) => [
            name,
            rewriteExpression(value, (reference) =>
              reference.binding === previous ? { ...reference, binding: command.binding } : reference),
          ]),
        )
      }
      for (const exported of module.exports) if (exported.local === previous) exported.local = command.binding
      applied += 1
      continue
    }

    if (command.type === 'setCapturedOutput') {
      const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
      if (!source?.binding) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Source entity '${command.sourceStatementId}' has no binding.`,
          'resolve',
          command.sourceStatementId,
        ))
        continue
      }
      statement.args[command.input ?? 'scene'] = {
        kind: 'reference',
        binding: source.binding,
        ...(command.output ? { output: command.output } : {}),
      }
      applied += 1
      continue
    }

    if (command.type === 'editSealedInternal') {
      const canEdit =
        contract?.kind === 'atomic' ||
        (contract ? hasGroupCapability(contract, options.actor, 'editInstanceOverride') : false)
      if (!canEdit) {
        diagnostics.push({
          ...commandDiagnostic(
            'SCENE_CAPABILITY_SEALED_INTERNAL',
            `Actor '${options.actor}' cannot edit the internal topology of sealed entity '${statement.functionName}'. Configure or replace the entity through its public contract.`,
            'capability',
            statement.statementId,
          ),
          expected: 'A public configure, connect, move, replace, or remove command.',
          actual: { command: command.type, runtimeNodeId: command.runtimeNodeId },
        })
        continue
      }
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_OVERRIDE_UNSUPPORTED',
          'Internal instance overrides are not represented by the current Scene Script version.',
          'capability',
          statement.statementId,
        ),
      )
      continue
    }

    if (command.type === 'removeCall') {
      const referenced = module.statements.some((candidate) =>
        Object.values(candidate.args).some((expression) =>
          statement.binding ? referencesBinding(expression, statement.binding) : false),
      )
      if (referenced && statement.binding) {
        diagnostics.push(
          commandDiagnostic(
            'SCENE_COMMAND_REFERENCED_ENTITY',
            `Cannot remove '${statement.binding}' while another entity references it.`,
            'type',
            statement.statementId,
          ),
        )
        continue
      }
      module.statements.splice(index, 1)
      applied += 1
      continue
    }

    if (command.type === 'updateArguments') {
      for (const key of command.unset ?? []) delete statement.args[key]
      Object.assign(statement.args, command.set ?? {})
      applied += 1
      continue
    }

    if (command.type === 'disconnectValue') {
      if (!command.sourceStatementId) {
        delete statement.args[command.input]
      } else {
        const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
        const current = statement.args[command.input]
        if (source?.binding && current) {
          const next = removeReference(current, source.binding, command.output)
          if (next) statement.args[command.input] = next
          else delete statement.args[command.input]
        }
      }
      applied += 1
      continue
    }

    const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
    if (!source?.binding) {
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Source entity '${command.sourceStatementId}' has no binding.`,
          'resolve',
          command.sourceStatementId,
        ),
      )
      continue
    }
    const reference: SceneExpression = {
      kind: 'reference',
      binding: source.binding,
      ...(command.output ? { output: command.output } : {}),
    }
    const current = statement.args[command.input]
    if (command.append && current) {
      const items = current.kind === 'array' ? [...current.items] : [current]
      if (!items.some((item) =>
        item.kind === 'reference' && item.binding === source.binding && item.output === command.output)) {
        items.push(reference)
      }
      statement.args[command.input] = { kind: 'array', items }
    } else {
      statement.args[command.input] = reference
    }
    applied += 1
  }

  return { module, diagnostics, applied }
}
