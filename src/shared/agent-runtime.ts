export type AgentRole = 'main' | 'planner' | 'retriever' | 'analyst' | 'verifier'
export type AgentTaskState = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
export interface AgentQuote {
  sender: string
  text: string
  conversationId: string
  messageRef?: string
  provenance: 'user-provided'
}
export interface AgentPlanStep {
  id: string
  objective: string
  role: Exclude<AgentRole, 'main' | 'planner'>
  dependencies: string[]
  doneWhen: string
  /** Planner task brief, never a replacement for the host role policy. */
  instructions?: string
  skills?: string[]
  /** Only these user-quote indexes are projected into the child context. */
  quoteIndexes?: number[]
  state: AgentTaskState
  artifactId?: string
}
export interface AgentExecutionView {
  activities?: AgentActivity[]
  runId: string
  state: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'planned'
  planVersion: number
  steps: AgentPlanStep[]
  skills: string[]
  modelCalls: number
  toolCalls: number
  tokens: number
  tokensEstimated: boolean
  resumable: boolean
}

/** Public execution facts only; never model reasoning, credentials or raw tool payloads. */
export interface AgentActivity {
  id: string
  parentId?: string
  kind: 'agent' | 'tool' | 'skill' | 'model'
  label: string
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'partial'
  startedAt: number
  endedAt?: number
  summary?: string
  inputSummary?: string
}
