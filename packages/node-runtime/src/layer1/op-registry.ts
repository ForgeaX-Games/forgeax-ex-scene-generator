// Op registry — register / query / list ops at runtime.
//
// Plugins call register(spec) at boot to add their domain ops; the dispatcher
// + executor resolve ops by id at execution time. Registry instances are
// process-local; cross-plugin op sharing happens at the manifest level, not
// through a shared registry.

import type { OpSpec } from './types/op-spec.js'

// In-memory op registry. Plugins call register at boot to add their domain ops;
// the executor resolves an op by id at execution time.
export class OpRegistry {
  private readonly ops = new Map<string, OpSpec>()

  register(spec: OpSpec): void {
    if (this.ops.has(spec.id)) {
      throw new Error(`Op id already registered: ${spec.id}`)
    }
    this.ops.set(spec.id, spec)
  }

  get(id: string): OpSpec | undefined {
    return this.ops.get(id)
  }

  list(): readonly OpSpec[] {
    return [...this.ops.values()]
  }

  has(id: string): boolean {
    return this.ops.has(id)
  }

  // Remove an op. Used by the battery loader during update / removal events.
  unregister(id: string): boolean {
    return this.ops.delete(id)
  }

  // Replace an op atomically (delete + register). Used by hot reload.
  replace(spec: OpSpec): void {
    this.ops.delete(spec.id)
    this.ops.set(spec.id, spec)
  }
}

/**
 * Read-only platform base plus a mutable local overlay. get/list/has merge;
 * register/replace/unregister may only mutate the local layer and must not
 * shadow a platform opId.
 */
export class OverlayOpRegistry extends OpRegistry {
  constructor(private readonly base: OpRegistry) {
    super()
  }

  override get(id: string): OpSpec | undefined {
    return super.get(id) ?? this.base.get(id)
  }

  override has(id: string): boolean {
    return super.has(id) || this.base.has(id)
  }

  override list(): readonly OpSpec[] {
    const merged = new Map<string, OpSpec>()
    for (const spec of this.base.list()) merged.set(spec.id, spec)
    for (const spec of super.list()) merged.set(spec.id, spec)
    return [...merged.values()]
  }

  override register(spec: OpSpec): void {
    if (this.base.has(spec.id)) {
      throw new Error(`cannot shadow platform op: ${spec.id}`)
    }
    super.register(spec)
  }

  override replace(spec: OpSpec): void {
    if (this.base.has(spec.id) && !super.has(spec.id)) {
      throw new Error(`cannot replace platform op from overlay: ${spec.id}`)
    }
    super.replace(spec)
  }

  override unregister(id: string): boolean {
    if (!super.has(id)) return false
    return super.unregister(id)
  }

  listLocal(): readonly OpSpec[] {
    return super.list()
  }
}

// Default singleton registry (most callers use this).
export const defaultRegistry = new OpRegistry()
