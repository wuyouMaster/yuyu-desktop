import type { FunctionTool } from '@openai/agents-core'

/** Model parallel-call preferences are advisory; enforce ordering at the host. */
export function serialTools<T extends Array<Pick<FunctionTool, 'name' | 'invoke'>>>(
  tools: T,
  before: (name: string) => void,
  observe?: (name: string, work: () => Promise<unknown>) => Promise<unknown>
): T {
  let tail: Promise<unknown> = Promise.resolve()
  return tools.map((entry) => ({
    ...entry,
    invoke: (...args: Parameters<FunctionTool['invoke']>) => {
      const next = tail.then(() => {
        before(entry.name)
        return observe ? observe(entry.name, () => entry.invoke(...args)) : entry.invoke(...args)
      })
      tail = next.catch(() => undefined)
      return next
    }
  })) as T
}
