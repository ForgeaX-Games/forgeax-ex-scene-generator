// Pure parser: BatteryMeta JSON → OpSpec (the kernel slice only). The plugin reads its own copy of the same meta.json for UI projection (icon, colour, tags, displayGroup, etc.); this parser lives in the kernel and never touches those fields.

import type { DynamicPortsConfig, OpAccess, OpEngineBehavior, OpInput, OpLacingMode, OpOutput, OpParam, OpSpec } from '../types/op-spec.js'
import type { BatteryMeta, BatteryMetaDynamicConfig, BatteryMetaParam, BatteryMetaPort } from './types.js'

// Field sanitizers: coerce untrusted meta.json values down to the kernel's legal enums, returning undefined on anything off-list.
function sanitizeAccess(value: unknown): OpAccess | undefined {
  if (value === 'item' || value === 'list' || value === 'tree') return value
  return undefined
}

function sanitizeLacing(value: unknown): OpLacingMode | undefined {
  if (value === 'longest' || value === 'shortest' || value === 'cross' || value === 'pairwise') {
    return value
  }
  return undefined
}

function sanitizeEngineBehavior(value: unknown): OpEngineBehavior | undefined {
  if (value === 'loopUnpack') return value
  return undefined
}

// Resolve the manual-trigger gate: an explicit meta.manualTrigger always wins, otherwise infer it only from the unambiguous render signal frontend.nodeType === 'ai_battery' (the AINode component, the only canvas node carrying a Run button). We deliberately do not infer from the 'ai' big-tag / directory bucket, because that bucket also holds pure-logic batteries (e.g. name_list_gen, prompt_dealer) that must keep auto-executing; ops that call an AI API but are not rendered as AINode opt in explicitly.
function resolveManualTrigger(meta: BatteryMeta): boolean {
  if (typeof meta.manualTrigger === 'boolean') return meta.manualTrigger
  if (meta.frontend?.nodeType === 'ai_battery') return true
  return false
}

// Per-declaration mappers: turn each loose meta port/param into the strict OpSpec shape, applying defaults for omitted fields.
function parseInput(p: BatteryMetaPort): OpInput {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    required: p.required ?? true,
    default: p.default as OpInput['default'],
    description: p.description ?? '',
    descriptionEn: p['description-en'],
    label: p.label,
    options: p.options,
    access: sanitizeAccess(p.access),
  }
}

function parseOutput(p: BatteryMetaPort): OpOutput {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    description: p.description ?? '',
    descriptionEn: p['description-en'],
    label: p.label,
    access: sanitizeAccess(p.access),
  }
}

function parseParam(p: BatteryMetaParam): OpParam {
  return {
    name: p.name ?? '',
    type: p.type ?? 'string',
    default: p.default as OpParam['default'],
    description: p.description ?? '',
    options: p.options,
    min: p.min,
    max: p.max,
    label: p.label,
  }
}

function parseDynamicConfig(
  cfg: BatteryMetaDynamicConfig | undefined,
  defaultMinCount: number,
): DynamicPortsConfig | undefined {
  if (!cfg) return undefined
  return {
    prefix: cfg.prefix ?? 'item_',
    labelTemplate: cfg.labelTemplate ?? '[$i]',
    minCount: cfg.minCount ?? defaultMinCount,
    type: cfg.type ?? 'any',
    access: sanitizeAccess(cfg.access),
  }
}

// Assemble a BatteryMeta into an OpSpec stub: resolve the id (explicit or fallback) and the multi-language display name, map ports/params/dynamic configs, and apply dispatcher defaults (lacing 'longest', etc.). The execute function is left out — the loader fills it in after dynamic-importing the battery's index.ts.
export function metaToOpSpec(
  meta: BatteryMeta,
  fallbackId: string,
): Omit<OpSpec, 'execute'> {
  const id = meta.id ?? fallbackId
  const nameZh = meta['name-zh']
  const nameEn = meta['name-en']
  const name = nameZh ?? meta.label ?? meta.name ?? nameEn ?? fallbackId

  return {
    id,
    name,
    nameEn,
    description: meta.description ?? '',
    descriptionEn: meta['description-en'],
    inputs: (meta.inputs ?? []).map(parseInput),
    outputs: (meta.outputs ?? []).map(parseOutput),
    params: (meta.params ?? []).map(parseParam),
    dynamicInputs: parseDynamicConfig(meta.dynamicInputs, 2),
    dynamicOutputs: parseDynamicConfig(meta.dynamicOutputs, 1),
    lacing: sanitizeLacing(meta.lacing) ?? 'longest',
    principal: typeof meta.principal === 'string' && meta.principal.trim() ? meta.principal : undefined,
    engineBehavior: sanitizeEngineBehavior(meta.engineBehavior),
    manualTrigger: resolveManualTrigger(meta),
  }
}
