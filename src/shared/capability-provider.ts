/** Application protocols are separate from native ABI operation catalogs. */
export type CapabilityState = 'ready' | 'unavailable' | 'inspected'

export interface CapabilityProvider<T extends object> {
  id: string
  source: string
  accountId: string
  protocolVersion: number
  priority?: number
  implementation: Partial<T>
  /** Synchronous readiness snapshot, refreshed by the adapter's own transport. */
  health(): {
    state: CapabilityState
    capabilities?: Partial<Record<keyof T, CapabilityState>>
  }
}
