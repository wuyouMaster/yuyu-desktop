import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ExecutionActivity } from './ExecutionActivity'
import type { AgentExecutionView, AgentActivity } from '../../../../shared/agent-runtime'
import { AgentExecutionPanel } from './AgentExecutionPanel'
import type { AIRuntimeModelConfig } from '../../../../shared/ai-provider'
import type { AskWechatQueryResult } from '../../../../shared/query-agent'
import type { Contact } from '../../../../shared/types'
import { Button, IconButton, Textarea, Tooltip, TooltipContent, TooltipTrigger } from '../ui'
import { AiIcon, CloseIcon, SendIcon } from './icons'
import type { ChatQuote } from './chatQuote'
import type { EvidenceItem } from '../search/searchTypes'
import { mapAskWechatEvidence } from '../search/askWechatPresentation'
import { mapPipelineResultToRendererResult } from '../search/searchMappers'
import { renderMarkdown } from '../search/searchMarkdown'
import {
  forgetAskWechatConversation,
  requestAskWechatQuery,
  resolveQueryAgentEnabled
} from '../search/queryAgentBridge'
import {
  queryAgentProgressLabel,
  useQueryAgentProgress
} from '../search/hooks/useQueryAgentProgress'

interface ConversationAITurn {
  id: string
  question: string
  kind: 'chat' | 'analysis'
  quotes: ChatQuote[]
  answer?: string
  evidence: EvidenceItem[]
  status: 'loading' | 'answered' | 'error' | 'cancelled'
  error?: string
  errorCode?: string
  invalidCitationIds?: string[]
  execution?: AgentExecutionView
  activities?: AgentActivity[]
  requestText?: string
}

export interface ConversationAIDrawerProps {
  contact: Contact | null
  dbReady: boolean
  aiModelConfig: AIRuntimeModelConfig
  open: boolean
  onClose: () => void
  onOpenAISettings: () => void
  onOpenEvidence: (evidence: EvidenceItem) => void
  onNotice: (message: string) => void
  pendingQuote?: { conversationId: string; quotes: ChatQuote[] } | null
  onQuoteConsumed?: () => void
}

const contactName = (contact: Contact | null): string =>
  contact?.m_nsNickName ||
  contact?.remark ||
  contact?.wechatNickname ||
  contact?.m_nsUsrName ||
  '当前会话'

const createRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() || 'conversation-ai-' + Date.now()

const resultError = (result: Extract<AskWechatQueryResult, { engine: 'query-agent' }>): string =>
  result.status === 'provider_unavailable' || result.status === 'error'
    ? result.message
    : '本次问题没有完成，请稍后再试。'

