import { useSourceScope } from '../../data-sources/source-context'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  PersonalWechatSendCapability,
  PersonalWechatSenderStatus,
  PersonalWechatTextBackend
} from '../../../../../shared/personal-wechat'
import type {
  PersonalWechatRuntimeProgressEvent,
  PersonalWechatRuntimeStatus
} from '../../../../../shared/personal-wechat-runtime'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsList,
  TabsTrigger
} from '../../../components/ui'
import { PersonalWechatSetupGuide } from '../../../components/chat/PersonalWechatSetupGuide'
import { PersonalWechatSupportedVersionsContent } from '../../../components/chat/PersonalWechatSupportedVersionsContent'
import { isMac, isWindows } from '../../../utils/runtime-environment'

// Display-only snapshots survive settings-tab navigation; every visit still probes live state.
const snapshots = new WeakMap<object, PersonalWechatSendCapability>()
const pendingCapabilities = new WeakMap<object, Promise<PersonalWechatSendCapability>>()

const sourceCacheKeys = new WeakMap<object, Map<string, object>>()
function sourceCacheKey(api: object, id?: string): object {
  if (!id) return api
  let entries = sourceCacheKeys.get(api)
  if (!entries) {
    entries = new Map()
    sourceCacheKeys.set(api, entries)
  }
  let key = entries.get(id)
  if (!key) {
    key = {}
    entries.set(id, key)
  }
  return key
}

function readCapability(cacheKey: object): Promise<PersonalWechatSendCapability> {
  const api = window.api
  const pending = pendingCapabilities.get(cacheKey)
  if (pending) return pending
  const request = api.getPersonalWechatSendCapability().finally(() => {
    if (pendingCapabilities.get(cacheKey) === request) pendingCapabilities.delete(cacheKey)
  })
  pendingCapabilities.set(cacheKey, request)
  return request
}

