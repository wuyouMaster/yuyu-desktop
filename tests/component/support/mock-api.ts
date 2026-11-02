/** Install only the preload methods exercised by an isolated component test. */
export function installMockApi(api: Partial<Window['api']>): void {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: api })
}
