import type {
  AtomicNodeFunctionContract,
  NodeFunctionContract,
  PortAccess,
  PortContract,
  ScenePortTypeName,
} from '../model/types.js'
import { normalizePortTypeName, portContractForType } from './portTypes.js'

export const LOCAL_GENERATOR_OP_PREFIX = 'local/'

export const DEFAULT_GENERATOR_VERSION = '1'

export function normalizeGeneratorVersion(version: string | number | undefined): string {
  if (typeof version === 'number') return String(version)
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : DEFAULT_GENERATOR_VERSION
}

export interface GeneratorPortDescriptor {
  type: ScenePortTypeName | string
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
> = Omit<GeneratorDefinition<TInputs, TOutputs>, 'version' | 'id'> & {
  id?: string
  version?: string | number
}

export function localGeneratorOpId(definitionId: string): string {
  return `${LOCAL_GENERATOR_OP_PREFIX}${definitionId}`
}

function inferredAccess(descriptor: GeneratorPortDescriptor): PortAccess | undefined {
  if (descriptor.access) return descriptor.access
  if (typeof descriptor.runtimeType === 'string' && descriptor.runtimeType.endsWith('-list')) return 'list'
  const canonical = normalizePortTypeName(typeof descriptor.type === 'string' ? descriptor.type : undefined)
  if (canonical === 'NumberList' || canonical === 'StringList') return 'list'
  return undefined
}

function portFromDescriptor(name: string, descriptor: GeneratorPortDescriptor): PortContract {
  const canonical = normalizePortTypeName(descriptor.type) ?? 'Any'
  const base = portContractForType(name, canonical)
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

export type GeneratorFn<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> = ((args?: TInputs) => TOutputs | Promise<TOutputs>) & GeneratorDefinition<TInputs, TOutputs>

function defaultGeneratorContext(seed = 1): GeneratorContext {
  const mulberry = (value: number) => {
    let t = value >>> 0
    return () => {
      t += 0x6d2b79f5
      let r = Math.imul(t ^ (t >>> 15), 1 | t)
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }
  let stream = mulberry(seed)
  return {
    seed,
    random: (salt) => (salt === undefined ? stream() : mulberry(seed + salt)()),
    rng: (salt) => mulberry(salt === undefined ? seed + Math.floor(stream() * 1e9) : seed + salt),
    log: () => undefined,
    signal: new AbortController().signal,
  }
}

/**
 * Project-local Generator. Static AST parse remains the Contract source.
 * The returned value is also callable so Scene Script can `import` and invoke it.
 */
export function defineGenerator<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
>(definition: GeneratorDefinitionInput<TInputs, TOutputs>): GeneratorFn<TInputs, TOutputs> {
  const id = typeof definition.id === 'string' && definition.id.trim() ? definition.id.trim() : 'anonymous-generator'
  if (typeof definition.run !== 'function') {
    throw new TypeError('defineGenerator requires a run implementation')
  }
  const normalized: GeneratorDefinition<TInputs, TOutputs> = {
    ...definition,
    id,
    version: normalizeGeneratorVersion(definition.version),
  }
  const fn = ((args: TInputs = {} as TInputs) => normalized.run(defaultGeneratorContext(), args)) as GeneratorFn<TInputs, TOutputs>
  return Object.assign(fn, normalized)
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
