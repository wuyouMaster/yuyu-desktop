import type { IdentityContextProvider } from '../../shared/source-context'
import type { ReadProvider, SendProvider, WatchProvider } from '../../shared/data-source'

export interface DataSourceRegistration {
  context?: IdentityContextProvider
  read: ReadProvider
  send?: SendProvider
  watch?: WatchProvider
}

export function validateRegistration({ read, send, watch, context }: DataSourceRegistration): void {
  for (const provider of [send, watch, context]) {
    if (provider && (provider.source !== read.source || provider.accountId !== read.accountId)) {
      throw new Error('数据源的读写能力与身份上下文必须属于同一账号')
    }
  }
  if (context && (!read.contextAware || (send && !send.contextAware))) {
    throw new Error('多身份数据源必须提供支持上下文校验的读写能力')
  }
  if (!context && (read.contextAware || send?.contextAware)) {
    throw new Error('支持身份上下文的能力必须注册身份提供方')
  }
  // Watch events lack a context envelope today; never silently mix identities.
  if (context && watch) throw new Error('多身份数据源暂不支持实时监听')
}

/** Registers a complete source boundary; individual fields are not merged here. */
export class DataSourceRegistry {
  private readonly registrations = new Map<string, DataSourceRegistration>()

  register(registration: DataSourceRegistration): void {
    validateRegistration(registration)
    const key = [registration.read.source, registration.read.accountId].join(':')
    if (this.registrations.has(key)) throw new Error('Data source already registered: ' + key)
    this.registrations.set(key, registration)
  }

  get(source: string, accountId: string): DataSourceRegistration | undefined {
    return this.registrations.get([source, accountId].join(':'))
  }

  list(): DataSourceRegistration[] {
    return Array.from(this.registrations.values())
  }

  clear(): void {
    this.registrations.clear()
  }
}
