import { useEffect, useRef, useState } from 'react'
import type { Contact, Message, MessagesAroundResult } from '../../../../shared/types'
import { isWatchedMessage, type PriorityWatchRule } from '../../../../shared/priority-watch'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '../../components/ui'
import { MessageBubble } from '../../components/chat/MessageBubble'
import { ChatImageViewer } from '../../components/chat/ChatImageViewer'
import '../../styles/priority-watch.scss'

type Member = PriorityWatchRule['members'][number]
const PRIORITY_WATCH_GROUP_INTERVAL_SECONDS = 60

interface PriorityWatchMessageGroup {
  id: string
  messages: Message[]
}

interface Props {
  accountRoot: string
  contacts: Contact[]
  dbReady: boolean
  onOpenSettings: () => void
  onOpenMessage: (contact: Contact, message: Message) => void
}

function readRules(key: string): PriorityWatchRule[] {
  const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]')
  if (
    !Array.isArray(raw) ||
    raw.some(
      (r) =>
        !r ||
        typeof r.conversationId !== 'string' ||
        typeof r.groupName !== 'string' ||
        !Array.isArray(r.members) ||
        r.members.some(
          (m: Member) => !m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string'
        )
    )
  )
    throw new Error('关注配置损坏，未覆盖原配置')
  return raw
}
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '加载失败，请重试'

function getPriorityWatchMessageTime(message: Message): number | null {
  if (typeof message.createTime === 'number' && message.createTime > 0) {
    return message.createTime
  }
  const parsed = Date.parse(message.datetime)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
}

function getPriorityWatchSenderKey(message: Message): string {
  return String(message.senderId || message.name || message.from || '').trim()
}

function groupPriorityWatchMessages(messages: Message[]): PriorityWatchMessageGroup[] {
  const groups: PriorityWatchMessageGroup[] = []
  for (const message of messages) {
    const current = groups[groups.length - 1]
    const previous = current?.messages[current.messages.length - 1]
    const messageTime = getPriorityWatchMessageTime(message)
    const previousTime = previous ? getPriorityWatchMessageTime(previous) : null
    const canJoin =
      current &&
      previous &&
      messageTime !== null &&
      previousTime !== null &&
      getPriorityWatchSenderKey(message) === getPriorityWatchSenderKey(previous) &&
      Math.abs(messageTime - previousTime) <= PRIORITY_WATCH_GROUP_INTERVAL_SECONDS

    if (canJoin) {
      current.messages.push(message)
    } else {
      groups.push({ id: message.id, messages: [message] })
    }
  }
  return groups
}

function formatPriorityWatchMessageTime(messages: Message[]): string {
  if (messages.length < 2) return messages[0]?.datetime || ''
  const ordered = [...messages].sort((a, b) => {
    const aTime = getPriorityWatchMessageTime(a)
    const bTime = getPriorityWatchMessageTime(b)
    return (aTime ?? 0) - (bTime ?? 0)
  })
  const first = ordered[0]?.datetime || ''
  const last = ordered[ordered.length - 1]?.datetime || ''
  return first === last ? first : `${first} – ${last}`
}

