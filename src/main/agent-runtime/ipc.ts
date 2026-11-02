import { conversationHistorySchema } from '../services/conversation-chat-service'
import { z } from 'zod'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentRuntimeHost } from './host'

const scopeSchema = z.object({
  scope: z.object({ kind: z.literal('current'), conversationId: z.string().min(1).max(256) }),
  label: z.string().max(300).optional()
})
const requestSchema = z.object({
  requestId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(32000),
  scope: scopeSchema,
  history: conversationHistorySchema.optional(),
  mode: z.enum(['auto', 'plan']).optional(),
  resumeRunId: z.string().min(1).max(128).optional(),
  quotes: z
    .array(
      z.object({
        sender: z.string().max(300),
        text: z.string().max(16000),
        conversationId: z.string().min(1).max(256),
        provenance: z.literal('user-provided')
      })
    )
    .max(30)
    .optional()
})

/** Desktop only. Renderer identity and account partition are assigned by the host. */
export function registerAgentRuntimeIpc(
  ipc: Pick<IpcMain, 'handle'>,
  host: AgentRuntimeHost,
  account: () => string
): void {
  const observed = new WeakMap<Electron.WebContents, Set<string>>()
  const owner = (event: IpcMainInvokeEvent): string => `${event.sender.id}:${account()}`
  ipc.handle('agent-runtime:run', (event, value: unknown) => {
    const request = requestSchema.parse(value)
    const key = owner(event)
    if (!account()) throw new Error('请先连接数据库')
    if (!observed.has(event.sender)) {
      observed.set(event.sender, new Set())
      // Runs are also cancelled on account switches. No request can outlive its window.
      event.sender.once('destroyed', () => {
        for (const owner of observed.get(event.sender) || []) host.cancelOwner(owner)
      })
    }
    observed.get(event.sender)!.add(key)
    return host.ask(request, key, (progress) => {
      if (!event.sender.isDestroyed())
        event.sender.send('ask-wechat:progress', request.requestId, progress)
    })
  })
  ipc.handle('agent-runtime:cancel', (event, id: unknown) =>
    host.cancel(z.string().max(128).parse(id), owner(event))
  )
  ipc.handle('agent-runtime:forget', (event, value: unknown) =>
    host.forget(owner(event), scopeSchema.parse(value))
  )
  ipc.handle('agent-runtime:get-skill-catalog', () => host.catalog())
}
