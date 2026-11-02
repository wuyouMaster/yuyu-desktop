import { abortable } from './abort'
import { Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents-core'
import type { AIProviderService, AIChatToolDefinition } from '../services/ai-provider-service'
import type { RunBudget } from './budget'
export type RuntimeProvider = Pick<AIProviderService, 'getRuntimeConfig' | 'chatWithTools'>

export class ProviderModel implements Model {
  constructor(
    private readonly provider: RuntimeProvider,
    private readonly budget: RunBudget,
    private readonly signal: AbortSignal,
    private readonly onCall: () => void,
    private readonly final = false
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.signal.throwIfAborted()
    const messages: Array<Record<string, unknown>> = []
    if (request.systemInstructions)
      messages.push({ role: 'system', content: request.systemInstructions })
    const input =
      typeof request.input === 'string' ? [{ role: 'user', content: request.input }] : request.input
    for (const item of input) {
      if ('role' in item) {
        const content =
          typeof item.content === 'string'
            ? item.content
            : item.content.map((part) => ('text' in part ? part.text : '')).join('\n')
        messages.push({ role: item.role, content })
      } else if (item.type === 'function_call') {
        const call = {
          id: item.callId,
          type: 'function',
          function: { name: item.name, arguments: item.arguments }
        }
        const previous = messages.at(-1)
        if (previous?.role === 'assistant' && Array.isArray(previous.tool_calls))
          previous.tool_calls.push(call)
        else messages.push({ role: 'assistant', content: null, tool_calls: [call] })
      } else if (item.type === 'function_call_result') {
        messages.push({
          role: 'tool',
          tool_call_id: item.callId,
          content:
            typeof item.output === 'string'
              ? item.output
              : !Array.isArray(item.output) && item.output.type === 'text'
                ? item.output.text
                : JSON.stringify(item.output)
        })
      }
    }
    const tools: AIChatToolDefinition[] = request.tools.flatMap((entry) =>
      entry.type === 'function'
        ? [
            {
              type: 'function' as const,
              function: {
                name: entry.name,
                description: entry.description,
                parameters: entry.parameters
              }
            }
          ]
        : []
    )
    const settle = this.budget.reserveModel(JSON.stringify({ messages, tools }).length, this.final)
    this.onCall()
    try {
      const signal = AbortSignal.any([
        this.signal,
        AbortSignal.timeout(this.budget.limits.modelTimeoutMs)
      ])
      const result = await abortable(
        this.provider.chatWithTools(
          messages,
          tools,
          { maxOutputTokens: this.budget.limits.outputTokens },
          signal
        ),
        signal
      )
      this.signal.throwIfAborted()
      settle(
        result.usage?.total ??
          (result.usage?.input !== undefined && result.usage?.total === undefined
            ? result.usage.input + (result.usage.output || 0)
            : undefined),
        result.usage?.estimated
      )
      if (!result.success) throw new Error(result.error || '模型调用失败')
      const output: ModelResponse['output'] = (result.toolCalls || []).map((call) => ({
        type: 'function_call',
        callId: call.id,
        name: call.name,
        arguments: call.arguments
      }))
      if (result.data)
        output.unshift({
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: result.data }]
        })
      if (!output.length) throw new Error('模型没有返回内容')
      return {
        output,
        usage: new Usage({
          requests: 1,
          inputTokens: result.usage?.input || 0,
          outputTokens: result.usage?.output || 0
        })
      }
    } finally {
      settle()
    }
  }
  async *getStreamedResponse(_request: ModelRequest): ReturnType<Model['getStreamedResponse']> {
    throw new Error('当前 Provider 适配器仅支持非流式运行')
  }
}
