import type { CapabilityProvider } from '../../shared/capability-provider'
export type { CapabilityProvider } from '../../shared/capability-provider'

export class CapabilityUnavailableError extends Error {
  readonly code = 'CAPABILITY_UNAVAILABLE'
}

/** A registry belongs to one source/account. Binding never merges identities. */
export class CapabilityProviderRegistry<T extends object> {
  private generation = 0
  private readonly providers = new Map<string, CapabilityProvider<T>>()

  constructor(
    private readonly source: string,
    private readonly accountId: string,
    private readonly protocolVersion: number,
    private readonly methods: readonly (keyof T)[]
  ) {}

  register(provider: CapabilityProvider<T>): void {
    if (provider.source !== this.source || provider.accountId !== this.accountId) {
      throw new Error('Capability provider belongs to a different source/account')
    }
    if (provider.protocolVersion !== this.protocolVersion) {
      throw new Error('Unsupported capability protocol version')
    }
    if (!provider.id.trim() || this.providers.has(provider.id)) {
      throw new Error('Duplicate or empty capability provider id')
    }
    for (const key of this.methods) {
      const value = provider.implementation[key]
      if (value !== undefined && typeof value !== 'function') {
        throw new Error('Capability must be callable: ' + String(key))
      }
    }
    this.providers.set(provider.id, { ...provider })
  }

  unregister(id: string): boolean {
    return this.providers.delete(id)
  }

  /** Revoke previously bound ports when their account is closed or replaced. */
  clear(): void {
    this.generation += 1
    this.providers.clear()
  }

  private ready(provider: CapabilityProvider<T>, required: readonly (keyof T)[]): boolean {
    if (this.providers.get(provider.id) !== provider) return false
    try {
      const health = provider.health()
      return (
        health.state === 'ready' &&
        required.every(
          (key) =>
            typeof provider.implementation[key] === 'function' &&
            (health.capabilities?.[key] ?? 'ready') === 'ready'
        )
      )
    } catch {
      return false
    }
  }

  /** Narrow consumers can bind a subset; complete ports require every method. */
  resolve<K extends keyof T>(required: readonly K[]): { providerId: string; port: Pick<T, K> } {
    if (required.some((key) => !this.methods.includes(key))) {
      throw new CapabilityUnavailableError('Unknown protocol capability')
    }
    const provider = [...this.providers.values()]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .find((candidate) => this.ready(candidate, required))
    if (!provider) {
      throw new CapabilityUnavailableError(
        'No provider covers required capabilities: ' + required.join(', ')
      )
    }
    const generation = this.generation
    const port = {} as Pick<T, K>
    for (const key of required) {
      const method = provider.implementation[key] as (...args: unknown[]) => unknown
      // Pin one provider for the whole request surface. Never retry a failed call
      // through another implementation, which may use a different snapshot.
      port[key] = ((...args: unknown[]) => {
        if (generation !== this.generation || !this.ready(provider, [key])) {
          throw new CapabilityUnavailableError('Capability became unavailable: ' + String(key))
        }
        return method.apply(provider.implementation, args)
      }) as T[K]
    }
    return { providerId: provider.id, port }
  }

  resolveComplete(): { providerId: string; port: T } {
    return this.resolve(this.methods)
  }
}

/** Compile-time exhaustive inventories: a new protocol method must enter selection checks. */
export function protocolMethods<T extends object>(
  methods: Record<keyof T, true>
): readonly (keyof T)[] {
  return Object.freeze(Object.keys(methods) as (keyof T)[])
}
