import { useState, type ReactNode } from 'react'
import {
  canActivatePersonalWechatXsend,
  type PersonalWechatSenderStatus,
  type PersonalWechatTextBackend
} from '../../../../shared/personal-wechat'
import type {
  PersonalWechatRuntimeProgressEvent,
  PersonalWechatRuntimeStatus
} from '../../../../shared/personal-wechat-runtime'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui'
import { isMac } from '../../utils/runtime-environment'
import { PersonalWechatSupportedVersionsContent } from './PersonalWechatSupportedVersionsContent'

interface PersonalWechatSetupGuideProps {
  runtimeStatus: PersonalWechatRuntimeStatus | null
  senderStatus: PersonalWechatSenderStatus | null
  runtimeProgress: PersonalWechatRuntimeProgressEvent | null
  textBackend: PersonalWechatTextBackend
  runtimeBusy: boolean
  binding: boolean
  detecting: boolean
  detectionAttempted: boolean
  sessionBound: boolean
  onDownloadRuntime: () => void
  onBind: () => void
  onDetect: () => void
  onStartSending: () => void
  startSendingLabel?: string
  onOpenTextToSpeechSettings?: () => void
}

type StepState = 'current' | 'complete' | 'pending'

function SetupStep({
  number,
  title,
  summary,
  state,
  children
}: {
  number: number
  title: string
  summary: string
  state: StepState
  children?: ReactNode
}): React.ReactElement {
  return (
    <li className={`is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="personal-wechat-step-number" aria-hidden="true">
        {state === 'complete' ? '✓' : number}
      </span>
      <div className="personal-wechat-step-content">
        <div className="personal-wechat-step-heading">
          <strong>{title}</strong>
          <span className="personal-wechat-step-label">
            {state === 'complete' ? '已完成' : state === 'current' ? '当前步骤' : '待完成'}
          </span>
        </div>
        {state !== 'complete' && <p>{summary}</p>}
        {state === 'current' && <div className="personal-wechat-step-action">{children}</div>}
      </div>
    </li>
  )
}

function diagnosticValue(value: unknown): string {
  return value === undefined || value === null || value === '' ? '未检测到' : String(value)
}

function isWechatBound(status: PersonalWechatSenderStatus): boolean {
  return (
    status.state === 'online' ||
    Boolean(
      status.state === 'hook_not_ready' &&
      status.wechatPid &&
      status.boundWechatPid === status.wechatPid &&
      status.attachReady &&
      status.baseAddressReady
    )
  )
}

export function PersonalWechatSetupGuide({
  runtimeStatus,
  senderStatus,
  runtimeProgress,
  textBackend,
  runtimeBusy,
  binding,
  detecting,
  detectionAttempted,
  sessionBound,
  onDownloadRuntime,
  onBind,
  onDetect,
  onStartSending,
  startSendingLabel = '开始发送',
  onOpenTextToSpeechSettings
}: PersonalWechatSetupGuideProps): React.ReactElement {
  const [showSupportedVersions, setShowSupportedVersions] = useState(false)
  const nativeTextMode = isMac && textBackend === 'native'
  const xsend = senderStatus?.xsend
  const nativeReady = Boolean(senderStatus?.canSendText)
  const profileReady = nativeReady || Boolean(xsend?.ready) || canActivatePersonalWechatXsend(xsend)
  const profileUnmatched = xsend?.state === 'runtime_profile_unmatched'
  const wechatMissing =
    senderStatus?.state === 'wechat_not_running' || xsend?.state === 'wechat_not_running'
  const runtimeReady = runtimeStatus
    ? runtimeStatus.state === 'ready'
    : senderStatus?.runtimeReady === true
  const runtimeDownloading = runtimeBusy || runtimeStatus?.state === 'downloading'
  const connected = sessionBound && Boolean(senderStatus && isWechatBound(senderStatus))
  const voiceReady = Boolean(senderStatus?.canSendVoice)
  const allReady = nativeTextMode ? nativeReady : runtimeReady && connected && voiceReady
  const completedCount = allReady
    ? 3
    : nativeTextMode
      ? Number(profileReady)
      : Number(runtimeReady) + Number(runtimeReady && connected)
  const currentStep = completedCount + 1
  const stateFor = (step: number): StepState =>
    step <= completedCount ? 'complete' : step === currentStep ? 'current' : 'pending'
  const busy = binding || detecting
  const progress = runtimeProgress || runtimeStatus
  const progressPercent = Math.max(0, Math.min(100, Math.round((progress?.progress || 0) * 100)))
  const bindingBlocked =
    senderStatus?.state === 'unsupported_version' ||
    senderStatus?.state === 'unsupported_platform' ||
    senderStatus?.state === 'sip_enabled'
  const checkHint = wechatMissing
    ? '请先打开微信并登录账号，再回到这里检查。'
    : profileUnmatched
      ? detectionAttempted
        ? '重新检查后仍未匹配。请更新 YUYU，或切换到 OneBot 发送方式。'
        : '已找到微信，但当前运行组件尚未匹配。先重新检查，再决定是否需要更新。'
      : xsend?.state === 'integrity_error'
        ? '发送组件校验未通过，请更新或重新安装 YUYU 后再检查。'
        : xsend?.state === 'unsupported_version' || xsend?.state === 'unsupported_platform'
          ? '当前微信版本或系统暂未适配，请更新 YUYU 或选择其他发送方式。'
          : '保持微信已登录，YUYU 会自动检查是否可以启用文字发送。'

  return (
    <section className="personal-wechat-setup" aria-label="微信消息功能配置" aria-busy={busy}>
      <div className="personal-wechat-setup-heading">
        <div>
          <span className="personal-wechat-eyebrow">
            {allReady ? '配置完成' : '跟着步骤完成设置'}
          </span>
          <h2>
            {allReady
              ? '微信发送已准备好'
              : nativeTextMode
                ? '开启微信文字发送'
                : '连接微信消息发送'}
          </h2>
          <p>
            {nativeTextMode
              ? 'C 原生工具用于文字消息；图片和语音需要 OneBot。'
              : '首次下载组件后，连接已登录的微信并检查发送能力。'}
          </p>
        </div>
        <span className={`personal-wechat-setup-progress ${allReady ? 'is-complete' : ''}`}>
          {detecting ? '更新状态中' : allReady ? '全部完成' : `${completedCount} / 3 已完成`}
        </span>
      </div>

      {allReady && (
        <div className="personal-wechat-setup-result">
          <div>
            <strong>{nativeTextMode ? '可以发送文字了' : '可以发送语音了'}</strong>
            <p>在聊天助手中选择会话，点击「微信发送」即可。</p>
          </div>
          <Button size="sm" onClick={onStartSending} disabled={binding}>
            {startSendingLabel}
          </Button>
        </div>
      )}

      <ol className="personal-wechat-steps" aria-label="发送设置步骤">
        {nativeTextMode ? (
          <>
            <SetupStep
              number={1}
              title="检查微信"
              state={stateFor(1)}
              summary={profileReady ? '已确认微信兼容，可以继续启用。' : checkHint}
            >
              <Button size="sm" onClick={onDetect} disabled={busy}>
                {detecting
                  ? '正在检查微信…'
                  : wechatMissing
                    ? '我已登录，重新检查'
                    : detectionAttempted
                      ? '重新检查'
                      : '开始准备'}
              </Button>
              {!detecting && !detectionAttempted && <small>先检查即可，无需提前退出微信。</small>}
            </SetupStep>
            <SetupStep
              number={2}
              title="启用文字发送"
              state={stateFor(2)}
              summary={
                nativeReady
                  ? '已连接当前微信，文字发送已启用。'
                  : profileReady
                    ? '点击启用，连接当前登录的微信。'
                    : '完成微信检查后，即可启用。'
              }
            >
              <Button size="sm" onClick={onBind} disabled={busy}>
                {binding ? '正在连接微信…' : '启用文字发送'}
              </Button>
              <small>保持微信运行；重新登录后可能需要再次启用。</small>
            </SetupStep>
            <SetupStep
              number={3}
              title="准备完成"
              state={stateFor(3)}
              summary={nativeReady ? '文字消息可发送。' : '启用后自动确认结果，无需发送测试消息。'}
            />
          </>
        ) : (
          <>
            <SetupStep
              number={1}
              title="准备发送组件"
              state={stateFor(1)}
              summary={
                runtimeReady
                  ? 'OneBot 组件已准备好，无需重复下载。'
                  : runtimeStatus?.state === 'unsupported'
                    ? '当前系统不支持下载此组件，请选择其他发送方式。'
                    : '首次使用下载一次，之后可以直接连接微信。'
              }
            >
              {runtimeDownloading ? (
                <div className="personal-wechat-download-progress" aria-live="polite">
                  <div>
                    <span>正在下载发送组件</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <progress value={progressPercent} max={100} aria-label="发送组件下载进度" />
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={onDownloadRuntime}
                  disabled={runtimeBusy || detecting || !runtimeStatus?.supported}
                >
                  {runtimeStatus?.error ? '重新下载组件' : '下载并继续'}
                </Button>
              )}
              {runtimeStatus?.error && !runtimeDownloading && (
                <p className="personal-wechat-step-error">下载未完成，请检查网络后重试。</p>
              )}
            </SetupStep>
            <SetupStep
              number={2}
              title="连接个人微信"
              state={stateFor(2)}
              summary={
                connected
                  ? '已连接当前登录的微信。'
                  : runtimeReady
                    ? wechatMissing
                      ? '请先打开并登录微信，再点击连接。'
                      : senderStatus?.state === 'sip_enabled'
                        ? '当前系统权限不满足连接要求，请展开高级诊断查看原因。'
                        : bindingBlocked
                          ? '当前微信无法连接，请先查看支持版本和诊断信息。'
                          : '保持微信已登录，连接当前正在使用的账号。'
                    : '组件准备好后，再连接已登录的微信。'
              }
            >
              <div className="personal-wechat-step-actions">
                <Button
                  size="sm"
                  onClick={onBind}
                  disabled={busy || runtimeDownloading || bindingBlocked}
                >
                  {binding ? '正在连接微信…' : '连接微信'}
                </Button>
                {bindingBlocked && (
                  <Button size="sm" variant="outline" onClick={onDetect} disabled={busy}>
                    重新检查
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setShowSupportedVersions(true)}>
                  查看支持版本
                </Button>
              </div>
              <small>连接时微信可能退出。如发生，请重新登录后再试。</small>
            </SetupStep>
            <SetupStep
              number={3}
              title="验证消息能力"
              state={stateFor(3)}
              summary={
                allReady
                  ? '语音消息已就绪，可以开始发送。'
                  : connected
                    ? '检查连接结果，确认语音消息可以发送。'
                    : '连接成功后，检查发送能力。'
              }
            >
              <div className="personal-wechat-step-actions">
                <Button size="sm" onClick={onDetect} disabled={busy}>
                  {detecting ? '正在检测…' : '检测发送能力'}
                </Button>
                <Button size="sm" variant="ghost" onClick={onBind} disabled={busy}>
                  重新连接
                </Button>
              </div>
              {detectionAttempted && !detecting && !voiceReady && (
                <p className="personal-wechat-step-warning">
                  语音消息暂未就绪。可先在微信中给文件传输助手发送一张图片，再回来检测。
                </p>
              )}
            </SetupStep>
          </>
        )}
      </ol>

      {!nativeTextMode &&
        !runtimeReady &&
        runtimeStatus?.state === 'unsupported' &&
        onOpenTextToSpeechSettings && (
          <Button variant="ghost" size="sm" onClick={onOpenTextToSpeechSettings}>
            查看语音设置
          </Button>
        )}

      <Dialog open={showSupportedVersions} onOpenChange={setShowSupportedVersions}>
        <DialogContent className="max-h-[calc(100vh-3rem)] max-w-[620px] overflow-y-auto">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-lg">支持的微信版本</DialogTitle>
            <DialogDescription>请安装下列完整版本之一。</DialogDescription>
          </DialogHeader>
          <PersonalWechatSupportedVersionsContent />
        </DialogContent>
      </Dialog>

      <details className="personal-wechat-diagnostics">
        <summary>高级诊断</summary>
        <p>仅用于排查连接问题，普通使用无需关注这些信息。</p>
        <dl>
          {[
            ['发送方式', nativeTextMode ? 'C 原生工具' : 'OneBot'],
            ['连接状态', diagnosticValue(senderStatus?.message)],
            ['连接详情', diagnosticValue(senderStatus?.error)],
            ['兼容配置', diagnosticValue(xsend?.runtimeProfileName)],
            ['原生组件状态', diagnosticValue(xsend?.message)],
            ['原生组件详情', diagnosticValue(xsend?.error)],
            ['微信进程', senderStatus?.wechatPid ? `PID ${senderStatus.wechatPid}` : '未检测到'],
            ...(isMac
              ? [['OneBot', senderStatus?.oneBotPid ? `PID ${senderStatus.oneBotPid}` : '未启动']]
              : []),
            ['绑定进程', diagnosticValue(senderStatus?.boundWechatPid)],
            [
              '接口监听',
              `${diagnosticValue(senderStatus?.endpoint)} · ${senderStatus?.endpointReady ? '监听中' : '未监听'}`
            ],
            [
              '基址扫描',
              senderStatus?.baseAddress || (senderStatus?.baseAddressReady ? '已完成' : '未完成')
            ],
            ['文字 Hook', senderStatus?.textHookReady ? '已就绪' : '未就绪'],
            ['图片 Hook', senderStatus?.imageHookReady ? '已就绪' : '未就绪'],
            ['语音能力', senderStatus?.canSendVoice ? '可发送' : '未就绪'],
            ['消息监听', senderStatus?.messageListenerReady ? '正常' : '未就绪'],
            ['微信版本', diagnosticValue(senderStatus?.wechatVersion)],
            [
              '运行时',
              runtimeStatus?.version
                ? `${runtimeStatus.version} · ${runtimeStatus.state}`
                : diagnosticValue(senderStatus?.runtimeReady)
            ]
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
