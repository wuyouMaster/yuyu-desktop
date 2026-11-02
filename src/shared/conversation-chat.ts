import type { AskWechatEvidenceItem } from './query-agent'
import type { AgentQuote, AgentActivity } from './agent-runtime'

export interface ConversationAIHistoryTurn {
  question: string
  answer: string
  mode: 'chat' | 'analysis'
}
export interface ConversationChatRequest {
  requestId: string
  conversationId: string
  text: string
  quotes: AgentQuote[]
  history: ConversationAIHistoryTurn[]
}
export type ConversationChatResult =
  | {
      activities?: AgentActivity[]
      success: true
      answer: string
      evidence?: AskWechatEvidenceItem[]
      invalidCitationIds?: string[]
    }
  | {
      success: false
      error: string
      code?: 'model_timeout' | 'run_timeout' | 'cancelled' | 'output_limit' | 'provider_error'
      activities?: AgentActivity[]
    }
