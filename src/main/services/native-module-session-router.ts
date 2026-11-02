import { randomUUID } from 'crypto'
import type { NativeModuleCallRequest } from '../../shared/native-modules'
import type { NativeModuleProvider } from './native-module-compatibility-service'

interface Binding {
  module: string
  owner: NativeModuleProvider
  ownerGeneration: number
  nativeId: string
  parent?: string
  tail: Promise<void>
  closing: boolean
  closed: boolean
}

/** Opaque session ownership plus serialized lifecycle operations. ABI tokens never select providers. */
export class NativeModuleSessionRouter {
  private readonly bindings = new Map<string, Binding>()
  private readonly generations = new WeakMap<NativeModuleProvider, number>()

  revoke(provider: NativeModuleProvider): void {
    this.generations.set(provider, (this.generations.get(provider) ?? 0) + 1)
  }

  async invoke(
    request: NativeModuleCallRequest,
    pick: () => Promise<NativeModuleProvider>,
    ready: (provider: NativeModuleProvider, operation: string) => Promise<boolean>
  ): Promise<{ provider: NativeModuleProvider; value: unknown }> {
    const { id, operation } = request
    const input = (request.input ?? {}) as Record<string, unknown>
    const createsSession =
      operation === 'database.open' ||
      operation === 'sync.open' ||
      (id === 'xsend-helper' && operation === 'send.create')
    const sessionField =
      id === 'wxdb' && !createsSession
        ? 'databaseSessionId'
        : (id === 'wxsync' && !createsSession) ||
            (id === 'xsend-helper' &&
              operation !== 'send.create' &&
              operation !== 'send.validate_key')
          ? 'sessionId'
          : undefined
    const token = sessionField ? String(input[sessionField]) : undefined
    const root = token ? this.bindings.get(token) : undefined
    if (
      sessionField &&
      (!root || root.module !== id || root.parent || root.closing || root.closed)
    ) {
      throw new Error('Unknown or closing native session')
    }
    const cursorToken =
      operation === 'database.message_cursor_fetch' || operation === 'database.message_cursor_close'
        ? String(input.cursorId)
        : undefined
    const cursor = cursorToken ? this.bindings.get(cursorToken) : undefined
    if (cursorToken && (!cursor || cursor.parent !== token || cursor.closing || cursor.closed)) {
      throw new Error('Cursor does not belong to this database session')
    }
    const createsCursor = operation === 'database.message_cursor_open'
    const closes =
      operation === 'database.close' ||
      operation === 'sync.close' ||
      (id === 'xsend-helper' && operation === 'send.close') ||
      operation === 'database.message_cursor_close'
    const closing = closes ? (cursor ?? root) : undefined
    if (closing) closing.closing = true // reject new calls immediately; earlier calls drain first

    const run = async (): Promise<{ provider: NativeModuleProvider; value: unknown }> => {
      try {
        const provider = root?.owner ?? (await pick())
        const ownerGeneration = root?.ownerGeneration ?? this.generations.get(provider) ?? 0
        if (!provider.invoke || !provider.registration.manifest.capabilities.includes(operation)) {
          throw new Error('Session owner does not implement ' + operation)
        }
        // Cleanup must remain possible after binary health degrades. The owning
        // adapter is responsible for safe/idempotent release, never another provider.
        if (
          root &&
          !closes &&
          (!(await ready(provider, operation)) ||
            ownerGeneration !== (this.generations.get(provider) ?? 0))
        ) {
          throw new Error('Native session owner is unavailable')
        }
        // Cursor creation bypasses selection because the database already has an
        // owner. Check its cleanup capability here before allocating a cursor.
        if (
          createsCursor &&
          (!provider.registration.manifest.capabilities.includes('database.message_cursor_close') ||
            !(await ready(provider, 'database.message_cursor_close')))
        ) {
          throw new Error('Session owner cannot close message cursors')
        }
        const translated = { ...input }
        if (sessionField && root) translated[sessionField] = root.nativeId
        if (cursor) translated.cursorId = cursor.nativeId
        if (operation === 'database.close' && root) {
          // Drain children before releasing their database handle. A failed close
          // keeps the parent/remaining children bound so the caller can retry.
          for (const [childToken, child] of this.bindings) {
            if (child.parent !== token) continue
            const released = await provider.invoke('database.message_cursor_close', {
              databaseSessionId: root.nativeId,
              cursorId: child.nativeId
            })
            if (
              !released ||
              typeof released !== 'object' ||
              (released as { closed?: boolean }).closed !== true
            ) {
              throw new Error('Failed to close database cursor')
            }
            child.closed = true
            this.bindings.delete(childToken)
          }
        }
        let value = await provider.invoke(operation, sessionField ? translated : request.input)
        if (createsSession || createsCursor) {
          const field = createsCursor ? 'cursorId' : 'sessionId'
          const nativeId =
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)[field]
              : undefined
          if (typeof nativeId !== 'string' || !nativeId)
            throw new Error('Invalid native session result')
          const publicId = randomUUID()
          this.bindings.set(publicId, {
            module: id,
            owner: provider,
            ownerGeneration,
            nativeId,
            parent: createsCursor ? token : undefined,
            tail: Promise.resolve(),
            closing: false,
            closed: false
          })
          value = { ...(value as Record<string, unknown>), [field]: publicId }
        }
        if (
          closing &&
          value &&
          typeof value === 'object' &&
          (value as { closed?: boolean }).closed === true
        ) {
          closing.closed = true
          const closedToken = cursorToken ?? token!
          this.bindings.delete(closedToken)
          for (const [childToken, child] of this.bindings) {
            if (child.parent === closedToken) {
              child.closed = true
              this.bindings.delete(childToken)
            }
          }
        }
        return { provider, value }
      } finally {
        if (closing) closing.closing = false
      }
    }
    if (!root) return run()
    const pending = root.tail.then(run)
    root.tail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }
}
