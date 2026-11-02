import type {
  AiSearchFinalEvidence,
  AiSearchPipelineResult,
  AiSearchAgentTraceItem
} from '../../../src/shared/ai-search'
import type { Contact } from '../../../src/shared/types'
import { buildSearchCacheKey } from '../../../src/renderer/src/components/search/searchUtils'

export const aiSearchContact: Contact = {
  md5: 'fixture-contact',
  m_nsUsrName: 'wxid_fixture',
  m_nsNickName: '测试会话',
  wechatNickname: 'Fixture User',
  remark: '测试联系人',
  type: 'user'
}

export const aiSearchGroup: Contact = {
  md5: 'fixture-group',
  m_nsUsrName: 'fixture-group@chatroom',
  m_nsNickName: '测试群聊',
  type: 'group'
}

export const makePipelineEvidence = (
  index: number,
  conversation = aiSearchContact
): AiSearchFinalEvidence & { senderId: string } => ({
  id: `E${index}`,
  conversationId: conversation.md5,
  conversationName: conversation.m_nsNickName,
  conversationType: conversation.type,
  chunkId: `chunk-${index}`,
  startTime: 1_700_000_000_000 + index * 1_000,
  endTime: 1_700_000_000_000 + index * 1_000,
  messageIds: [`message-${index}`],
  sourceKind: 'text',
  messageId: `message-${index}`,
  sender: `发送者 ${index}`,
  senderId: `sender-${index}`,
  timestamp: 1_700_000_000_000 + index * 1_000,
  text: `证据 ${index}`
})

export const makeSearchResult = ({
  requestId = 'request-1',
  status = 'completed',
  answer = '测试搜索答案',
  evidence = [],
  evidenceCollection = evidence,
  agentTrace = [],
  error,
  errorStage,
  plan = {},
  knowledge = {},
  retrieval = {},
  timings = {},
  ...overrides
}: Partial<Omit<AiSearchPipelineResult, 'plan' | 'knowledge' | 'retrieval' | 'timings'>> & {
  plan?: Partial<AiSearchPipelineResult['plan']>
  knowledge?: Partial<AiSearchPipelineResult['knowledge']>
  retrieval?: Partial<AiSearchPipelineResult['retrieval']>
  timings?: Partial<AiSearchPipelineResult['timings']>
  agentTrace?: AiSearchAgentTraceItem[]
} = {}): AiSearchPipelineResult => ({
  requestId,
  status,
  answer,
  plan: {
    intent: 'global_topic_search',
    keywords: ['测试'],
    variants: ['测试'],
    source: 'local',
    scopeLabel: '所有聊天记录',
    rangeLabel: '近 30 天',
    timeRange: {
      startTime: 1_699_000_000,
      label: '近 30 天',
      reason: '测试',
      source: 'ui'
    },
    contactNames: [],
    ...plan
  },
  knowledge: {
    source: 'knowledge',
    state: 'ready',
    indexedMessageCount: 20,
    indexedChunkCount: 4,
    totalMessages: 20,
    voiceCoverage: undefined,
    ...knowledge
  },
  candidateEvidenceCount: evidenceCollection.length,
  retrieval: {
    intent: 'global_topic_search',
    timeRange: {
      startTime: 1_699_000_000,
      label: '近 30 天',
      reason: '测试',
      source: 'ui'
    },
    retrievalMode: 'global_fts',
    candidateCount: evidenceCollection.length,
    uniqueCandidateCount: evidenceCollection.length,
    sourceCoverage: 'complete',
    isComplete: true,
    fallbackUsed: false,
    suspicious: false,
    ...retrieval
  },
  evidence,
  evidenceCollection,
  contextEvidenceCount: evidence.length,
  aggregation: {
    messageCount: evidenceCollection.length,
    peopleCount: evidenceCollection.length ? 1 : 0,
    conversationCount: evidenceCollection.length ? 1 : 0,
    people: [],
    conversations: []
  },
  agent: {
    mode: 'agent',
    toolCalls: agentTrace.length,
    trace: agentTrace
  },
  citationValidation: { status: 'valid', invalidCitationIds: [] },
  timings: {
    queryUnderstandingMs: 0,
    contactResolutionMs: 0,
    knowledgeSearchMs: 0,
    workerIpcMs: 0,
    workerBootMs: 0,
    dispatchMs: 0,
    workerSqlMs: 0,
    responseSerializeMs: 0,
    responseTransferMs: 0,
    workerQueueMs: 0,
    workerExecutionMs: 0,
    globalCountMs: 0,
    voiceCoverageMs: 0,
    wcdbQueueMs: 0,
    wcdbExecutionMs: 0,
    senderEnrichmentMs: 0,
    ipcMs: 0,
    serializationMs: 0,
    otherMs: 0,
    ftsMs: 0,
    chunkExpandMs: 0,
    messageLoadMs: 0,
    rankingMs: 0,
    candidateRankingMs: 0,
    evidenceBuildMs: 0,
    aggregationMs: 0,
    contextPreparationMs: 0,
    agentDecisionMs: 0,
    agentToolMs: 0,
    aiGenerationMs: 0,
    totalMs: 0,
    ...timings
  },
  elapsedMs: 12,
  error,
  errorStage,
  ...overrides
})

export const makeCacheRecord = ({
  query,
  scope = 'global',
  contactMd5 = '',
  range = '30d',
  answer = '缓存答案',
  evidence = []
}: {
  query: string
  scope?: 'global' | 'groups' | 'contacts' | 'conversation'
  contactMd5?: string
  range?: 'today' | '7d' | '30d' | 'all'
  answer?: string
  evidence?: ReturnType<typeof makePipelineEvidence>[]
}) => ({
  version: 3 as const,
  key: buildSearchCacheKey(scope, contactMd5, range, query),
  createdAt: 1_700_000_000_000,
  answer,
  evidence: evidence.map((item) => ({
    evidenceId: item.id,
    contact: scope === 'conversation' ? aiSearchContact : aiSearchContact,
    message: {
      id: item.messageId,
      from: item.senderId,
      type: '检索消息',
      datetime: new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false }),
      content: item.text,
      isSender: false,
      name: item.sender,
      senderId: item.senderId,
      createTime: Math.floor(item.timestamp / 1000)
    }
  })),
  senderNames: Object.fromEntries(evidence.map((item) => [item.senderId, item.sender])),
  messageCount: evidence.length
})