export function ConversationAIDrawer({
  contact,
  dbReady,
  aiModelConfig,
  open,
  onClose,
  onOpenAISettings,
  onOpenEvidence,
  onNotice,
  pendingQuote,
  onQuoteConsumed
}: ConversationAIDrawerProps): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'chat' | 'analysis'>('chat')
  const activeKindRef = useRef<'chat' | 'analysis'>('chat')
  const [mode, setMode] = useState<'auto' | 'plan'>('auto')
  const runtimeEnabled = typeof window.api?.runAgentTask === 'function'
  const [quotes, setQuotes] = useState<ChatQuote[]>([])
  const [turns, setTurns] = useState<ConversationAITurn[]>([])
  const activeRequestRef = useRef<string | null>(null)
  const cancelRequest = (id: string): Promise<unknown> | undefined =>
    activeKindRef.current === 'chat'
      ? window.api.cancelConversationChat?.(id)
      : window.api.cancelAgentTask?.(id)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const focusQuoteRef = useRef(false)
  const followOutputRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { progress, begin: beginProgress, end: endProgress } = useQueryAgentProgress()
  const name = useMemo(() => contactName(contact), [contact])
  const loadingTurn = turns.find((turn) => turn.status === 'loading')

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="tooltip"]')) return
      event.preventDefault()
      onClose()
      document.querySelector<HTMLButtonElement>('.chat-header-text-action[aria-label="问这个聊天"]')?.focus()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    composerRef.current?.focus()
  }, [open, contact?.md5])

  useEffect(() => {
    if (activeRequestRef.current)
      void cancelRequest(activeRequestRef.current)?.catch(() => undefined)
    activeRequestRef.current = null
    endProgress()
    setQuery('')
    setQuotes([])
    setTurns([])
    followOutputRef.current = true
    if (contact?.md5) {
      forgetAskWechatConversation()
      void window.api
        .forgetAgentSession?.({ scope: { kind: 'current', conversationId: contact.md5 } })
        .catch(() => undefined)
    }
  }, [contact?.md5, endProgress])

  useEffect(
    () => () => {
      if (activeRequestRef.current)
        void cancelRequest(activeRequestRef.current)?.catch(() => undefined)
    },
    []
  )

  useEffect(() => {
    if (!open || !pendingQuote) return
    if (pendingQuote.conversationId === contact?.md5) {
      focusQuoteRef.current = true
      setQuotes((current) => [...current, ...pendingQuote.quotes])
    }
    onQuoteConsumed?.()
  }, [open, pendingQuote, contact?.md5, onQuoteConsumed])

  useLayoutEffect(() => {
    if (!focusQuoteRef.current) return
    focusQuoteRef.current = false
    composerRef.current?.focus()
    composerRef.current?.setSelectionRange(query.length, query.length)
  }, [query, quotes])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !followOutputRef.current) return
    node.scrollTop = node.scrollHeight
  }, [turns, progress])

  useEffect(() => {
    let pending = ''
    let pendingId = ''
    let frame: number | undefined
    const flush = (): void => {
      frame = undefined
      const delta = pending
      const id = pendingId
      pending = ''
      if (activeRequestRef.current !== id || activeKindRef.current !== 'chat') return
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id && turn.status === 'loading'
            ? { ...turn, answer: (turn.answer || '') + delta }
            : turn
        )
      )
    }
    const unsubscribe = window.api.onConversationChatDelta?.((id, delta) => {
      if (activeRequestRef.current !== id || activeKindRef.current !== 'chat') return
      if (pendingId !== id) pending = ''
      pendingId = id
      pending += delta
      if (frame === undefined) frame = requestAnimationFrame(flush)
    })
    return () => {
      unsubscribe?.()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    return window.api.onAskWechatProgress?.((id, event) => {
      if (activeRequestRef.current !== id) return
      const activities = event.activities || event.execution?.activities
      if (!activities) return
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id && turn.status === 'loading' ? { ...turn, activities } : turn
        )
      )
    })
  }, [])

  if (!open) return null

  const updateTurn = (id: string, update: Partial<ConversationAITurn>): void => {
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== id) return turn
        const next = { ...turn, ...update }
        if (next.status !== 'loading')
          next.activities = (
            update.activities ||
            update.execution?.activities ||
            turn.activities
          )?.map((item) =>
            item.state === 'running'
              ? {
                  ...item,
                  state: next.status === 'cancelled' ? 'cancelled' : 'failed',
                  endedAt: Date.now()
                }
              : item
          )
        return next
      })
    )
  }

  const cancelCurrentQuestion = (): void => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    void cancelRequest(requestId)?.catch(() => onNotice('后台取消失败，请稍后重试'))
    activeRequestRef.current = null
    endProgress()
    setTurns((current) =>
      current.map((turn) =>
        turn.id === requestId
          ? {
              ...turn,
              status: 'cancelled',
              error: '已取消本次问题',
              activities: turn.activities?.map((item) =>
                item.state === 'running'
                  ? { ...item, state: 'cancelled', endedAt: Date.now() }
                  : item
              )
            }
          : turn
      )
    )
    composerRef.current?.focus()
  }

  const submit = async (resume?: ConversationAITurn): Promise<void> => {
    const requestKind = resume ? 'analysis' : kind
    const text =
      resume?.question ||
      [
        ...quotes.map(
          (quote, index) =>
            `引用 ${index + 1}（${quote.sender}）：\n${quote.text
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')}`
        ),
        query.trim()
      ]
        .filter(Boolean)
        .join('\n\n')
    if (!text || activeRequestRef.current || loadingTurn || !contact) return
    if (requestKind === 'analysis' && !dbReady) {
      onNotice('请先连接数据库，再询问当前聊天')
      return
    }

    if (requestKind === 'chat' && typeof window.api.runConversationChat !== 'function') {
      onNotice(
        '当前窗口尚未加载新的对话接口，请重启应用；dev 模式请重启开发进程。无需重新保存模型配置，草稿和引用已保留。'
      )
      return
    }

    const requestId = createRequestId()
    const scopeLabel = '当前会话：' + name
    const turn: ConversationAITurn = {
      id: requestId,
      question: text,
      kind: requestKind,
      quotes: resume?.quotes || [...quotes],
      requestText:
        resume?.requestText ||
        (requestKind === 'chat' || runtimeEnabled ? query.trim() || '请解释这些引用' : text),
      evidence: [],
      status: 'loading'
    }
    followOutputRef.current = true
    setTurns((current) => [...current, turn])
    if (!resume) {
      setQuery('')
      setQuotes([])
    } else {
      setKind('analysis')
    }
    activeRequestRef.current = requestId
    activeKindRef.current = requestKind
    beginProgress(requestId)

    const history = turns
      .filter((t) => t.status === 'answered' && t.answer)
      .slice(-6)
      .map((t) => ({
        question: t.question.slice(0, 2000),
        answer: t.answer!.replace(/\[E\d+\]/g, '').slice(0, 4000),
        mode: t.kind
      }))
    try {
      if (requestKind === 'chat') {
        const result = await window.api.runConversationChat({
          requestId,
          conversationId: contact.md5,
          text: query.trim() || '请解释这些引用',
          quotes: turn.quotes.map((quote) => ({
            ...quote,
            conversationId: contact.md5,
            provenance: 'user-provided' as const
          })),
          history
        })
        if (activeRequestRef.current !== requestId) return
        updateTurn(
          requestId,
          result.success
            ? {
                status: 'answered',
                answer: result.answer,
                activities: result.activities,
                evidence: mapAskWechatEvidence(result.evidence || []),
                invalidCitationIds: result.invalidCitationIds || []
              }
            : {
                status: result.code === 'cancelled' ? 'cancelled' : 'error',
                error: result.error,
                errorCode: result.code,
                activities: result.activities
              }
        )
        return
      }
      if (!(await resolveQueryAgentEnabled())) {
        updateTurn(requestId, {
          status: 'error',
          error: '当前 AI 问答服务尚未启用，请先检查 AI 配置。'
        })
        return
      }

      if (activeRequestRef.current !== requestId) return
      const run = runtimeEnabled ? window.api.runAgentTask : requestAskWechatQuery
      const result = await run({
        requestId,
        text: turn.requestText!,
        history,
        ...(runtimeEnabled
          ? {
              mode: resume ? 'auto' : mode,
              resumeRunId: resume?.execution?.runId,
              quotes: turn.quotes.map((quote) => ({
                ...quote,
                conversationId: contact.md5,
                provenance: 'user-provided' as const
              }))
            }
          : {}),
        scope: {
          scope: { kind: 'current', conversationId: contact.md5 },
          label: scopeLabel
        }
      })
      if (activeRequestRef.current !== requestId) {
        if (result?.engine === 'query-agent' && 'execution' in result)
          updateTurn(requestId, { execution: result.execution })
        return
      }

      if (!result) {
        updateTurn(requestId, {
          status: 'error',
          error: '当前版本暂未提供 AI 问答服务，请更新应用后重试。'
        })
        return
      }

      if (result.engine === 'legacy') {
        const mapped = mapPipelineResultToRendererResult(result.result, [contact])
        updateTurn(requestId, {
          status: 'answered',
          answer: result.result.answer,
          evidence: mapped.evidence
        })
        return
      }

      if (result.status === 'answered') {
        updateTurn(requestId, {
          status: 'answered',
          answer: result.answer,
          evidence: mapAskWechatEvidence(result.evidence),
          invalidCitationIds: result.invalidCitationIds || [],
          execution: result.execution
        })
        return
      }

      updateTurn(requestId, {
        status: 'error',
        error: resultError(result),
        execution: 'execution' in result ? result.execution : undefined
      })
    } catch (error) {
      if (activeRequestRef.current !== requestId) return
      updateTurn(requestId, {
        status: 'error',
        error: error instanceof Error ? error.message : '读取聊天记录失败'
      })
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        endProgress()
      }
    }
  }

  const promoteToAnalysis = (turn: ConversationAITurn): void => {
    setKind('analysis')
    setQuery((current) => [turn.requestText, current.trim()].filter(Boolean).join('\n\n'))
    setQuotes((current) => [...turn.quotes, ...current])
    composerRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <aside className="conversation-ai-drawer" aria-label="当前聊天 AI 助手">
      <header className="conversation-ai-header">
        <div className="conversation-ai-heading">
          <span className="conversation-ai-icon" aria-hidden="true">
            <AiIcon />
          </span>
          <div>
            <h2>AI 助手</h2>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <div className="conversation-ai-scope" aria-label="当前问答范围" tabIndex={0}>
                  {name}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs break-words">
                {name}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="conversation-ai-tabs" role="tablist" aria-label="AI 模式">
          {(['chat', 'analysis'] as const).map((tab) => (
            <Tooltip key={tab} delayDuration={100}>
              <TooltipTrigger asChild>
                <span
                  className="conversation-ai-tab-trigger"
                  title={
                    tab === 'chat'
                      ? '对话：快速问答，按需查询聊天记录'
                      : '分析：规划任务，结合工具与子 Agent 深入分析'
                  }
                >
                  <button
                    id={'conversation-ai-tab-' + tab}
                    type="button"
                    role="tab"
                    className="conversation-ai-tab"
                    aria-selected={kind === tab}
                    aria-controls="conversation-ai-panel"
                    tabIndex={kind === tab ? 0 : -1}
                    onClick={() => setKind(tab)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                      event.preventDefault()
                      const next =
                        event.key === 'Home'
                          ? 'chat'
                          : event.key === 'End'
                            ? 'analysis'
                            : tab === 'chat'
                              ? 'analysis'
                              : 'chat'
                      setKind(next)
                      document.getElementById('conversation-ai-tab-' + next)?.focus()
                    }}
                  >
                    {tab === 'chat' ? '对话' : '分析'}
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {tab === 'chat'
                  ? '快速问答，按需查询聊天记录'
                  : '规划任务，结合工具与子 Agent 深入分析'}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </header>

      <div
        id="conversation-ai-panel"
        role="tabpanel"
        aria-labelledby={'conversation-ai-tab-' + kind}
        className="conversation-ai-messages"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget
          followOutputRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
        }}
      >
        {!turns.length && (
          <div className="conversation-ai-empty">
            <span className="conversation-ai-kicker">当前会话 AI</span>
            <h3>{kind === 'chat' ? '聊一聊，或引用消息提问' : '围绕这份聊天继续提问'}</h3>
            <p>
              {kind === 'chat'
                ? '直接提问、解释引用或查询历史消息。复杂调查可切换到分析。'
                : '检索当前会话，整理讨论与待办，点击证据回到原消息。'}
            </p>
            <div className="conversation-ai-suggestions">
              {(kind === 'chat'
                ? ['解释一下我引用的内容', '帮我把这段话表达得更清楚', '帮我起草一段礼貌的回复']
                : [
                    '总结这份聊天的主要话题',
                    '最近一次讨论的结论是什么？',
                    '找出这份聊天里的待办事项'
                  ]
              ).map((suggestion) => (
                <button
                  className="conversation-ai-suggestion"
                  key={suggestion}
                  type="button"
                  onClick={() => setQuery(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <section className="conversation-ai-turn" key={turn.id}>
            <div className="conversation-ai-question">{turn.question}</div>
            <span className="conversation-ai-turn-mode">
              {turn.kind === 'chat' ? '对话' : '分析'}
            </span>
            {turn.status === 'loading' && (
              <div className="conversation-ai-status" aria-live="polite">
                <span className="conversation-ai-status-mark" aria-hidden="true" />
                {turn.kind === 'chat' && !progress
                  ? turn.answer
                    ? '正在回复…'
                    : '正在思考…'
                  : queryAgentProgressLabel(progress, false)}
              </div>
            )}
            <ExecutionActivity items={turn.activities || turn.execution?.activities} />
            <AgentExecutionPanel
              execution={
                turn.kind === 'analysis'
                  ? turn.status === 'loading'
                    ? progress?.execution
                    : turn.execution
                  : undefined
              }
              disabled={!!loadingTurn}
              onResume={() => void submit(turn)}
            />
            {turn.status === 'cancelled' && <p className="conversation-ai-muted">已取消本次问题</p>}
            {turn.status === 'error' && (
              <div className="conversation-ai-error">
                <p>{turn.error}</p>
                {turn.errorCode && turn.errorCode !== 'provider_error' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!loadingTurn}
                    onClick={() => {
                      setKind(turn.kind)
                      setQuery((current) =>
                        [turn.requestText, current.trim()].filter(Boolean).join('\n\n')
                      )
                      setQuotes((current) => [...turn.quotes, ...current])
                      composerRef.current?.focus()
                    }}
                  >
                    重新提问
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={onOpenAISettings}>
                    检查 AI 配置
                  </Button>
                )}
              </div>
            )}
            {turn.answer && (
              <div className="conversation-ai-answer">
                {renderMarkdown(turn.answer, {
                  evidenceCount: turn.evidence.length,
                  onEvidenceClick: (index) => {
                    const evidence = turn.evidence[index]
                    if (evidence) onOpenEvidence(evidence)
                  }
                })}
                {turn.invalidCitationIds && turn.invalidCitationIds.length > 0 && (
                  <p className="conversation-ai-muted">
                    已移除无法对应历史消息的引用：{turn.invalidCitationIds.join('、')}
                  </p>
                )}
                {turn.evidence.length > 0 && (
                  <div className="conversation-ai-evidence-list" aria-label="相关历史消息">
                    <span className="conversation-ai-evidence-title">相关历史消息</span>
                    {turn.evidence.map((evidence, index) => (
                      <button
                        key={evidence.evidenceId || evidence.message.id || index}
                        type="button"
                        className="conversation-ai-evidence-card"
                        onClick={() => onOpenEvidence(evidence)}
                      >
                        <span className="conversation-ai-evidence-card-top">
                          <strong>{evidence.evidenceId || 'E' + (index + 1)}</strong>
                          <span>{evidence.message.datetime}</span>
                        </span>
                        <span className="conversation-ai-evidence-card-sender">
                          {evidence.message.name || evidence.contact.m_nsNickName || '消息'}
                        </span>
                        <span className="conversation-ai-evidence-card-text">
                          {evidence.message.content || '[' + evidence.message.type + ']'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {turn.kind === 'chat' && turn.status !== 'loading' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!loadingTurn}
                className="conversation-ai-promote"
                onClick={() => promoteToAnalysis(turn)}
              >
                转为分析
              </Button>
            )}
          </section>
        ))}
      </div>

      <form
        className="conversation-ai-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {kind === 'analysis' && runtimeEnabled && (
          <div className="conversation-ai-mode" role="group" aria-label="回答方式">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={mode === 'auto'}
              disabled={!!loadingTurn}
              onClick={() => setMode('auto')}
            >
              自动执行
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={mode === 'plan'}
              disabled={!!loadingTurn}
              onClick={() => setMode('plan')}
            >
              先做计划
            </Button>
          </div>
        )}
        {!aiModelConfig.configured && (
          <button type="button" className="conversation-ai-config-hint" onClick={onOpenAISettings}>
            尚未配置 AI 模型，点击前往设置
          </button>
        )}
        {quotes.length > 0 && (
          <div className="conversation-ai-quotes" aria-label="待发送的引用">
            <div className="conversation-ai-quotes-heading">已引用 {quotes.length} 段聊天</div>
            <ol>
              {quotes.map((quote, index) => (
                <li key={index}>
                  <p title={`${quote.sender}：${quote.text}`}>
                    <strong>{quote.sender}：</strong>
                    {quote.text}
                  </p>
                  <IconButton
                    label={`移除引用 ${index + 1}`}
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setQuotes((current) => current.filter((_, i) => i !== index))}
                  >
                    <CloseIcon />
                  </IconButton>
                </li>
              ))}
            </ol>
          </div>
        )}
        <Textarea
          ref={composerRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            kind === 'chat' ? '直接提问，或引用消息一起聊…' : '问问“' + name + '”的聊天记录…'
          }
          aria-label="询问当前聊天"
          disabled={!contact || (kind === 'analysis' && !dbReady)}
          rows={3}
        />
        <div className="conversation-ai-composer-footer">
          <span>Enter 发送 · Shift + Enter 换行</span>
          {loadingTurn ? (
            <Button type="button" variant="outline" size="sm" onClick={cancelCurrentQuestion}>
              取消
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={
                (!query.trim() && !quotes.length) || !contact || (kind === 'analysis' && !dbReady)
              }
            >
              <SendIcon />
              发送
            </Button>
          )}
        </div>
      </form>
    </aside>
  )
}
