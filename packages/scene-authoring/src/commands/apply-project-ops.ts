import { hasGroupCapability } from '../contracts/contracts.js'
import { stableEntityId } from '../model/identity.js'
import type {
  ActorKind,
  ContractRegistry,
  SceneAuthoringConfirmation,
  SceneCallStatement,
  SceneDefinitionAuthoringMeta,
  SceneDiagnostic,
  SceneExpression,
  SceneGroupDefinition,
  SceneImport,
  SceneModuleAst,
} from '../model/types.js'
import {
  addExport,
  addImport,
  cloneExpression,
  commandDiagnostic,
  contractPortType,
  moduleSpecifier,
  referencesBinding,
  resolveModuleFile,
  rewriteExpression,
  uniqueName,
  validBinding,
} from './helpers.js'
import type {
  AuthoringCommand,
} from './types.js'

export function referencesOf(expression: SceneExpression): Array<Extract<SceneExpression, { kind: 'reference' }>> {
  if (expression.kind === 'reference') return [expression]
  if (expression.kind === 'array') return expression.items.flatMap(referencesOf)
  if (expression.kind === 'object') return Object.values(expression.properties).flatMap(referencesOf)
  return []
}

export function extractProposal(
  modules: Record<string, SceneModuleAst>,
  module: SceneModuleAst,
  statementIds: readonly string[],
  registry: ContractRegistry,
): SceneDefinitionAuthoringMeta {
  const selected = module.statements.filter((statement) => statementIds.includes(statement.statementId))
  const selectedBindings = new Set(selected.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const allBindings = new Map(module.statements.flatMap((statement) => statement.binding ? [[statement.binding, statement] as const] : []))
  const inputReferences = selected.flatMap((statement) => Object.values(statement.args).flatMap(referencesOf))
    .filter((reference) => !selectedBindings.has(reference.binding))
  const inputs: SceneDefinitionAuthoringMeta['inputs'] = []
  const inputKeys = new Set<string>()
  for (const reference of inputReferences) {
    const key = `${reference.binding}\0${reference.output ?? ''}`
    if (inputKeys.has(key)) continue
    inputKeys.add(key)
    const source = allBindings.get(reference.binding)
    const contract = source ? registry.get(source.functionName) : undefined
    const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
    const descriptor = contractPortType(contract, 'output', sourcePort)
    inputs.push({
      name: reference.output ? `${reference.binding}_${reference.output}` : reference.binding,
      ...descriptor,
      sourceStatementId: source?.statementId ?? `import:${reference.binding}`,
      sourcePort,
    })
  }
  const outside = module.statements.filter((statement) => !statementIds.includes(statement.statementId))
  const outputs: SceneDefinitionAuthoringMeta['outputs'] = []
  const outputKeys = new Set<string>()
  for (const consumer of outside) {
    for (const reference of Object.values(consumer.args).flatMap(referencesOf)) {
      if (!selectedBindings.has(reference.binding)) continue
      const source = allBindings.get(reference.binding)!
      const contract = registry.get(source.functionName)
      const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
      const key = `${source.statementId}\0${sourcePort}`
      if (outputKeys.has(key)) continue
      outputKeys.add(key)
      const descriptor = contractPortType(contract, 'output', sourcePort)
      outputs.push({
        name: outputs.length === 0 && outside.length === 1 ? sourcePort : `${reference.binding}_${sourcePort}`,
        ...descriptor,
        sourceStatementId: source.statementId,
        sourcePort,
      })
    }
  }
  const selectedExports = module.exports.filter((item) => {
    const statement = allBindings.get(item.local)
    return statement ? statementIds.includes(statement.statementId) : false
  })
  for (const exported of selectedExports) {
    const source = allBindings.get(exported.local)!
    const contract = registry.get(source.functionName)
    const sourcePort = contract?.outputs[0]?.name ?? 'value'
    const key = `${source.statementId}\0${sourcePort}`
    if (!outputKeys.has(key)) {
      outputKeys.add(key)
      outputs.push({
        name: `${exported.exported}_${sourcePort}`,
        ...contractPortType(contract, 'output', sourcePort),
        sourceStatementId: source.statementId,
        sourcePort,
      })
    }
    for (const importer of Object.values(modules)) {
      if (importer.moduleId === module.moduleId) continue
      const expected = moduleSpecifier(importer.file, module.file)
      const importSpecifiers = importer.imports
        .filter((item) => item.from === expected)
        .flatMap((item) => item.specifiers)
        .filter((specifier) => specifier.imported === exported.exported)
      if (importSpecifiers.length === 0) continue
      // The exported binding is a single-output value unless consumers
      // explicitly select another output after import.
      for (const specifier of importSpecifiers) {
        for (const reference of importer.statements.flatMap((statement) =>
          Object.values(statement.args).flatMap(referencesOf))) {
          if (reference.binding !== specifier.local) continue
          const referencedPort = reference.output ?? sourcePort
          const referenceKey = `${source.statementId}\0${referencedPort}`
          if (outputKeys.has(referenceKey)) continue
          outputKeys.add(referenceKey)
          outputs.push({
            name: `${exported.exported}_${referencedPort}`,
            ...contractPortType(contract, 'output', referencedPort),
            sourceStatementId: source.statementId,
            sourcePort: referencedPort,
          })
        }
      }
    }
  }
  const base = 'ExtractedGroup'
  return {
    name: base,
    file: 'groups/extracted-group.scene.ts',
    definitionId: stableEntityId('def', `${module.moduleId}:${statementIds.join(':')}`),
    version: '1.0.0',
    inputs,
    outputs,
    seal: true,
    confirmed: false,
  }
}

export function applyExtractDefinition(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  command: Extract<AuthoringCommand, { type: 'extractDefinition' | 'wrapInGroup' }>,
  registry: ContractRegistry,
): { changed: string[]; confirmation?: SceneAuthoringConfirmation; diagnostic?: SceneDiagnostic } {
  const selected = owner.statements.filter((statement) => command.statementIds.includes(statement.statementId))
  if (selected.length !== command.statementIds.length || selected.length === 0) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_SELECTION_NOT_FOUND',
        'Extract Definition requires existing statements from one module.',
        'resolve',
        command.statementIds[0],
      ),
    }
  }
  const selectedSet = new Set(command.statementIds)
  const selectedBindings = new Set(selected.flatMap((statement) => statement.binding ? [statement.binding] : []))
  for (const statement of selected) {
    for (const reference of Object.values(statement.args).flatMap(referencesOf)) {
      const source = owner.statements.find((item) => item.binding === reference.binding)
      if (source && !selectedSet.has(source.statementId)) continue
      if (!source && owner.imports.some((item) => item.specifiers.some((specifier) => specifier.local === reference.binding))) continue
      if (!selectedBindings.has(reference.binding)) continue
    }
  }
  const proposal = extractProposal(modules, owner, command.statementIds, registry)
  const meta: SceneDefinitionAuthoringMeta = {
    ...proposal,
    ...command.meta,
    inputs: command.meta?.inputs ?? proposal.inputs,
    outputs: command.meta?.outputs ?? proposal.outputs,
    confirmed: command.meta?.confirmed === true,
  }
  if (!meta.confirmed) {
    return {
      changed: [],
      confirmation: {
        kind: 'extract-definition',
        commandIndex: -1,
        selectedStatementIds: [...command.statementIds],
        meta,
      },
    }
  }
  if (!validBinding(meta.name) || !meta.file.endsWith('.scene.ts') || Object.values(modules).some((item) => item.file === meta.file)) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_INVALID_DEFINITION_META',
        `Definition metadata name/file is invalid or already exists: '${meta.name}' / '${meta.file}'.`,
        'resolve',
      ),
    }
  }
  const inputByKey = new Map(meta.inputs.map((port) => [`${port.sourceStatementId}\0${port.sourcePort}`, port]))
  const sourceByBinding = new Map(owner.statements.flatMap((statement) => statement.binding ? [[statement.binding, statement] as const] : []))
  const body = selected.map((statement) => ({
    ...statement,
    source: { ...statement.source, file: meta.file },
    args: Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        if (selectedBindings.has(reference.binding)) return reference
        const source = sourceByBinding.get(reference.binding)
        const contract = source ? registry.get(source.functionName) : undefined
        const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
        const port = inputByKey.get(`${source?.statementId ?? `import:${reference.binding}`}\0${sourcePort}`)
        return port ? { kind: 'reference', binding: port.name } : reference
      }),
    ])),
  }))
  const outputByKey = new Map(meta.outputs.map((port) => [`${port.sourceStatementId}\0${port.sourcePort}`, port]))
  const definition: SceneGroupDefinition = {
    kind: 'group-definition',
    definitionId: meta.definitionId,
    exportName: meta.name,
    meta: {
      id: meta.definitionId,
      version: meta.version,
      sealed: meta.seal,
      inputs: Object.fromEntries(meta.inputs.map((port) => [
        port.name,
        { type: port.type, ...(port.runtimeType ? { runtimeType: port.runtimeType } : {}), ...(port.access ? { access: port.access } : {}) },
      ])),
      outputs: Object.fromEntries(meta.outputs.map((port) => [
        port.name,
        { type: port.type, ...(port.runtimeType ? { runtimeType: port.runtimeType } : {}), ...(port.access ? { access: port.access } : {}) },
      ])),
    },
    paramNames: meta.inputs.map((port) => port.name),
    body,
    returnOutputs: Object.fromEntries(meta.outputs.map((port) => {
      const source = owner.statements.find((statement) => statement.statementId === port.sourceStatementId)
      return [port.name, {
        kind: 'reference',
        binding: source?.binding ?? port.name,
        output: port.sourcePort,
      } as SceneExpression]
    })),
    source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 },
  }
  const definitionImports: SceneImport[] = []
  for (const statement of selected) {
    const imported = owner.imports
      .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === statement.functionName)
    if (!imported) continue
    const importFrom = imported.item.from.startsWith('.')
      ? moduleSpecifier(meta.file, resolveModuleFile(owner.file, imported.item.from))
      : imported.item.from
    let target = definitionImports.find((item) => item.from === importFrom
      && item.specifiers.some((specifier) => specifier.imported === imported.specifier.imported))
    if (!target) {
      target = {
        names: [],
        specifiers: [],
        from: importFrom,
        source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 },
      }
      definitionImports.push(target)
    }
    target.names.push(statement.functionName)
    target.specifiers.push({ imported: imported.specifier.imported, local: statement.functionName })
  }
  const definitionModuleId = stableEntityId('module', meta.definitionId)
  const definitionModule: SceneModuleAst = {
    moduleId: definitionModuleId,
    file: meta.file,
    imports: definitionImports,
    exports: [{ local: meta.name, exported: meta.name, source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 } }],
    definitions: [definition],
    statements: [],
  }
  modules[definitionModuleId] = definitionModule

  const used = new Set(owner.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const instanceBinding = uniqueName(meta.name.charAt(0).toLowerCase() + meta.name.slice(1), used)
  const firstIndex = Math.min(...selected.map((statement) => owner.statements.indexOf(statement)))
  const call: SceneCallStatement = {
    kind: 'call',
    statementId: stableEntityId('stmt', `${owner.moduleId}:${meta.definitionId}:instance`),
    binding: instanceBinding,
    functionName: addImport(owner, moduleSpecifier(owner.file, meta.file), meta.name, meta.name),
    args: Object.fromEntries(meta.inputs.map((port) => {
      const source = owner.statements.find((statement) => statement.statementId === port.sourceStatementId)
      const importedBinding = port.sourceStatementId.startsWith('import:') ? port.sourceStatementId.slice(7) : undefined
      return [port.name, {
        kind: 'reference',
        binding: source?.binding ?? importedBinding ?? port.name,
        ...(port.sourcePort ? { output: port.sourcePort } : {}),
      } as SceneExpression]
    })),
    contractKind: 'group',
    source: { file: owner.file, start: 0, end: 0, line: 1, column: 1 },
  }
  owner.statements = owner.statements.filter((statement) => !selectedSet.has(statement.statementId))
  owner.statements.splice(firstIndex, 0, call)
  for (const statement of owner.statements) {
    if (statement === call) continue
    statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
      name,
      rewriteExpression(expression, (reference) => {
        const source = sourceByBinding.get(reference.binding)
        if (!source || !selectedSet.has(source.statementId)) return reference
        const contract = registry.get(source.functionName)
        const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
        const output = outputByKey.get(`${source.statementId}\0${sourcePort}`)
        return output ? { kind: 'reference', binding: instanceBinding, output: output.name } : reference
      }),
    ]))
  }
  const changedImporters = new Set<string>()
  for (const exported of owner.exports) {
    const source = sourceByBinding.get(exported.local)
    if (!source || !selectedSet.has(source.statementId)) continue
    const contract = registry.get(source.functionName)
    const sourcePort = contract?.outputs[0]?.name ?? 'value'
    const output = outputByKey.get(`${source.statementId}\0${sourcePort}`)
    if (!output) continue
    exported.local = instanceBinding
    const expectedSpecifier = moduleSpecifier('', owner.file).replace(/^\.\//, '')
    for (const importer of Object.values(modules)) {
      if (importer.moduleId === owner.moduleId) continue
      for (const item of importer.imports) {
        const resolvedPath = item.from.replace(/^\.\//, '')
        const relativeOwner = moduleSpecifier(importer.file, owner.file).replace(/^\.\//, '')
        if (resolvedPath !== relativeOwner && resolvedPath !== expectedSpecifier) continue
        for (const specifier of item.specifiers.filter((candidate) => candidate.imported === exported.exported)) {
          changedImporters.add(importer.moduleId)
          for (const consumer of importer.statements) {
            consumer.args = Object.fromEntries(Object.entries(consumer.args).map(([name, expression]) => [
              name,
              rewriteExpression(expression, (reference) => {
                if (reference.binding !== specifier.local) return reference
                const referencedPort = reference.output ?? sourcePort
                const referencedOutput = outputByKey.get(`${source.statementId}\0${referencedPort}`)
                return referencedOutput ? { ...reference, output: referencedOutput.name } : reference
              }),
            ]))
          }
        }
      }
    }
  }
  return { changed: [owner.moduleId, definitionModuleId, ...changedImporters] }
}

export function applyMoveStatement(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  command: Extract<AuthoringCommand, { type: 'moveStatement' }>,
): { changed: string[]; diagnostic?: SceneDiagnostic } {
  const index = owner.statements.findIndex((statement) => statement.statementId === command.statementId)
  const statement = owner.statements[index]
  if (!statement) return { changed: [], diagnostic: commandDiagnostic('SCENE_COMMAND_TARGET_NOT_FOUND', `Authoring entity '${command.statementId}' does not exist.`, 'resolve', command.statementId) }
  const target = (command.targetModuleId ? modules[command.targetModuleId] : undefined)
    ?? (command.targetFile ? Object.values(modules).find((module) => module.file === command.targetFile) : undefined)
    ?? owner
  if (target.moduleId === owner.moduleId) {
    owner.statements.splice(index, 1)
    const after = command.afterStatementId
      ? owner.statements.findIndex((item) => item.statementId === command.afterStatementId)
      : owner.statements.length - 1
    owner.statements.splice(after >= 0 ? after + 1 : 0, 0, statement)
    return { changed: [owner.moduleId] }
  }
  if (statement.binding && target.statements.some((item) => item.binding === statement.binding)) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_DUPLICATE_BINDING',
        `Binding '${statement.binding}' already exists in destination module '${target.file}'.`,
        'resolve',
        statement.statementId,
      ),
    }
  }
  const sourceBindings = new Map(owner.statements.flatMap((item) => item.binding ? [[item.binding, item] as const] : []))
  statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
    name,
    rewriteExpression(expression, (reference) => {
      const source = sourceBindings.get(reference.binding)
      if (!source || source.statementId === statement.statementId) return reference
      addExport(owner, source.binding!)
      const local = addImport(target, moduleSpecifier(target.file, owner.file), source.binding!)
      return { ...reference, binding: local }
    }),
  ]))
  const functionImport = owner.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ specifier }) => specifier.local === statement.functionName)
  if (functionImport) {
    const importedFile = resolveModuleFile(owner.file, functionImport.item.from)
    statement.functionName = addImport(
      target,
      functionImport.item.from.startsWith('.') ? moduleSpecifier(target.file, importedFile) : functionImport.item.from,
      functionImport.specifier.imported,
      statement.functionName,
    )
  }
  if (statement.binding) {
    const remainingConsumers = owner.statements.some((candidate) =>
      candidate.statementId !== statement.statementId
      && Object.values(candidate.args).some((expression) => referencesBinding(expression, statement.binding!)))
    const existingExports = owner.exports.filter((item) => item.local === statement.binding)
    if (remainingConsumers || existingExports.length) {
      addExport(target, statement.binding)
      const imported = addImport(owner, moduleSpecifier(owner.file, target.file), statement.binding)
      for (const candidate of owner.statements) {
        if (candidate.statementId === statement.statementId) continue
        candidate.args = Object.fromEntries(Object.entries(candidate.args).map(([name, expression]) => [
          name,
          rewriteExpression(expression, (reference) =>
            reference.binding === statement.binding ? { ...reference, binding: imported } : reference),
        ]))
      }
      for (const exported of existingExports) exported.local = imported
    }
  }
  owner.statements.splice(index, 1)
  statement.source = { ...statement.source, file: target.file }
  const after = command.afterStatementId
    ? target.statements.findIndex((item) => item.statementId === command.afterStatementId)
    : target.statements.length - 1
  target.statements.splice(after >= 0 ? after + 1 : 0, 0, statement)
  return { changed: [owner.moduleId, target.moduleId] }
}

