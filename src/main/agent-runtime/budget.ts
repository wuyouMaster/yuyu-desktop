export interface RuntimeLimits {
  modelCalls: number
  toolCalls: number
  children: number
  parallel: number
  tokens: number
  contextChars: number
  outputTokens: number
  modelTimeoutMs: number
  taskTimeoutMs: number
  timeoutMs: number
}
export const DEFAULT_LIMITS: RuntimeLimits = {
  modelCalls: 12,
  toolCalls: 24,
  children: 4,
  parallel: 2,
  tokens: 80_000,
  contextChars: 64_000,
  outputTokens: 4096,
  modelTimeoutMs: 45_000,
  taskTimeoutMs: 60_000,
  timeoutMs: 120_000
}
export class BudgetExceeded extends Error {}
export class RunBudget {
  modelCalls = 0
  toolCalls = 0
  children = 0
  tokens = 0
  estimated = false
  private reservedTokens = 0
  constructor(readonly limits = DEFAULT_LIMITS) {}
  reserveModel(inputChars: number, final = false): (used?: number, estimated?: boolean) => void {
    // One final model call and output allowance are reserved for synthesis.
    if (inputChars > this.limits.contextChars)
      throw new BudgetExceeded('上下文超过预算，请缩小任务或读取更小的证据片段')
    const reserve = inputChars + this.limits.outputTokens
    const ceiling = this.limits.modelCalls - (final ? 0 : 1)
    const tokenCeiling =
      this.limits.tokens - (final ? 0 : Math.min(20000, Math.floor(this.limits.tokens / 4)))
    if (this.modelCalls >= ceiling || this.tokens + this.reservedTokens + reserve > tokenCeiling) {
      throw new BudgetExceeded('本次 AI 调用预算已用尽')
    }
    this.modelCalls++
    this.reservedTokens += reserve
    let settled = false
    return (used, estimated = false) => {
      if (settled) return
      settled = true
      this.reservedTokens -= reserve
      this.tokens += used ?? reserve
      if (used === undefined || estimated) this.estimated = true
    }
  }
  tool(): void {
    if (this.toolCalls >= this.limits.toolCalls) throw new BudgetExceeded('本次工具预算已用尽')
    this.toolCalls++
  }
  child(): void {
    if (this.children >= this.limits.children) throw new BudgetExceeded('本次子任务数量已达上限')
    this.children++
  }
}
