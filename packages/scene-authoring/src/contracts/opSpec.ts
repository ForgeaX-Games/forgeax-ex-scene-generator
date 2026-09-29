import type { OpAccess, OpInput, OpOutput, OpSpec } from '@forgeax/node-runtime'

import { parseAtomicContractSource } from '../language/atomic-parser.js'
import type { AtomicNodeFunctionContract, PortAccess, PortContract } from '../model/types.js'

function accessOf(value: PortAccess | undefined): OpAccess | undefined {
  if (value === 'item' || value === 'list' || value === 'tree') return value
  return undefined
}

function mapInput(port: PortContract): OpInput {
  return {
    name: port.name,
    type: port.type,
    required: port.required ?? true,
    default: port.defaultValue as OpInput['default'],
    description: port.description ?? '',
    label: port.label,
    options: port.options,
    access: accessOf(port.access),
  }
}

function mapOutput(port: PortContract): OpOutput {
  return {
    name: port.name,
    type: port.type,
    description: port.description ?? '',
    label: port.label,
    access: accessOf(port.access),
  }
}

/** Derive the kernel OpSpec slice from a parsed atomic contract. Execute is filled by the loader. */
export function contractToOpSpec(contract: AtomicNodeFunctionContract): Omit<OpSpec, 'execute'> {
  const nameEn = contract.nameEn
  return {
    id: contract.opId,
    name: contract.label ?? nameEn ?? contract.functionName,
    nameEn,
    description: contract.description ?? '',
    inputs: contract.inputs.map(mapInput),
    outputs: contract.outputs.map(mapOutput),
    params: [],
    lacing: 'longest',
    manualTrigger: contract.canvas?.nodeType === 'ai_battery',
  }
}

/** Loader hook: parse a `scene.contract.ts` source buffer into the kernel OpSpec slice. */
export function parseBatteryContractSpec(dir: string, source: string): Omit<OpSpec, 'execute'> {
  const file = `${dir.replace(/\\/g, '/')}/scene.contract.ts`
  const parsed = parseAtomicContractSource(source, file)
  if (parsed.diagnostics.length > 0) {
    throw new Error(parsed.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'))
  }
  if (parsed.contracts.length !== 1) {
    throw new Error(`expected exactly one defineAtomic in ${file}, got ${parsed.contracts.length}`)
  }
  return contractToOpSpec(parsed.contracts[0]!)
}