export function findDefinition(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  functionName: string,
  resolveImport: (fromModuleId: string, specifier: string) => string,
): { module: SceneModuleAst; definition: SceneGroupDefinition } | undefined {
  const local = owner.definitions.find((definition) => definition.exportName === functionName)
  if (local) return { module: owner, definition: local }
  const imported = owner.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ specifier }) => specifier.local === functionName)
  if (!imported) return undefined
  const module = modules[resolveImport(owner.moduleId, imported.item.from)]
  const definition = module?.definitions.find((item) => item.exportName === imported.specifier.imported)
  return module && definition ? { module, definition } : undefined
}

export function inlineInstance(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  instance: SceneCallStatement,
  registry: ContractRegistry,
  actor: ActorKind,
  resolveImport: (fromModuleId: string, specifier: string) => string,
): { changed: string[]; diagnostic?: SceneDiagnostic } {
  const found = findDefinition(modules, owner, instance.functionName, resolveImport)
  if (!found) {
    const external = registry.get(instance.functionName)
    if (external?.kind === 'group' || external?.kind === 'template') {
      return {
        changed: [],
        diagnostic: commandDiagnostic(
          'SCENE_CAPABILITY_SEALED_INTERNAL',
          `Definition internals for '${instance.functionName}' are sealed outside this Scene Project.`,
          'capability',
          instance.statementId,
        ),
      }
    }
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_DEFINITION_NOT_FOUND',
        `Definition for '${instance.functionName}' is unavailable for inline.`,
        'resolve',
        instance.statementId,
      ),
    }
  }
  const contract = registry.get(instance.functionName)
  const sealed = found.definition.meta.sealed !== false
  const canInspect = !sealed || actor === 'template-maintainer' || actor === 'compiler'
    || (contract ? hasGroupCapability(contract, actor, 'inspectDefinition') : actor === 'user')
  if (!canInspect) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_CAPABILITY_SEALED_INTERNAL',
        `Actor '${actor}' cannot inline sealed Definition '${instance.functionName}'.`,
        'capability',
        instance.statementId,
      ),
    }
  }
  const definitionUses = Object.values(modules).flatMap((module) =>
    module.statements.filter((statement) => {
      const resolved = findDefinition(modules, module, statement.functionName, resolveImport)
      return resolved?.definition.definitionId === found.definition.definitionId
    }))
  const used = new Set(owner.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const bindingMap = new Map<string, string>()
  for (const inner of found.definition.body) {
    if (!inner.binding) continue
    bindingMap.set(inner.binding, uniqueName(inner.binding, used))
  }
  const argumentByParam = new Map(found.definition.paramNames.map((name) => [name, instance.args[name]]))
  const preserveInternalIds = definitionUses.length === 1
  const expanded = found.definition.body.map((inner) => ({
    ...inner,
    statementId: preserveInternalIds
      ? inner.statementId
      : stableEntityId('stmt', `${instance.statementId}:${inner.statementId}`),
    ...(inner.binding ? { binding: bindingMap.get(inner.binding)! } : {}),
    source: { ...inner.source, file: owner.file },
    args: Object.fromEntries(Object.entries(inner.args).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        const argument = argumentByParam.get(reference.binding)
        if (argument) return cloneExpression(argument)
        const binding = bindingMap.get(reference.binding)
        return binding ? { ...reference, binding } : reference
      }),
    ])),
  }))
  for (const inner of expanded) {
    const original = found.definition.body.find((item) =>
      item.statementId === inner.statementId
      || stableEntityId('stmt', `${instance.statementId}:${item.statementId}`) === inner.statementId)
    if (!original) continue
    const imported = found.module.imports
      .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === original.functionName)
    if (imported) {
      const importedFile = resolveModuleFile(found.module.file, imported.item.from)
      inner.functionName = addImport(
        owner,
        imported.item.from.startsWith('.') ? moduleSpecifier(owner.file, importedFile) : imported.item.from,
        imported.specifier.imported,
        original.functionName,
      )
    }
  }
  if (instance.binding) {
    const outputExpressions = new Map(Object.entries(found.definition.returnOutputs).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        const argument = argumentByParam.get(reference.binding)
        if (argument) return cloneExpression(argument)
        const binding = bindingMap.get(reference.binding)
        return binding ? { ...reference, binding } : reference
      }),
    ]))
    for (const statement of owner.statements) {
      if (statement === instance) continue
      statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
        name,
        rewriteExpression(expression, (reference) => {
          if (reference.binding !== instance.binding) return reference
          const outputName = reference.output ?? Object.keys(found.definition.meta.outputs)[0]
          return outputExpressions.get(outputName) ?? reference
        }),
      ]))
    }
    for (const exported of owner.exports.filter((item) => item.local === instance.binding)) {
      const first = outputExpressions.values().next().value as SceneExpression | undefined
      if (first?.kind === 'reference') exported.local = first.binding
    }
  }
  const index = owner.statements.indexOf(instance)
  owner.statements.splice(index, 1, ...expanded)
  return { changed: [owner.moduleId] }
}

