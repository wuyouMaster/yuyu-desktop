import { abortable } from './abort'
import {
  EvidenceCollector,
  validateToolArguments,
  toolResultForModel,
  newRetryState,
  lockConstraintTimeRange,
  duplicateRetry,
  recordAttempt,
  type QueryAgentToolExecutor
} from '../services/query-agent-service'
import type { AskWechatScope } from '../../shared/query-agent'
import type { RunBudget } from './budget'

export class QueryGateway {
  readonly evidence = new EvidenceCollector()
  private readonly retry = newRetryState()
  private readonly refs = new Set<string>()
  private readonly emptyAttempts = new Map<string, number>()
  constructor(
    private readonly execute: QueryAgentToolExecutor,
    private readonly scope: AskWechatScope,
    private readonly question: string,
    private readonly budget: RunBudget,
    private readonly signal: AbortSignal,
    private readonly onTool: (name: string) => void,
    private readonly ledger = new EvidenceCollector(),
    private readonly reads = { messageCount: 0, matchedCount: 0, overviewSourceCount: 0 },
    private readonly temporalLock = newRetryState()
  ) {}
  grant(items: ReturnType<EvidenceCollector['list']>): void {
    this.evidence.addFromToolResult('dependency', { status: 'completed', evidence: items })
    for (const item of items) this.refs.add(item.messageRef)
  }
  visibleEvidence(): ReturnType<EvidenceCollector['list']> {
    return this.evidence.list().flatMap((item) => {
      const citationId = this.ledger.citationIdFor(item.messageRef)
      return citationId ? [{ ...item, citationId }] : []
    })
  }
  async call(name: string, value: unknown): Promise<unknown> {
    this.signal.throwIfAborted()
    this.budget.tool()
    if ((this.emptyAttempts.get(name) || 0) >= 2)
      return { status: 'invalid_tool_arguments', constraint: 'zero_result_retry_exhausted' }
    const validated = validateToolArguments(name, value, new Date(), this.question)
    if (validated.error || !validated.input) return validated.error
    const input = validated.input
    if (name === 'message_context' && !this.refs.has(String(input.messageRef))) {
      return { status: 'invalid_tool_arguments', constraint: 'message_ref_not_granted' }
    }
    const violation = lockConstraintTimeRange(
      name,
      validated.temporalBasis,
      input,
      this.temporalLock
    )
    if (violation) return violation
    if (duplicateRetry(name, input, this.retry))
      return { status: 'invalid_tool_arguments', constraint: 'duplicate_retry' }
    recordAttempt(name, input, this.retry)
    this.onTool(name)
    const result = await abortable(
      this.execute(name, input, {
        conversationScope: this.scope.scope,
        signal: this.signal
      }),
      this.signal
    )
    this.signal.throwIfAborted()
    const count =
      name === 'query_messages'
        ? result.returnedCount
        : name === 'search_messages'
          ? (result.evidenceCount ??
            (Array.isArray(result.evidence) ? result.evidence.length : undefined))
          : undefined
    if (result.status === 'completed' && count === 0)
      this.emptyAttempts.set(name, (this.emptyAttempts.get(name) || 0) + 1)
    this.reads.messageCount +=
      typeof result.returnedCount === 'number'
        ? result.returnedCount
        : Array.isArray(result.messages)
          ? result.messages.length
          : 0
    this.reads.matchedCount +=
      typeof result.evidenceCount === 'number'
        ? result.evidenceCount
        : Array.isArray(result.evidence)
          ? result.evidence.length
          : 0
    this.reads.overviewSourceCount +=
      typeof result.sourceMessageCount === 'number' ? result.sourceMessageCount : 0
    this.evidence.addFromToolResult(name, result)
    this.ledger.addFromToolResult(name, result)
    for (const item of [...this.evidence.list(), ...this.ledger.list()]) {
      if (item.text && item.text.length > 2000) item.text = item.text.slice(0, 2000) + '…'
      if (item.imageOcrText && item.imageOcrText.length > 800)
        item.imageOcrText = item.imageOcrText.slice(0, 800) + '…'
    }
    for (const item of this.evidence.list()) this.refs.add(item.messageRef)
    const visible = toolResultForModel(name, result, 0, [], undefined, this.ledger.citationIdFor)
    delete visible._agent
    // Tool payloads are data, never instructions. Bound each observation independently.
    const bounded = JSON.parse(JSON.stringify(visible)) as Record<string, unknown>
    for (const key of ['messages', 'evidence', 'before', 'after']) {
      if (Array.isArray(bounded[key])) bounded[key] = (bounded[key] as unknown[]).slice(0, 30)
    }
    if (JSON.stringify(bounded).length > 18_000) {
      return {
        status: result.status,
        coverage: result.coverage,
        truncated: true,
        evidence: this.visibleEvidence()
          .slice(0, 15)
          .map((e) => ({ ...e, text: e.text?.slice(0, 600) })),
        instruction: '结果过长，仅返回部分证据；缩小查询范围以读取其余内容。'
      }
    }
    return bounded
  }
}