const RUNTIME_STATUS_LABELS: Record<PersonalWechatRuntimeStatus['state'], string> = {
  missing: '未下载',
  downloading: '下载中',
  ready: '已就绪',
  invalid: '需要修复',
  error: '下载失败',
  unsupported: '暂不支持'
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const capabilityLabel: Record<PersonalWechatSendCapability['status'], string> = {
  unsupported: '暂不支持',
  unconfigured: '尚未配置',
  needs_binding: '需要绑定',
  needs_profile: '需要匹配',
  needs_verification: '需要检测',
  ready: '已就绪',
  error: '异常'
}

function normalizeWindowsPort(value: string): string | null {
  const text = value.trim()
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number(text)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? String(port) : null
}

function boundToCurrentWechat(status: PersonalWechatSenderStatus | null): boolean {
  if (!status) return false
  return (
    status.state === 'online' ||
    Boolean(
      status.wechatPid &&
      status.boundWechatPid === status.wechatPid &&
      status.attachReady &&
      status.baseAddressReady
    )
  )
}

export function PersonalWechatSendPage({
  onNotice,
  onOpenTextToSpeechSettings,
  onOpenChat
}: {
  onNotice: (message: string) => void
  onOpenTextToSpeechSettings?: () => void
  onOpenChat?: () => void
}): ReactElement {
  const scope = useSourceScope()
  const cacheKey = sourceCacheKey(window.api, scope?.active.id)
  const [capability, setCapability] = useState<PersonalWechatSendCapability | null>(
    () => snapshots.get(cacheKey) || null
  )
  const [senderStatus, setSenderStatus] = useState<PersonalWechatSenderStatus | null>(
    () => snapshots.get(cacheKey)?.senderStatus || null
  )
  const [runtimeStatus, setRuntimeStatus] = useState<PersonalWechatRuntimeStatus | null>(null)
  const [runtimeProgress, setRuntimeProgress] = useState<PersonalWechatRuntimeProgressEvent | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [binding, setBinding] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectionAttempted, setDetectionAttempted] = useState(false)
  const [error, setError] = useState('')
  const [windowsSenderStatus, setWindowsSenderStatus] = useState<PersonalWechatSenderStatus | null>(
    null
  )
  const [windowsPortInput, setWindowsPortInput] = useState('')
  const [windowsDetectedPort, setWindowsDetectedPort] = useState('')
  const [windowsEndpointBusy, setWindowsEndpointBusy] = useState(false)
  const [showWechatVersions, setShowWechatVersions] = useState(false)
  const [textBackend, setTextBackend] = useState<PersonalWechatTextBackend>(
    () => snapshots.get(cacheKey)?.senderStatus.textBackend || 'native'
  )
  const refreshRevision = useRef(0)
  const runtimeVersionsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const personalWechatRuntimeSupported = isMac && Boolean(runtimeStatus?.supported)

  const refresh = useCallback(async (): Promise<void> => {
    if (isWindows) {
      setLoading(false)
      return
    }
    const revision = ++refreshRevision.current
    const active = (): boolean => revision === refreshRevision.current
    const api = window.api
    setLoading(true)
    setError('')
    // Fast configuration and optional runtime information must not wait for process probes.
    await Promise.allSettled([
      readCapability(cacheKey)
        .then((nextCapability) => {
          if (!active()) return
          snapshots.set(cacheKey, nextCapability)
          setCapability(nextCapability)
          setSenderStatus(nextCapability.senderStatus)
        })
        .catch((reason: unknown) => {
          if (!active()) return
          snapshots.delete(cacheKey)
          setCapability(null)
          setSenderStatus(null)
          setError(reason instanceof Error ? reason.message : '微信发送能力读取失败')
        })
        .finally(() => {
          if (active()) setLoading(false)
        }),
      api
        .getPersonalWechatRuntimeStatus()
        .then((nextRuntime) => {
          if (!active()) return
          setRuntimeStatus(nextRuntime)
          setRuntimeProgress(nextRuntime.state === 'downloading' ? nextRuntime : null)
        })
        .catch(() => {
          if (active()) setError((current) => current || 'OneBot 运行时信息读取失败，可重新检测')
        }),
      api
        .getSettings()
        .then((settingsResult) => {
          if (!active()) return
          const backend = settingsResult.settings.personalWechatTextBackend || 'native'
          setTextBackend(backend)
          const cached = snapshots.get(cacheKey)
          if (cached?.senderStatus.textBackend && cached.senderStatus.textBackend !== backend) {
            snapshots.delete(cacheKey)
            setCapability(null)
            setSenderStatus(null)
          }
        })
        .catch(() => {
          if (active()) setError((current) => current || '发送设置读取失败，可重新检测')
        })
    ])
  }, [cacheKey])

  useEffect(() => {
    if (isWindows) return
    void refresh()
    const subscribe = window.api.onPersonalWechatRuntimeProgress
    const unsubscribe = subscribe?.((status) => {
      setRuntimeProgress(status)
      setRuntimeStatus(status)
      if (status.state === 'ready') void refresh()
    })
    return () => {
      refreshRevision.current += 1
      unsubscribe?.()
    }
  }, [refresh])

  useEffect(() => {
    if (!isWindows) return
    let active = true
    const loadWindowsEndpoint = async (): Promise<void> => {
      try {
        const settingsResult = await window.api.getSettings()
        const configuredPort = String(settingsResult.settings.windowsWechatPort || '').trim()
        if (!active) return
        setWindowsPortInput(configuredPort)
        if (configuredPort) {
          const status = await window.api.getPersonalWechatSenderStatus()
          if (!active) return
          setWindowsSenderStatus(status)
        }
        setLoading(false)
      } catch (reason) {
        if (!active) return
        setWindowsSenderStatus(null)
        setError(reason instanceof Error ? reason.message : '微信发送能力状态读取失败')
        setLoading(false)
      }
    }
    void loadWindowsEndpoint()
    return () => {
      active = false
    }
  }, [refresh])

  const downloadRuntime = async (): Promise<void> => {
    if (runtimeBusy || !personalWechatRuntimeSupported) return
    setRuntimeBusy(true)
    setError('')
    setRuntimeStatus((current) =>
      current ? { ...current, state: 'downloading', downloadedBytes: 0, progress: 0 } : current
    )
    try {
      const result = await window.api.downloadPersonalWechatRuntime()
      setRuntimeStatus(result.status)
      if (!result.success) setError(result.error || '微信发送组件准备失败')
      else onNotice('微信发送组件已准备好')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '微信发送组件准备失败')
    } finally {
      setRuntimeBusy(false)
    }
  }

  const cancelRuntimeDownload = async (): Promise<void> => {
    if (!personalWechatRuntimeSupported) return
    await window.api.cancelPersonalWechatRuntimeDownload()
    onNotice('正在取消发送组件下载')
  }

  const removeRuntime = async (): Promise<void> => {
    if (!personalWechatRuntimeSupported || !runtimeStatus?.removable || runtimeBusy) return
    if (!window.confirm('卸载微信发送组件？以后需要发送个人微信消息时可以重新下载。')) return
    setRuntimeBusy(true)
    try {
      setRuntimeStatus(await window.api.removePersonalWechatRuntime())
      onNotice('微信发送组件已卸载')
    } catch (reason) {
      onNotice(reason instanceof Error ? `发送组件卸载失败：${reason.message}` : '发送组件卸载失败')
    } finally {
      setRuntimeBusy(false)
    }
  }

  const openRuntimeDirectory = async (): Promise<void> => {
    if (!personalWechatRuntimeSupported) return
    const result = await window.api.openPersonalWechatRuntimeDirectory()
    if (!result.success) onNotice(result.error || '无法打开发送组件目录')
  }

  const refreshRuntime = async (): Promise<void> => {
    if (!isMac || runtimeBusy) return
    try {
      setRuntimeStatus(await window.api.getPersonalWechatRuntimeStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '微信发送组件状态读取失败')
    }
  }

  const changeTextBackend = async (next: PersonalWechatTextBackend): Promise<void> => {
    if (next === textBackend) return
    const previous = textBackend
    refreshRevision.current += 1
    pendingCapabilities.delete(cacheKey)
    setLoading(true)
    setTextBackend(next)
    setDetectionAttempted(false)
    snapshots.delete(cacheKey)
    setCapability(null)
    setSenderStatus(null)
    try {
      await window.api.setSettings({ personalWechatTextBackend: next })
      await refresh()
      onNotice(next === 'native' ? '已切换到 C 原生文字发送' : '已切换到 OneBot 文字发送')
    } catch (reason) {
      setTextBackend(previous)
      setLoading(false)
      onNotice(
        reason instanceof Error ? '文字发送后端切换失败：' + reason.message : '文字发送后端切换失败'
      )
    }
  }

  const bindWechat = async (): Promise<void> => {
    if (binding) return
    setBinding(true)
    setError('')
    setDetectionAttempted(false)
    try {
      const nextStatus = await window.api.rebindPersonalWechatSender()
      setSenderStatus(nextStatus)
      const nextCapability = await window.api.getPersonalWechatSendCapability()
      snapshots.set(cacheKey, nextCapability)
      setCapability(nextCapability)
      setSenderStatus(nextCapability.senderStatus)
      if (nextCapability.senderStatus.state !== 'online' && nextCapability.senderStatus.message)
        setError(nextCapability.senderStatus.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '个人微信绑定失败')
    } finally {
      setBinding(false)
    }
  }

  const detectCapability = async (): Promise<void> => {
    if (isWindows) {
      await detectWindowsEndpoint()
      return
    }
    if (detecting) return
    setDetecting(true)
    setDetectionAttempted(true)
    try {
      await refresh()
    } finally {
      setDetecting(false)
    }
  }

  const normalizedWindowsPort = normalizeWindowsPort(windowsPortInput)
  const windowsCanSave = Boolean(
    normalizedWindowsPort &&
    normalizedWindowsPort === windowsDetectedPort &&
    windowsSenderStatus?.endpointReady &&
    windowsSenderStatus.canSend
  )

  const handleWindowsPortInput = (value: string): void => {
    setWindowsPortInput(value)
    setWindowsDetectedPort('')
    setWindowsSenderStatus(null)
  }

  const detectWindowsEndpoint = async (): Promise<void> => {
    if (windowsEndpointBusy) return
    if (!normalizedWindowsPort) {
      onNotice('请输入 1 到 65535 之间的微信发送能力端口')
      return
    }
    setWindowsEndpointBusy(true)
    setError('')
    setWindowsDetectedPort('')
    try {
      const nextStatus = await window.api.checkPersonalWechatSenderStatus(normalizedWindowsPort)
      setWindowsSenderStatus(nextStatus)
      if (nextStatus.endpointReady && nextStatus.canSend) {
        setWindowsDetectedPort(normalizedWindowsPort)
        onNotice('已检测到微信发送能力，请点击保存')
      } else {
        onNotice(nextStatus.error || nextStatus.message || '未检测到微信发送能力')
      }
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '微信发送能力检测失败')
    } finally {
      setWindowsEndpointBusy(false)
    }
  }

  const saveWindowsEndpoint = async (): Promise<void> => {
    if (windowsEndpointBusy || !windowsCanSave || !normalizedWindowsPort) return
    setWindowsEndpointBusy(true)
    try {
      await window.api.setSettings({ windowsWechatPort: normalizedWindowsPort })
      setWindowsDetectedPort('')
      await refresh()
      onNotice('微信发送能力端口已保存')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '微信发送能力端口保存失败')
    } finally {
      setWindowsEndpointBusy(false)
    }
  }

  const clearWindowsEndpoint = async (): Promise<void> => {
    if (windowsEndpointBusy || !windowsPortInput.trim()) return
    setWindowsEndpointBusy(true)
    setError('')
    try {
      await window.api.setSettings({ windowsWechatPort: '' })
      setWindowsPortInput('')
      setWindowsDetectedPort('')
      setWindowsSenderStatus(null)
      await refresh()
      onNotice('微信发送能力端口已清除')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '微信发送能力端口清除失败')
    } finally {
      setWindowsEndpointBusy(false)
    }
  }

  const status = capability?.status || 'error'
  const ready = capability?.ready === true
  const pageStatus: PersonalWechatSendCapability['status'] = isWindows
    ? windowsSenderStatus?.canSend
      ? 'ready'
      : windowsSenderStatus?.state === 'error' && windowsSenderStatus.endpointReady
        ? 'error'
        : windowsPortInput.trim()
          ? 'needs_verification'
          : 'unconfigured'
    : status
  const pageReady = isWindows ? Boolean(windowsSenderStatus?.canSend) : ready
  const pageCapabilities = isWindows
    ? {
        text: Boolean(windowsSenderStatus?.canSendText),
        image: Boolean(windowsSenderStatus?.canSendImage),
        voice: Boolean(windowsSenderStatus?.canSendVoice)
      }
    : capability?.capabilities || { text: false, image: false, voice: false }
  const pageMessage = isWindows
    ? windowsSenderStatus?.message || '请输入端口并检测 Windows 微信发送能力'
    : capability?.message ||
      (loading ? '正在检测当前微信的发送状态…' : '暂未获取发送状态，请重新检测')

  return (
    <>
      <div className="settings-page personal-wechat-send-page">
        <header className="settings-page-header">
          <div>
            <h1>消息发送</h1>
            <p>
              {scope
                ? `${scope.active.sourceLabel} · ${scope.active.label} 的发送配置`
                : '管理个人微信消息发送能力，日报和档案发送都会使用这里的状态。'}
            </p>
          </div>
          <span
            className={`settings-status-badge ${loading ? 'checking' : pageReady ? '' : pageStatus === 'unsupported' ? 'unavailable' : 'warning'}`}
          >
            {loading ? '检测中' : capabilityLabel[pageStatus]}
          </span>
        </header>
        <div className="settings-page-scroll">
          <div className="settings-page-content">
            <>
              {loading && (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  {capability
                    ? '正在更新状态，以下为上次检测结果…'
                    : '正在检测微信连接，配置步骤已展示，请稍候…'}
                </p>
              )}
              {isMac ? (
                <section className="personal-wechat-backend-picker" aria-label="文字发送后端">
                  <div className="personal-wechat-backend-picker-heading">
                    <div>
                      <h2>选择发送方式</h2>
                    </div>
                    <span className="personal-wechat-backend-picker-current">
                      {textBackend === 'native' ? '当前：C 原生工具' : '当前：OneBot'}
                    </span>
                  </div>
                  <Tabs
                    value={textBackend}
                    onValueChange={(value) => {
                      if (value === 'native' || value === 'onebot') void changeTextBackend(value)
                    }}
                  >
                    <TabsList
                      className="personal-wechat-backend-tabs"
                      aria-label="选择文字发送后端"
                    >
                      <TabsTrigger
                        value="native"
                        disabled={loading || binding}
                        className="personal-wechat-backend-tab"
                      >
                        <span className="personal-wechat-backend-tab-title">C 原生工具</span>
                        <span className="personal-wechat-backend-tab-description">
                          文字消息 · 无需下载 OneBot
                        </span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="onebot"
                        disabled={loading || binding}
                        className="personal-wechat-backend-tab"
                      >
                        <span className="personal-wechat-backend-tab-title">OneBot</span>
                        <span className="personal-wechat-backend-tab-description">
                          文字、图片、语音 · 首次需下载
                        </span>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </section>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              {isMac && (
                <>
                  <h2 className="settings-section-heading">配置与检测</h2>
                  <PersonalWechatSetupGuide
                    runtimeStatus={runtimeStatus}
                    senderStatus={senderStatus}
                    runtimeProgress={runtimeProgress}
                    textBackend={textBackend}
                    runtimeBusy={runtimeBusy}
                    binding={binding}
                    detecting={detecting || loading}
                    detectionAttempted={detectionAttempted}
                    sessionBound={boundToCurrentWechat(senderStatus)}
                    onDownloadRuntime={() => void downloadRuntime()}
                    onBind={() => void bindWechat()}
                    onDetect={() => void detectCapability()}
                    startSendingLabel="前往聊天发送"
                    onStartSending={() =>
                      onOpenChat
                        ? onOpenChat()
                        : onNotice('请在聊天助手中选择会话，点击「微信发送」。')
                    }
                    onOpenTextToSpeechSettings={onOpenTextToSpeechSettings}
                  />
                </>
              )}
              <h2 className="settings-section-heading">发送能力</h2>
              <section className="settings-card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="settings-card-kicker">个人微信</span>
                    <strong className="mt-1 block text-base">{pageMessage}</strong>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {pageStatus === 'unsupported' && !isWindows
                        ? '微信消息发送目前仅支持 macOS 和 Windows。'
                        : isWindows
                          ? 'Windows 通过本机微信发送接口工作，请先配置并检测接口端口。'
                          : '档案中的文字、图片和语音发送，以及定时日报发送，都会使用这项能力。'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || detecting || binding}
                    onClick={() => void detectCapability()}
                  >
                    {loading || detecting ? '检测中…' : '重新检测'}
                  </Button>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2" aria-label="微信发送能力明细">
                  {(
                    [
                      ['文字', pageCapabilities.text],
                      ['图片', pageCapabilities.image],
                      ['语音', pageCapabilities.voice]
                    ] as const
                  ).map(([label, available]) => (
                    <div key={label} className="rounded-lg border border-border-subtle px-3 py-2">
                      <span className="block text-xs text-muted-foreground">{label}</span>
                      <strong className="mt-1 block text-sm">
                        {loading && !capability ? '检测中' : available ? '可发送' : '未就绪'}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>

              {isWindows ? (
                <>
                  <h2 className="settings-section-heading">Windows 接口配置</h2>
                  <section className="settings-card tts-runtime-card">
                    <div className="tts-runtime-summary">
                      <span className="settings-card-kicker">Windows</span>
                      <strong>
                        {!windowsSenderStatus
                          ? windowsPortInput
                            ? '待检测'
                            : '未配置'
                          : windowsSenderStatus.canSend
                            ? '微信发送能力已就绪'
                            : windowsSenderStatus.endpointReady
                              ? '接口已连接，但暂不可发送'
                              : '未检测到发送能力'}
                      </strong>
                      <small>{windowsSenderStatus?.message || '输入端口后检测微信发送能力'}</small>
                    </div>
                    <div className="tts-runtime-actions tts-windows-endpoint-actions">
                      <label className="tts-windows-port-field">
                        <span>端口</span>
                        <Input
                          aria-label="微信发送能力端口"
                          className="tts-windows-port-input"
                          type="number"
                          min={1}
                          max={65535}
                          inputMode="numeric"
                          placeholder="端口号"
                          value={windowsPortInput}
                          disabled={windowsEndpointBusy}
                          onChange={(event) => handleWindowsPortInput(event.target.value)}
                        />
                      </label>
                      <Button
                        variant={windowsCanSave ? 'default' : 'outline'}
                        size="sm"
                        disabled={windowsEndpointBusy}
                        onClick={() =>
                          void (windowsCanSave ? saveWindowsEndpoint() : detectWindowsEndpoint())
                        }
                      >
                        {windowsEndpointBusy
                          ? windowsCanSave
                            ? '保存中…'
                            : '检测中…'
                          : windowsCanSave
                            ? '保存'
                            : '检测'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={windowsEndpointBusy || !windowsPortInput.trim()}
                        onClick={() => void clearWindowsEndpoint()}
                      >
                        清除端口
                      </Button>
                    </div>
                  </section>
                </>
              ) : isMac ? (
                <>
                  {textBackend === 'onebot' ? (
                    <>
                      <h2 className="settings-section-heading">OneBot 运行时</h2>
                      <section className="settings-card tts-runtime-card">
                        <div className="tts-runtime-summary">
                          <span className="settings-card-kicker">
                            OneBot {runtimeStatus?.version || 'v0.0.18'}
                          </span>
                          <strong>
                            {runtimeStatus?.state === 'downloading'
                              ? `正在下载 ${Math.round(runtimeStatus.progress * 100)}%`
                              : runtimeStatus
                                ? RUNTIME_STATUS_LABELS[runtimeStatus.state]
                                : '正在检测'}
                          </strong>
                          <small>
                            {!runtimeStatus
                              ? '正在检测当前平台与组件状态'
                              : personalWechatRuntimeSupported
                                ? `仅用于连接 macOS 微信 · ${formatBytes(runtimeStatus.totalBytes)}`
                                : '当前 Mac 环境不满足个人微信发送组件要求'}
                          </small>
                          {runtimeStatus?.error ? (
                            <p className="tts-runtime-error">{runtimeStatus.error}</p>
                          ) : null}
                        </div>

                        <div className="tts-runtime-actions">
                          {personalWechatRuntimeSupported &&
                          runtimeStatus?.state === 'downloading' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void cancelRuntimeDownload()}
                            >
                              取消下载
                            </Button>
                          ) : personalWechatRuntimeSupported && runtimeStatus?.state === 'ready' ? (
                            <>
                              {runtimeStatus.directory ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void openRuntimeDirectory()}
                                >
                                  打开目录
                                </Button>
                              ) : null}
                              {runtimeStatus.removable ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={runtimeBusy}
                                  onClick={() => void removeRuntime()}
                                >
                                  卸载组件
                                </Button>
                              ) : null}
                            </>
                          ) : personalWechatRuntimeSupported ? (
                            <Button
                              size="sm"
                              disabled={runtimeBusy}
                              onClick={() => void downloadRuntime()}
                            >
                              {runtimeStatus?.state === 'invalid' ||
                              runtimeStatus?.state === 'error'
                                ? '重新下载'
                                : '下载组件'}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={runtimeBusy}
                            onClick={() => void refreshRuntime()}
                          >
                            重新检测组件
                          </Button>
                          {personalWechatRuntimeSupported ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                runtimeVersionsTriggerRef.current = event.currentTarget
                                setShowWechatVersions(true)
                              }}
                            >
                              支持版本
                            </Button>
                          ) : null}
                        </div>

                        {personalWechatRuntimeSupported &&
                        runtimeStatus?.state === 'downloading' ? (
                          <div className="tts-runtime-progress">
                            <div>
                              <span>{Math.round(runtimeStatus.progress * 100)}%</span>
                              <small>
                                {formatBytes(runtimeStatus.downloadedBytes)} /{' '}
                                {formatBytes(runtimeStatus.totalBytes)}
                              </small>
                            </div>
                            <progress
                              value={runtimeStatus.progress}
                              max={1}
                              aria-label="微信发送组件下载进度"
                            />
                          </div>
                        ) : null}
                      </section>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          </div>
        </div>
      </div>
      <Dialog open={showWechatVersions} onOpenChange={setShowWechatVersions}>
        <DialogContent
          className="max-h-[calc(100vh-3rem)] max-w-[620px] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            const trigger = runtimeVersionsTriggerRef.current
            if (!trigger) return
            event.preventDefault()
            trigger.focus()
            runtimeVersionsTriggerRef.current = null
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle className="text-lg">支持的微信版本</DialogTitle>
            <DialogDescription>请安装下列完整版本之一。</DialogDescription>
          </DialogHeader>
          <PersonalWechatSupportedVersionsContent />
        </DialogContent>
      </Dialog>
    </>
  )
}
