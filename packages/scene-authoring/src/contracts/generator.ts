import type {
  AtomicNodeFunctionContract,
  NodeFunctionContract,
  PortAccess,
  PortContract,
  ScenePortTypeName,
} from '../model/types.js'
import { isScenePortTypeName, portContractForType } from './portTypes.js'

export const LOCAL_GENERATOR_OP_PREFIX = 'local/'

export const DEFAULT_GENERATOR_VERSION = '1'

export function normalizeGeneratorVersion(version: string | undefined): string {
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : DEFAULT_GENERATOR_VERSION
}

export interface GeneratorPortDescriptor {
  type: ScenePortTypeName
  runtimeType?: string
  runtimePort?: string
  access?: PortAccess
  required?: boolean
  mode?: 'parameter' | 'value'
  label?: string
  description?: string
  order?: number
  defaultValue?: string | number | boolean | null
  control?: boolean
}

export interface GeneratorDefinitionMeta {
  id: string
  version: string
  description?: string
  inputs: Record<string, GeneratorPortDescriptor>
  outputs: Record<string, GeneratorPortDescriptor>
}

export interface GeneratorContext {
  /** Invocation seed supplied by the host. */
  seed: number
  /**
   * Deterministic sample in [0, 1).
   * `random()` advances the invocation stream.
   * `random(salt)` is a one-shot from that salt and does not advance the stream.
   */
  random: (salt?: number) => number
  /** Independent stream from `salt`, or a fresh stream from the invocation seed. */
  rng: (salt?: number) => () => number
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
  signal: AbortSignal
}

export interface GeneratorDefinition<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> extends GeneratorDefinitionMeta {
  run: (ctx: GeneratorContext, args: TInputs) => TOutputs | Promise<TOutputs>
}

export type GeneratorDefinitionInput<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> = Omit<GeneratorDefinition<TInputs, TOutputs>, 'version'> & {
  version?: string
}

export function localGeneratorOpId(definitionId: string): string {
  return `${LOCAL_GENERATOR_OP_PREFIX}${definitionId}`
}

function inferredAccess(descriptor: GeneratorPortDescriptor): PortAccess | undefined {
  if (descriptor.access) return descriptor.access
  if (typeof descriptor.runtimeType === 'string' && descriptor.runtimeType.endsWith('-list')) return 'list'
  return undefined
}

function portFromDescriptor(name: string, descriptor: GeneratorPortDescriptor): PortContract {
  if (!isScenePortTypeName(descriptor.type)) {
    throw new TypeError(`defineGenerator port '${name}' uses unknown Scene type '${descriptor.type}'`)
  }
  const base = portContractForType(name, descriptor.type)
  const access = inferredAccess(descriptor)
  const runtimeType = descriptor.runtimeType ?? base.runtimeType
  return {
    ...base,
    ...(access ? { access } : {}),
    ...(runtimeType ? { runtimeType } : {}),
    ...(descriptor.required !== undefined ? { required: descriptor.required } : {}),
    ...(descriptor.defaultValue !== undefined ? { defaultValue: descriptor.defaultValue } : {}),
    ...(descriptor.runtimePort ? { runtimePort: descriptor.runtimePort } : {}),
    ...(descriptor.description ? { description: descriptor.description } : {}),
    ...(descriptor.label ? { label: descriptor.label } : {}),
    ...(descriptor.order !== undefined ? { order: descriptor.order } : {}),
    ...(descriptor.mode ? { mode: descriptor.mode } : {}),
    ...(descriptor.control ? { control: true } : {}),
  }
}

/**
 * Type-only helper for project-local Generators. The host never executes this
 * to read a Contract; static AST parse is the only allowed Contract source.
 */
export function defineGenerator<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
>(definition: GeneratorDefinitionInput<TInputs, TOutputs>): GeneratorDefinition<TInputs, TOutputs> {
  if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    throw new TypeError('defineGenerator requires a non-empty id')
  }
  if (typeof definition.run !== 'function') {
    throw new TypeError('defineGenerator requires a run implementation')
  }
  return { ...definition, version: normalizeGeneratorVersion(definition.version) }
}

export function generatorContractFromMeta(
  exportName: string,
  meta: GeneratorDefinitionMeta,
  sourceFile?: string,
): AtomicNodeFunctionContract {
  const version = normalizeGeneratorVersion(meta.version)
  const contract: NodeFunctionContract = {
    functionName: exportName,
    kind: 'atomic',
    contractVersion: version,
    opId: localGeneratorOpId(meta.id),
    definitionId: meta.id,
    definitionVersion: version,
    description: meta.description ?? `Project Generator ${exportName}`,
    inputs: Object.entries(meta.inputs).map(([name, descriptor]) => portFromDescriptor(name, descriptor)),
    outputs: Object.entries(meta.outputs).map(([name, descriptor]) => portFromDescriptor(name, descriptor)),
    deterministic: true,
    contextDependencies: ['seed'],
    sourceKind: 'generator',
    ...(sourceFile ? { sourceFile } : {}),
  }
  return contract as AtomicNodeFunctionContract
}