export function PriorityWatchWorkspace({
  accountRoot,
  contacts,
  dbReady,
  onOpenSettings,
  onOpenMessage
}: Props): React.ReactElement {
  const storageKey = `priority-watch:v1:${accountRoot}`
  const [initial] = useState(() => {
    try {
      return { rules: readRules(storageKey), error: '' }
    } catch (error) {
      return { rules: [] as PriorityWatchRule[], error: errorText(error) }
    }
  })
  const [rules, setRules] = useState(initial.rules)
  const [error, setError] = useState(initial.error)
  const [selected, setSelected] = useState(initial.rules[0]?.conversationId || '')
  const [manage, setManage] = useState(false)
  const [search, setSearch] = useState('')
  const [person, setPerson] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [scanned, setScanned] = useState(0)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const generation = useRef(0)
  const busy = useRef(false)
  const rule = rules.find((r) => r.conversationId === selected)
  const contact = contacts.find((c) => c.md5 === selected && c.type === 'group')
  const senderKey = JSON.stringify(rule?.members.map((m) => m.id) || [])

  const load = async (
    endTime?: number,
    append = false,
    ticket = generation.current
  ): Promise<void> => {
    if (!rule || !contact || !dbReady || busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const result = await window.api.getPriorityWatchPage({
        accountRoot,
        conversationId: selected,
        senderIds: rule.members.map((m) => m.id),
        endTime
      })
      if (ticket !== generation.current) return
      setMessages((previous) => [
        ...new Map([...(append ? previous : []), ...result.messages].map((m) => [m.id, m])).values()
      ])
      setNext(result.nextEndTime)
      setScanned((count) => (append ? count : 0) + result.scanned)
    } catch (error) {
      if (ticket === generation.current) setError(errorText(error))
    } finally {
      if (ticket === generation.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const ticket = ++generation.current
    busy.current = false
    setMessages([])
    setNext(null)
    setScanned(0)
    setPerson('')
    setLoading(false)
    void load(undefined, false, ticket)
    return () => {
      generation.current = ticket + 1
    }
    // The serialized member IDs deliberately invalidate requests after configuration edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, senderKey, dbReady, accountRoot, contact?.md5, revision])

  const save = (updated: PriorityWatchRule[]): boolean => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated))
      setRules(updated)
      setError('')
      return true
    } catch {
      setError('无法保存关注配置，请检查本地存储后重试')
      return false
    }
  }
  const visible = person ? messages.filter((m) => m.senderId === person) : messages
  const visibleGroups = groupPriorityWatchMessages(visible)

  return (
    <div className="priority-watch">
      <header className="priority-watch-header">
        <div>
          <h1>重点关注</h1>
          <p>在指定群聊里，集中查看你关心的人的消息。</p>
        </div>
        <Button
          disabled={!dbReady || !accountRoot || Boolean(initial.error)}
          onClick={() => setManage(true)}
        >
          管理关注
        </Button>
      </header>
      {error && (
        <p role="alert" className="priority-watch-error">
          {error}
        </p>
      )}
      {!dbReady ? (
        <div className="priority-watch-empty">
          <h2>连接微信数据后开始关注</h2>
          <Button variant="outline" onClick={onOpenSettings}>
            连接数据
          </Button>
        </div>
      ) : (
        <div className="priority-watch-body">
          <aside className="priority-watch-sidebar" aria-label="关注的群聊">
            <label>
              查找关注的群聊
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索群名或关注成员"
              />
            </label>
            <p className="priority-watch-muted">{rules.length} 个群聊 · 按群设置关注成员</p>
            {rules
              .filter((r) =>
                `${r.groupName} ${r.members.map((m) => m.name).join(' ')}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
              .map((r) => (
                <button
                  type="button"
                  className={`priority-watch-group ${r.conversationId === selected ? 'active' : ''}`}
                  key={r.conversationId}
                  onClick={() => setSelected(r.conversationId)}
                >
                  <strong>
                    {contacts.find((c) => c.md5 === r.conversationId)?.m_nsNickName || r.groupName}
                  </strong>
                  <span>{r.members.map((m) => m.name).join('、')}</span>
                </button>
              ))}
            {!rules.length && (
              <div className="priority-watch-sidebar-empty">
                <strong>还没有关注对象</strong>
                <p>选择一个群聊和成员，开始集中查看重要消息。</p>
                <Button variant="outline" onClick={() => setManage(true)}>
                  开始设置
                </Button>
              </div>
            )}
          </aside>
          <main className="priority-watch-feed">
            {!rule ? (
              <div className="priority-watch-empty priority-watch-empty-main">
                <div className="priority-watch-empty-card">
                  <span className="priority-watch-empty-icon" aria-hidden="true">
                    ☆
                  </span>
                  <h2>还没有选择关注群聊</h2>
                  <p>设置关注后，这里会集中显示相关成员的消息。</p>
                  <Button variant="outline" onClick={() => setManage(true)}>
                    管理关注
                  </Button>
                </div>
              </div>
            ) : !contact ? (
              <div className="priority-watch-empty">
                这个群聊暂时不在当前账号的会话列表中。可在管理关注中调整。
              </div>
            ) : (
              <>
                <div className="priority-watch-toolbar">
                  <div>
                    <h2>{contact.m_nsNickName}</h2>
                    <p>仅显示关注成员 · 最新消息在前</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => setRevision((n) => n + 1)}
                  >
                    刷新消息
                  </Button>
                </div>
                <div className="priority-watch-person">
                  <div>
                    <span className="priority-watch-field-label">查看成员</span>
                    <span className="priority-watch-field-hint">筛选当前群聊中的关注消息</span>
                  </div>
                  <label className="priority-watch-select-field">
                    <span className="sr-only">查看成员</span>
                    <span className="priority-watch-select-wrap">
                      <select
                        aria-label="查看成员"
                        value={person}
                        onChange={(e) => setPerson(e.target.value)}
                      >
                        <option value="">全部关注成员</option>
                        {rule.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                </div>
                <div className="priority-watch-messages" aria-busy={loading}>
                  {visibleGroups.map((group) => (
                    <WatchMessage
                      key={`${selected}:${group.id}`}
                      messages={group.messages}
                      contact={contact}
                      members={rule.members}
                      onOpenMessage={onOpenMessage}
                      onPreview={setPreview}
                    />
                  ))}
                  {!visible.length && !loading && (
                    <div className="priority-watch-message-empty">
                      <p>
                        {scanned ? '已读取的消息中暂无该关注成员的发言。' : '暂无关注消息。'}
                        {next !== null ? '可继续向前查找。' : ''}
                      </p>
                      {next !== null && (
                        <Button variant="outline" onClick={() => void load(next, true)}>
                          继续查找更早消息
                        </Button>
                      )}
                    </div>
                  )}
                  {loading && <p role="status">正在读取关注消息…</p>}
                  {!loading && !error && scanned > 0 && next === null && (
                    <p className="priority-watch-muted">已读到可用历史记录的起点</p>
                  )}
                  {!loading && error && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        next !== null ? void load(next, true) : setRevision((n) => n + 1)
                      }
                    >
                      重试
                    </Button>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}
      {manage && (
        <WatchManager
          contacts={contacts}
          rules={rules}
          onClose={() => setManage(false)}
          onSave={(r) => {
            const updated = [
              ...rules.filter((old) => old.conversationId !== r.conversationId),
              ...(r.members.length ? [r] : [])
            ]
            if (!save(updated)) return false
            setSelected(r.members.length ? r.conversationId : updated[0]?.conversationId || '')
            setManage(false)
            return true
          }}
          onRemove={(conversationId) => {
            const updated = rules.filter((old) => old.conversationId !== conversationId)
            if (!save(updated)) return false
            setSelected((current) =>
              current === conversationId ? updated[0]?.conversationId || '' : current
            )
            return true
          }}
        />
      )}
      {preview && <ChatImageViewer imageUrl={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function WatchMessage({
  messages,
  contact,
  members,
  onOpenMessage,
  onPreview
}: {
  messages: Message[]
  contact: Contact
  members: Member[]
  onOpenMessage: Props['onOpenMessage']
  onPreview: (url: string) => void
}): React.ReactElement {
  const firstMessage = messages[0]
  const memberName =
    members.find((m) => m.id === firstMessage?.senderId)?.name ||
    firstMessage?.name ||
    firstMessage?.senderId
  const [context, setContext] = useState<MessagesAroundResult | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const openContext = async (): Promise<void> => {
    if (!firstMessage) return
    if (expanded) {
      setExpanded(false)
      return
    }
    if (context) {
      setExpanded(true)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.api.getMessagesAround(
        contact.md5,
        firstMessage.id,
        firstMessage.createTime,
        120
      )
      if (alive.current) {
        setContext(result)
        setExpanded(true)
      }
    } catch (error) {
      if (alive.current) setError(errorText(error))
    } finally {
      if (alive.current) setLoading(false)
    }
  }
  const bubble = (message: Message): React.ReactElement => (
    <MessageBubble
      message={message}
      contact={contact}
      isGroupChat
      isMine={message.isSender}
      showAvatarSpace={false}
      onImageClick={onPreview}
    />
  )
  const index = context?.messages.findIndex((message) => message.id === firstMessage?.id) ?? -1
  const nearby =
    context && index >= 0 ? context.messages.slice(Math.max(0, index - 3), index + 4) : []

  return (
    <article className="priority-watch-message">
      <header>
        <strong>{memberName}</strong>
        <time>{formatPriorityWatchMessageTime(messages)}</time>
      </header>
      <div className="priority-watch-message-items">
        {messages.map((message) => (
          <div key={message.id} className="priority-watch-message-item">
            {bubble(message)}
          </div>
        ))}
      </div>
      <footer>
        <Button variant="ghost" disabled={loading} onClick={() => void openContext()}>
          {loading ? '加载上下文…' : expanded ? '收起上下文' : '查看上下文'}
        </Button>
        <Button
          variant="ghost"
          disabled={!firstMessage}
          onClick={() => firstMessage && onOpenMessage(contact, firstMessage)}
        >
          跳转原聊天
        </Button>
      </footer>
      {error && <p role="alert">{error}</p>}
      {expanded && context && (
        <section className="priority-watch-context" aria-label="消息上下文">
          {index < 0 ? (
            <p>暂未定位到原消息，请跳转原聊天查看。</p>
          ) : (
            nearby.map((message) => (
              <div
                key={message.id}
                className={
                  isWatchedMessage(
                    message,
                    members.map((member) => member.id)
                  )
                    ? 'watched'
                    : ''
                }
              >
                <p>
                  {members.find((member) => member.id === message.senderId)?.name ||
                    message.name ||
                    message.from}{' '}
                  · {message.datetime}
                  {message.id === firstMessage?.id ? ' · 当前消息' : ''}
                </p>
                {bubble(message)}
              </div>
            ))
          )}
          <p className="priority-watch-muted">
            显示附近最多 3 条前后消息{context.truncated ? '；上下文窗口已截断' : ''}
            。完整对话请跳转原聊天。
          </p>
        </section>
      )}
    </article>
  )
}

function WatchManager({
  contacts,
  rules,
  onClose,
  onSave,
  onRemove
}: {
  contacts: Contact[]
  rules: PriorityWatchRule[]
  onClose: () => void
  onSave: (rule: PriorityWatchRule) => boolean
  onRemove: (conversationId: string) => boolean
}): React.ReactElement {
  const [tab, setTab] = useState<'edit' | 'saved'>('edit')
  const [groupId, setGroupId] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [chosen, setChosen] = useState<Member[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const group = contacts.find((c) => c.md5 === groupId)
  const editRule = (rule: PriorityWatchRule): void => {
    setTab('edit')
    setGroupId(rule.conversationId)
    setChosen(rule.members)
    setMembers(rule.members)
    setSearch('')
    setError('')
    setLoading(true)
  }
  useEffect(() => {
    let disposed = false
    const saved = rules.find((r) => r.conversationId === groupId)?.members || []
    if (!groupId) return
    void window.api
      .getGroupSnapshot(groupId)
      .then((snapshot) => {
        if (disposed) return
        if (!snapshot) throw new Error('暂时无法读取群成员，请重试')
        const current = snapshot.members
          .map((m) => ({
            id: m.wxid,
            name: m.remark || m.groupNickname || m.nickname || m.wechatNickname || m.wxid
          }))
          .filter((m) => m.id)
        setMembers([...new Map([...saved, ...current].map((m) => [m.id, m])).values()])
      })
      .catch((error) => {
        if (!disposed) setError(errorText(error))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [groupId, rules, retry])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="priority-watch-dialog">
        <DialogHeader>
          <DialogTitle>管理关注</DialogTitle>
          <DialogDescription>
            先选择群聊，再勾选该群中需要关注的成员。同一个人在不同群中分别设置。
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as 'edit' | 'saved')}
          className="priority-watch-tabs"
        >
          <TabsList aria-label="关注管理页面">
            <TabsTrigger value="edit">添加或编辑</TabsTrigger>
            <TabsTrigger value="saved">已关注 ({rules.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="priority-watch-edit-content">
            <label>
              选择群聊
              <span className="priority-watch-select-wrap">
                <select
                  aria-label="选择群聊"
                  value={groupId}
                  onChange={(e) => {
                    const id = e.target.value
                    const saved = rules.find((r) => r.conversationId === id)?.members || []
                    setChosen(saved)
                    setMembers(saved)
                    setError('')
                    setSearch('')
                    setLoading(Boolean(id))
                    setGroupId(id)
                  }}
                >
                  <option value="">请选择群聊</option>
                  {contacts
                    .filter((c) => c.type === 'group')
                    .map((c) => (
                      <option key={c.md5} value={c.md5}>
                        {c.m_nsNickName}
                      </option>
                    ))}
                </select>
              </span>
            </label>
            <label>
              搜索成员
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="昵称或微信标识"
              />
            </label>
            {loading && <p role="status">正在加载群成员…</p>}
            {error && (
              <p role="alert">
                {error}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setLoading(true)
                    setError('')
                    setRetry((n) => n + 1)
                  }}
                >
                  重试
                </Button>
              </p>
            )}
            <div className="priority-watch-members">
              {members
                .filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()))
                .map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={chosen.some((c) => c.id === m.id)}
                      onChange={(e) =>
                        setChosen((prev) =>
                          e.target.checked ? [...prev, m] : prev.filter((p) => p.id !== m.id)
                        )
                      }
                    />
                    <span>
                      {m.name}
                      <small>{m.id}</small>
                    </span>
                  </label>
                ))}
            </div>
            <p>已选择 {chosen.length} 人（每群最多 200 人）。取消所有成员将移除该群关注。</p>
            <footer>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button
                disabled={!group || loading || chosen.length > 200}
                onClick={() => {
                  if (
                    group &&
                    !onSave({
                      conversationId: groupId,
                      groupName: group.m_nsNickName,
                      members: chosen
                    })
                  )
                    setError('保存失败，请重试')
                }}
              >
                保存关注
              </Button>
            </footer>
            {rules
              .filter((r) => !contacts.some((c) => c.md5 === r.conversationId))
              .map((r) => (
                <Button
                  key={r.conversationId}
                  variant="ghost"
                  onClick={() => onRemove(r.conversationId)}
                >
                  移除不可用群聊：{r.groupName}
                </Button>
              ))}
          </TabsContent>
          <TabsContent value="saved">
            <div className="priority-watch-saved-list">
              {!rules.length && <p className="priority-watch-muted">还没有已关注的群聊。</p>}
              {rules.map((rule) => {
                const available = contacts.some((c) => c.md5 === rule.conversationId)
                return (
                  <article key={rule.conversationId} className="priority-watch-saved-item">
                    <div>
                      <strong>{rule.groupName}</strong>
                      {!available && <span className="priority-watch-muted">群聊暂不可用</span>}
                      <p>{rule.members.map((member) => member.name).join('、')}</p>
                    </div>
                    <div className="priority-watch-saved-actions">
                      {available && (
                        <Button variant="ghost" onClick={() => editRule(rule)}>
                          编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!onRemove(rule.conversationId)) setError('移除失败，请重试')
                        }}
                      >
                        移除
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
