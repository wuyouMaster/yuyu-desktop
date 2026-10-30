import type { DatabaseProviderRegistration } from './database-capability'

/** Main-process credentials. Never serialize these options into diagnostics or renderer IPC. */
export interface DatabaseOpenOptions {
  rawKey: string
  accountRoot?: string
}

export interface DatabaseLifecyclePort {
  /** Idempotent. Prevent further reads/events; release resources only when safe. */
  close(): void
  /** Cancel observation, drain in-flight work within the budget, then release resources.
   * Return false if draining timed out. Never free resources still in use. */
  closeAsync(timeoutMs?: number): Promise<boolean>
}

export interface DatabaseObservationPort {
  /** One subscription per connection; callback payload preserves the existing event envelope. */
  startMonitor(callback: (type: string, json: string) => void): Promise<boolean>
  stopMonitor(): void
}

export interface DatabaseRecallJournalPort {
  /** Explicit opt-in mutation, separate from the read-only database protocol. */
  installRecallJournal(usernames: string[]): { installed: number; failed: number }
}

/** All facets belong to the SAME open connection; never combine independently selected owners. */
export interface DatabaseConnectionRegistration extends DatabaseProviderRegistration {
  lifecycle: DatabaseLifecyclePort
  observation?: DatabaseObservationPort
  recallJournal?: DatabaseRecallJournalPort
}

/** Registered once per data source. Selecting a factory does not open an account. */
export interface DatabaseRuntimePort {
  bootstrap(): Promise<void>
  open(options: DatabaseOpenOptions): DatabaseConnectionRegistration
  openAsync(options: DatabaseOpenOptions): Promise<DatabaseConnectionRegistration>
}
