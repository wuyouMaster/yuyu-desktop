import { RuntimeRpcError } from '../../shared/runtime-rpc'

type Source = {
  observeAsync(options: { signal: AbortSignal }): Promise<string>
}

/** Coalesced invalidation of committed data, not a row journal. One poll at a
 * time; stop aborts in-flight work and invalidates all outstanding callbacks. */
export class WechatDatabaseMonitor {
  private owner?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly source: Source) {}

  async start(
    changed: (type: string, json: string) => void,
    failed: (error: unknown) => void,
    intervalMs = 1000
  ): Promise<boolean> {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 10000)
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    if (this.owner) throw new RuntimeRpcError('MONITOR_ALREADY_STARTED')
    const owner = new AbortController()
    this.owner = owner
    let previous: string
    try {
      previous = await this.source.observeAsync({ signal: owner.signal })
    } catch (error) {
      const canceled = owner.signal.aborted
      if (this.owner === owner) this.stop()
      if (canceled) return false
      throw error
    }
    if (this.owner !== owner) return false
    const poll = async () => {
      if (this.owner !== owner) return
      try {
        const next = await this.source.observeAsync({ signal: owner.signal })
        if (this.owner !== owner) return
        if (next !== previous) {
          previous = next
          changed('update', JSON.stringify({ action: 'update' }))
        }
      } catch (error) {
        if (this.owner === owner) {
          this.stop()
          failed(error)
        }
        return
      }
      if (this.owner === owner) this.timer = setTimeout(poll, intervalMs)
    }
    this.timer = setTimeout(poll, intervalMs)
    return true
  }

  stop(): void {
    const owner = this.owner
    this.owner = undefined
    owner?.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
