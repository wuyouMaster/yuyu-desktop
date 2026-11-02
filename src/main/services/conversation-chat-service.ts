import { CHAT_LIMITS, ChatFailure } from './conversation-chat-limits'
import type { AgentActivity } from '../../shared/agent-runtime'
import { runConversationChat } from './conversation-chat-loop'
import type { QueryAgentToolExecutor } from './query-agent-service'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AIProviderService } from './ai-provider-service'
import type { ConversationChatResult } from '../../shared/conversation-chat'

export const conversationHistorySchema = z
  .array(
    z.object({
      question: z.string().max(2000),
      answer: z.string().max(4000),
      mode: z.enum(['chat', 'analysis'])
    })
  )
  .max(6)

const requestSchema = z.object({
  requestId: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(256),
  text: z.string().trim().min(1).max(16000),
  quotes: z
    .array(
      z.object({
        sender: z.string().max(300),
        text: z.string().max(16000),
        conversationId: z.string().min(1).max(256),
        provenance: z.literal('user-provided')
      })
    )
    .max(30),
  history: conversationHistorySchema
})

export function registerConversationChatIpc(
  ipc: Pick<IpcMain, 'handle'>,
  provider: Pick<AIProviderService, 'chatWithTools'>,
  account: () => string,
  execute: QueryAgentToolExecutor,
  limits = CHAT_LIMITS
): { cancelAll: () => void } {
  const active = new Map<string, { owner: string; controller: AbortController }>()
  const observed = new WeakSet<Electron.WebContents>()
  const owner = (event: IpcMainInvokeEvent): string => `${event.sender.id}:${account()}`
  const cancelOwner = (key: string): void => {
    for (const run of active.values())
      if (run.owner.startsWith(key))
        run.controller.abort(new ChatFailure('cancelled', '对话已停止'))
  }
  ipc.handle('conversation-chat:cancel', (event, value: unknown) => {
    const id = z.string().max(128).parse(value)
    const run = active.get(id)
    if (!run || run.owner !== owner(event)) return false
    run.controller.abort(new ChatFailure('cancelled', '对话已停止'))
    return true
  })
  ipc.handle(
    'conversation-chat:run',
    async (event, value: unknown): Promise<ConversationChatResult> => {
      const request = requestSchema.parse(value)
      if (JSON.stringify(request).length > 64000) throw new Error('对话内容过多，请缩小引用范围')
      if (request.quotes.some((q) => q.conversationId !== request.conversationId))
        throw new Error('引用不属于当前会话')
      const key = owner(event)
      if (
        active.size >= 4 ||
        active.has(request.requestId) ||
        [...active.values()].some((r) => r.owner === key)
      )
        throw new Error('已有对话正在回复，请先停止')
      if (!observed.has(event.sender)) {
        observed.add(event.sender)
        event.sender.once('destroyed', () => cancelOwner(`${event.sender.id}:`))
      }
      const controller = new AbortController()
      const timer = setTimeout(
        () =>
          controller.abort(
            new ChatFailure(
              'run_timeout',
              `本轮对话累计超过 ${limits.totalTimeoutMs / 1000} 秒，已停止；查询记录已保留，建议缩小问题范围后重新提问。`
            )
          ),
        limits.totalTimeoutMs
      )
      const signal = controller.signal
      let activities: AgentActivity[] = []
      active.set(request.requestId, { owner: key, controller })
      let length = 0
      try {
        // Race also releases the slot if a provider ignores cancellation.
        const aborted = new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        })
        const result = await Promise.race([
          runConversationChat(
            request,
            provider,
            execute,
            signal,
            (delta) => {
              if (signal.aborted || owner(event) !== key || event.sender.isDestroyed()) return
              length += delta.length
              if (length > 32000) {
                controller.abort(
                  new ChatFailure('output_limit', '回复内容超过本轮长度上限，请缩小问题范围')
                )
                return
              }
              event.sender.send('conversation-chat:delta', request.requestId, delta)
            },
            (progress) => {
              activities = progress.activities || activities
              if (!signal.aborted && owner(event) === key && !event.sender.isDestroyed())
                event.sender.send('ask-wechat:progress', request.requestId, progress)
            },
            limits
          ),
          aborted
        ])
        signal.throwIfAborted()
        if (owner(event) !== key) throw new Error('当前账号已切换')
        return result
      } catch (error) {
        const reason = signal.aborted ? signal.reason : error
        const code = reason instanceof ChatFailure ? reason.code : 'provider_error'
        return {
          success: false,
          code,
          activities: activities.map((item) =>
            item.state === 'running'
              ? {
                  ...item,
                  state: code === 'cancelled' ? 'cancelled' : 'failed',
                  endedAt: Date.now()
                }
              : item
          ),
          error: reason instanceof Error ? reason.message : 'AI 回复失败'
        }
      } finally {
        clearTimeout(timer)
        controller.abort(new ChatFailure('cancelled', '对话已停止'))
        active.delete(request.requestId)
      }
    }
  )
  return {
    cancelAll: () => {
      for (const run of active.values())
        run.controller.abort(new ChatFailure('cancelled', '对话已停止'))
    }
  }
}
