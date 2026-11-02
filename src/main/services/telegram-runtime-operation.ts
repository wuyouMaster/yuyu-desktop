/** Telegram's foreground UI is shared across accounts and history/send operations.
 * Keep this module shared by all runtime consumers; never queue a stale UI action.
 */
export class TelegramRuntimeBusyError extends Error {
  readonly code = 'telegram_runtime_busy'

  constructor() {
    super('Telegram 正在执行另一项本地操作，请稍后重试')
    this.name = 'TelegramRuntimeBusyError'
  }
}

/** An opaque object unique to one connection generation, never an account ID. */
export type TelegramRuntimeOperationOwner = object

export class TelegramRuntimeCancelledError extends Error {
  readonly code = 'telegram_runtime_cancelled'

  constructor() {
    super('Telegram 本地操作已取消，数据源已切换或应用正在退出')
    this.name = 'TelegramRuntimeCancelledError'
  }
}

interface RunningOperation {
  owner?: TelegramRuntimeOperationOwner
  controller: AbortController
  settled: Promise<void>
}

let running: RunningOperation | undefined
const cancelledOwners = new WeakSet<TelegramRuntimeOperationOwner>()

export async function withTelegramRuntimeOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  owner?: TelegramRuntimeOperationOwner
): Promise<T> {
  if (owner && cancelledOwners.has(owner)) throw new TelegramRuntimeCancelledError()
  if (running) throw new TelegramRuntimeBusyError()
  let settle!: () => void
  const current: RunningOperation = {
    owner,
    controller: new AbortController(),
    settled: new Promise<void>((resolve) => {
      settle = resolve
    })
  }
  running = current
  try {
    const result = await operation(current.controller.signal)
    current.controller.signal.throwIfAborted()
    return result
  } finally {
    // An abort requests cancellation; it does not prove that a child has exited.
    // Callers must settle only after their native work has stopped.
    running = undefined
    settle()
  }
}

/** Synchronously notify only this connection, and refuse future work on it. */
export function cancelTelegramRuntimeOperations(owner: TelegramRuntimeOperationOwner): void {
  cancelledOwners.add(owner)
  if (running?.owner === owner) {
    running.controller.abort(new TelegramRuntimeCancelledError())
  }
}

/** Wait for work already in flight. With an owner, unrelated connections are excluded. */
export function waitForTelegramRuntimeOperations(
  owner?: TelegramRuntimeOperationOwner
): Promise<void> {
  return running && (owner === undefined || running.owner === owner)
    ? running.settled
    : Promise.resolve()
}

/** Compatibility alias for send-only callers. Both names use the same lock. */
export const runExclusive = withTelegramRuntimeOperation
