import React, { useState } from 'react'
import { RuntimeManagerButton } from '../features/settings/components/RuntimeManagerButton'
import type { DatabaseKeyEnvironment, WechatAccountCandidate } from '../../../shared/database-key'
import { WINDOWS_VC_RUNTIME_DOWNLOAD_URL } from '../../../shared/windows-runtime'
import { Button, IconButton, Input, Tabs, TabsList, TabsTrigger } from './ui'
import { UsageGuideButton } from './UsageGuideButton'

export type DatabaseConnectionMode = 'automatic' | 'manual'
export type DatabaseConnectionStatusKind = 'normal' | 'success' | 'error'

interface DatabaseConnectionPageProps {
  showWechatSetup?: boolean
  onShowWechatSetup?: (show: boolean) => void
  onConfigureSource?: (application: 'dingtalk' | 'telegram') => void
  platform: string
  mode: DatabaseConnectionMode
  dbKey: string
  dbRoot: string
  showDbKey: boolean
  isFetching: boolean
  isConnecting: boolean
  guideStep: 1 | 2 | 3 | 4 | 5 | 6
  environment?: DatabaseKeyEnvironment
  accounts: WechatAccountCandidate[]
  selectedAccountId: string
  status: string
  statusKind: DatabaseConnectionStatusKind
  showMacKeyFaq: boolean
  macKeyFaqUrl: string
  onModeChange: (mode: DatabaseConnectionMode) => void
  onDbKeyChange: (value: string) => void
  onDbRootChange: (value: string) => void
  onSelectAccount: (account: WechatAccountCandidate) => void
  onSelectDbRoot: () => void
  onToggleDbKey: () => void
  onAutoGetKey: () => void
  onInstallIntelKeyRuntime: () => void
  onRefreshEnvironment: () => void
  onGuideNext: () => void
  onGuideBack: () => void
  onGuideCancel: () => void
  onValidateConnection: () => void
  onCopyDiagnostics: () => void
  onManualConnect: () => void
  onPasteKey: () => void
  onClearKey: () => void
  onAddSource?: () => void
  onEnterWorkspace?: () => void
}

function LineIcon({
  name
}: {
  name: 'shield' | 'lock' | 'cloud' | 'info' | 'database'
}): React.ReactElement {
  const paths = {
    shield: <path d="M12 3 5 6v5c0 4.5 2.8 7.7 7 10 4.2-2.3 7-5.5 7-10V6l-7-3Z" />,
    lock: <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Z" />,
    cloud: (
      <path d="m4 4 16 16M7.5 16H6a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 17 6.8M18.5 10A4 4 0 0 1 18 18h-7" />
    ),
    info: <path d="M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />,
    database: (
      <path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Zm0 0v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6m-14 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name]}
      </g>
    </svg>
  )
}

function EyeIcon({ visible }: { visible: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="M4 4l16 16" />}
    </svg>
  )
}

function StoragePathHelp(): React.ReactElement {
  return (
    <span className="database-login-path-help">
      <span
        className="database-login-path-help-icon"
        tabIndex={0}
        aria-describedby="storage-path-help"
      >
        !
      </span>
      <span id="storage-path-help" className="database-login-path-tooltip" role="tooltip">
        打开微信设置，在缓存管理中复制存储路径，然后粘贴到这里。
      </span>
    </span>
  )
}

export function DatabaseConnectionPage({
  showWechatSetup,
  onShowWechatSetup,
  onConfigureSource,
  platform,
  mode,
  dbKey,
  dbRoot,
  showDbKey,
  isFetching,
  isConnecting,
  guideStep,
  environment,
  accounts = [],
  selectedAccountId = '',
  status,
  statusKind,
  showMacKeyFaq,
  macKeyFaqUrl,
  onModeChange,
  onDbKeyChange,
  onDbRootChange,
  onSelectAccount,
  onSelectDbRoot,
  onToggleDbKey,
  onAutoGetKey,
  onInstallIntelKeyRuntime,
  onRefreshEnvironment,
  onGuideNext,
  onGuideBack,
  onGuideCancel,
  onValidateConnection,
  onCopyDiagnostics,
  onManualConnect,
  onPasteKey,
  onClearKey,
  onAddSource,
  onEnterWorkspace
}: DatabaseConnectionPageProps): React.ReactElement {
  const [localWechatSetup, setLocalWechatSetup] = useState(false)
  const wechatSetup = showWechatSetup ?? localWechatSetup
  const setWechatSetup = (show: boolean): void => {
    setLocalWechatSetup(show)
    onShowWechatSetup?.(show)
  }
  const connectionStage = guideStep === 1 ? 0 : guideStep <= 4 ? 1 : 2
  const isMac = platform === 'darwin'
  const isIntelMac = isMac && environment?.architecture === 'x64'
  const isAppleSiliconMac = isMac && !isIntelMac
  const defaultPath = isMac
    ? '~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/'
    : 'C:\\WeChat Files\\Msg'
  const keyIsValid = /^[0-9a-f]{64}$/i.test(dbKey.trim().replace(/^0x/i, ''))

  return (
    <main className="database-login-page">
      <section className="database-login-brand" aria-label="语屿 YUYU 产品说明">
        <div className="database-login-brand-content">
          <div className="database-login-logo" aria-hidden="true">
            <LineIcon name="database" />
          </div>
          <h1>语屿 YUYU</h1>
          <p className="database-login-tagline">连接你的数据，按需使用 AI</p>
          <p className="database-login-description">
            从微信、钉钉或 Telegram
            开始，按需安装工具、连接数据源。各数据源支持的能力以工作区提示为准。
          </p>
          <div className="database-login-promises">
            <div>
              <LineIcon name="shield" />
              <span>仅限本机</span>
            </div>
            <div>
              <LineIcon name="lock" />
              <span>加密保存</span>
            </div>
            <div>
              <LineIcon name="cloud" />
              <span>AI 按需启用</span>
            </div>
          </div>
        </div>
        <div className="database-login-brand-footer">LOCAL-FIRST · PRIVATE · SECURE</div>
      </section>

      <section className="database-login-workspace" aria-label="数据库连接">
        <div className="database-login-panel">
          {!wechatSetup ? (
            <section className="database-onboarding" aria-label="开始使用">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="database-login-eyebrow">欢迎使用</p>
                  <h2>选择你的开始方式</h2>
                </div>
                <UsageGuideButton />
              </div>
              <p className="database-onboarding-intro">
                连接数据源不是进入应用的前提，你可以随时在主界面继续配置。
              </p>
              <ol className="database-onboarding-roadmap" aria-label="按需配置路线">
                <li>
                  <span>1</span>
                  <strong>选择数据源</strong>
                  <small>微信、钉钉或 Telegram</small>
                </li>
                <li>
                  <span>2</span>
                  <strong>准备运行时</strong>
                  <small>按需安装，JSON 导入无需安装</small>
                </li>
                <li>
                  <span>3</span>
                  <strong>连接并使用</strong>
                  <small>按所选数据源完成配置</small>
                </li>
              </ol>
              {onEnterWorkspace && (
                <div className="database-onboarding-direct">
                  <strong>先看看应用，再决定连接什么</strong>
                  <p>在主界面管理运行时、添加数据源，也可以先完成其他设置。</p>
                  <Button onClick={onEnterWorkspace} disabled={isFetching || isConnecting}>
                    暂不连接，进入主界面
                  </Button>
                </div>
              )}
              <h3>现在配置一个数据源</h3>
              <div className="database-onboarding-sources">
                <Button
                  variant="outline"
                  onClick={() => setWechatSetup(true)}
                  disabled={isFetching || isConnecting}
                >
                  配置微信
                </Button>
                {(onConfigureSource || onAddSource) && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        onConfigureSource ? onConfigureSource('dingtalk') : onAddSource?.()
                      }
                      disabled={isFetching || isConnecting}
                    >
                      配置钉钉
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        onConfigureSource ? onConfigureSource('telegram') : onAddSource?.()
                      }
                      disabled={isFetching || isConnecting}
                    >
                      配置 Telegram
                    </Button>
                  </>
                )}
              </div>
              <div className="database-onboarding-runtime">
                <RuntimeManagerButton />
                <p>还没准备工具？可先安装，完成后再连接。下载不会登录账号。</p>
              </div>
            </section>
          ) : (
            <>
              <div className="database-login-start">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWechatSetup(false)}
                    disabled={isFetching || isConnecting}
                  >
                    ← 返回使用方式
                  </Button>
                  <UsageGuideButton />
                </div>
                <p className="database-login-eyebrow">微信数据源配置</p>
                <h2>开始连接微信</h2>
                <p>以下步骤仅用于本机微信连接。未准备工具时，可先管理微信运行时。</p>
                <div className="database-login-entry-actions">
                  <RuntimeManagerButton application="wechat" label="管理微信运行时" />
                  {onEnterWorkspace && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onEnterWorkspace}
                      disabled={isFetching || isConnecting}
                    >
                      暂不连接，进入主界面
                    </Button>
                  )}
                </div>
              </div>
              <Tabs
                value={mode}
                onValueChange={(value) => onModeChange(value as DatabaseConnectionMode)}
              >
                <TabsList
                  className="database-login-tabs grid h-auto w-full grid-cols-2"
                  aria-label="连接方式"
                >
                  <TabsTrigger value="automatic">开始连接</TabsTrigger>
                  <TabsTrigger value="manual">高级用户：已有数据库密钥？手动连接</TabsTrigger>
                </TabsList>

                {mode === 'automatic' ? (
                  <div className="database-login-auto" role="tabpanel">
                    <ol className="database-login-guide-progress" aria-label="微信连接阶段">
                      {['检查环境', '准备并获取密钥', '验证连接'].map((label, index) => (
                        <li
                          key={label}
                          aria-current={index === connectionStage ? 'step' : undefined}
                          className={
                            index < connectionStage
                              ? 'complete'
                              : index === connectionStage
                                ? 'active'
                                : ''
                          }
                        >
                          <span>{index < connectionStage ? '✓' : index + 1}</span>
                          <strong>{label}</strong>
                        </li>
                      ))}
                    </ol>
                    <div className={`database-login-state-card ${statusKind}`}>
                      <div className="database-login-state-heading">
                        <span className="database-login-state-icon">
                          <LineIcon name="info" />
                        </span>
                        <div>
                          <strong>
                            {statusKind === 'error'
                              ? '当前步骤未完成'
                              : [
                                  '检查本机环境',
                                  '让微信停在登录页面',
                                  isMac ? '确认开始获取密钥' : '确认开始准备',
                                  isIntelMac
                                    ? '正在获取 Intel Mac 密钥'
                                    : isAppleSiliconMac
                                      ? '正在监听 macOS 登录密钥'
                                      : '正在完成 Windows 授权',
                                  isMac
                                    ? '获取成功，验证数据库连接'
                                    : '获取成功, 现在可以重新登录微信了',
                                  '验证数据库连接'
                                ][guideStep - 1]}
                          </strong>
                          <p>
                            {statusKind === 'error'
                              ? status
                              : status ||
                                [
                                  '确认下方检测结果；没有找到目录时可以手动选择。',
                                  isMac
                                    ? '请启动微信并停留在未登录界面，暂时不要点击登录，然后点击“我已准备好”。'
                                    : '请退出当前微信账号，让微信停留在登录页面，然后点击“我已准备好”。',
                                  isMac ? '确认开始获取密钥。' : '开始后请按页面提示完成系统授权。',
                                  isMac
                                    ? '等页面提示可以登录后，立即回到微信点击登录。'
                                    : '正在准备连接组件，请不要关闭微信或 YUYU。',
                                  isMac
                                    ? '密钥已获取，请继续验证数据库。'
                                    : '请回到微信完成登录，登录成功后再回来验证。',
                                  '正在验证密钥和本地数据库，请稍候。'
                                ][guideStep - 1]}
                          </p>
                        </div>
                      </div>
                      {guideStep === 1 && (
                        <>
                          <dl className="database-login-diagnostics">
                            <div>
                              <dt>操作系统</dt>
                              <dd>{environment?.osVersion || (isMac ? 'macOS' : 'Windows')}</dd>
                            </div>
                            <div>
                              <dt>微信版本</dt>
                              <dd>{environment?.wechatVersion || '未检测到'}</dd>
                            </div>
                            <div>
                              <dt>数据结构</dt>
                              <dd>{environment?.dataStructureVersion || '未检测到'}</dd>
                            </div>
                            <div>
                              <dt>
                                存储路径
                                <StoragePathHelp />
                              </dt>
                              <dd>
                                <span className="database-login-path-input-wrap">
                                  <Input
                                    className="h-9 border-0 bg-transparent px-0 text-right shadow-none"
                                    type="text"
                                    value={dbRoot}
                                    onChange={(event) => onDbRootChange(event.target.value)}
                                    placeholder={defaultPath}
                                    title={dbRoot || defaultPath}
                                    aria-label="微信数据存储路径"
                                    spellCheck={false}
                                    onFocus={(event) => event.currentTarget.select()}
                                  />
                                  <span className="database-login-path-value" role="status">
                                    {dbRoot || defaultPath}
                                  </span>
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="database-login-path-select"
                                  onClick={onSelectDbRoot}
                                  disabled={isFetching || isConnecting}
                                >
                                  选择目录
                                </Button>
                              </dd>
                            </div>
                            <div>
                              <dt>微信状态</dt>
                              <dd>{environment?.wechatRunning ? '运行中' : '未检测到'}</dd>
                            </div>
                            {isIntelMac && (
                              <>
                                <div>
                                  <dt>连接环境</dt>
                                  <dd>
                                    {environment?.pythonAvailable && environment?.fridaAvailable
                                      ? '已准备好'
                                      : '需要准备'}
                                    {(!environment?.pythonAvailable ||
                                      !environment?.fridaAvailable) && (
                                      <Button
                                        variant="link"
                                        size="sm"
                                        onClick={onInstallIntelKeyRuntime}
                                        disabled={isFetching}
                                      >
                                        准备环境
                                      </Button>
                                    )}
                                  </dd>
                                </div>
                              </>
                            )}
                          </dl>
                          {accounts.length > 0 && (
                            <section className="database-account-list" aria-label="选择微信账号">
                              <h3>选择微信账号</h3>
                              {accounts.map((account) => (
                                <button
                                  type="button"
                                  key={account.id}
                                  className={`database-account-card ${selectedAccountId === account.id ? 'selected' : ''}`}
                                  aria-pressed={selectedAccountId === account.id}
                                  onClick={() => onSelectAccount(account)}
                                >
                                  <span className="database-account-avatar">
                                    {account.avatar ? (
                                      <img src={account.avatar} alt="" />
                                    ) : (
                                      (account.nickname || account.directoryName || '?').charAt(0)
                                    )}
                                  </span>
                                  <span className="database-account-identity">
                                    <strong>
                                      {account.nickname ||
                                        (account.wxid
                                          ? `微信账号 ${account.wxid}`
                                          : `账号目录 ${account.directoryName || '待识别'}`)}
                                    </strong>
                                    <small>
                                      {account.nickname
                                        ? account.wxid || '微信号未读取'
                                        : account.wxid
                                          ? '昵称和头像需连接此账号后读取'
                                          : '连接后读取微信号、昵称和头像'}
                                    </small>
                                    <code title={account.accountRoot}>{account.accountRoot}</code>
                                  </span>
                                  <span className="database-account-status">
                                    {account.hasSavedDbKey ? '已有可用密钥' : '尚无可用密钥'}
                                    <small>
                                      {account.loginStatus === 'current'
                                        ? '当前已连接账号'
                                        : account.loginStatus === 'other'
                                          ? '非当前账号'
                                          : '登录状态未确认'}
                                    </small>
                                  </span>
                                </button>
                              ))}
                              <Button
                                variant="outline"
                                className="database-login-secondary"
                                onClick={onSelectDbRoot}
                                disabled={isFetching || isConnecting}
                              >
                                选择其他账号
                              </Button>
                            </section>
                          )}
                        </>
                      )}
                    </div>
                    {guideStep === 1 && (
                      <>
                        <Button
                          className="database-login-primary"
                          onClick={onGuideNext}
                          disabled={!selectedAccountId}
                        >
                          检查完成，继续
                        </Button>
                        <Button
                          variant="outline"
                          className="database-login-secondary"
                          onClick={onRefreshEnvironment}
                        >
                          重新检查环境
                        </Button>
                        <Button
                          variant="link"
                          className="database-login-text-action"
                          onClick={onCopyDiagnostics}
                        >
                          复制脱敏诊断摘要
                        </Button>
                      </>
                    )}
                    {guideStep === 2 && (
                      <Button className="database-login-primary" onClick={onGuideNext}>
                        我已准备好
                      </Button>
                    )}
                    {guideStep === 3 && (
                      <Button className="database-login-primary" onClick={onAutoGetKey}>
                        {isMac ? '开始获取密钥' : '开始准备连接组件'}
                      </Button>
                    )}
                    {guideStep === 4 && (
                      <Button className="database-login-primary" disabled>
                        {isMac ? '正在获取密钥…' : '正在准备连接组件…'}
                      </Button>
                    )}
                    {guideStep === 5 && (
                      <Button
                        className="database-login-primary"
                        onClick={onValidateConnection}
                        disabled={!dbKey || isConnecting}
                      >
                        {isConnecting ? '正在验证…' : '验证连接'}
                      </Button>
                    )}
                    {guideStep === 6 && (
                      <Button className="database-login-primary" disabled>
                        正在验证数据库…
                      </Button>
                    )}
                    {guideStep > 1 && !isFetching && !isConnecting && (
                      <div className="database-login-guide-actions">
                        <Button variant="link" size="sm" onClick={onGuideBack}>
                          返回上一步
                        </Button>
                        <Button variant="link" size="sm" onClick={onGuideCancel}>
                          取消并重新检查
                        </Button>
                      </div>
                    )}
                    {(isFetching || isConnecting) && (
                      <Button
                        variant="link"
                        className="database-login-text-action"
                        onClick={onGuideCancel}
                      >
                        取消
                      </Button>
                    )}
                    <p className="database-login-platform-note">
                      {isMac ? (
                        <>
                          macOS 首次获取密钥需要关闭 SIP，并在监听期间点击微信登录。{' '}
                          <a href={macKeyFaqUrl} target="_blank" rel="noreferrer">
                            查看说明
                          </a>
                          <br />
                          开始获取密钥前不要登录微信，保留微信登录页面窗口；完成授权并看到可以登录的提示后，再点击「登录」。
                        </>
                      ) : (
                        <>
                          Windows 需要 Microsoft Visual C++ 2015-2022 x64 运行库。{' '}
                          <a
                            href={WINDOWS_VC_RUNTIME_DOWNLOAD_URL}
                            target="_blank"
                            rel="noreferrer"
                          >
                            下载运行库
                          </a>
                        </>
                      )}
                    </p>
                    {showMacKeyFaq && isMac && (
                      <a href={macKeyFaqUrl} target="_blank" rel="noreferrer">
                        获取失败？查看连接排查
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="database-login-manual" role="tabpanel">
                    <p className="database-login-manual-note">
                      仅适用于已经通过其他方式获得当前微信账号数据库密钥的高级用户。第一次使用请返回“开始连接”。
                    </p>
                    <div className="database-login-field">
                      <label htmlFor="database-login-key">数据库密钥</label>
                      <div className="database-login-key-input">
                        <Input
                          id="database-login-key"
                          type={showDbKey ? 'text' : 'password'}
                          value={dbKey}
                          onChange={(event) => onDbKeyChange(event.target.value)}
                          placeholder="输入或粘贴 64 位数据库密钥"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <IconButton
                          variant="ghost"
                          onClick={onToggleDbKey}
                          label={showDbKey ? '隐藏密钥' : '显示密钥'}
                        >
                          <EyeIcon visible={showDbKey} />
                        </IconButton>
                      </div>
                      <small>密钥通过系统安全存储加密保存在当前设备。</small>
                    </div>
                    {platform === 'win32' && (
                      <div className="database-login-field">
                        <label htmlFor="database-login-root">
                          微信数据目录
                          <StoragePathHelp />
                        </label>
                        <div className="database-login-root-control">
                          <Input
                            id="database-login-root"
                            aria-label="微信数据目录"
                            value={dbRoot}
                            onChange={(event) => onDbRootChange(event.target.value)}
                            placeholder={defaultPath}
                            title={dbRoot || defaultPath}
                            spellCheck={false}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <Button
                            variant="outline"
                            onClick={onSelectDbRoot}
                            disabled={isConnecting}
                          >
                            选择目录
                          </Button>
                        </div>
                      </div>
                    )}
                    {status && (
                      <div className={`database-login-message ${statusKind}`}>{status}</div>
                    )}
                    {platform === 'win32' && (
                      <p className="database-login-platform-note">
                        无法加载数据库组件时，请安装 Microsoft Visual C++ 2015-2022 x64 运行库。{' '}
                        <a href={WINDOWS_VC_RUNTIME_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                          下载运行库
                        </a>
                      </p>
                    )}
                    <Button
                      className="database-login-primary"
                      onClick={onManualConnect}
                      disabled={!keyIsValid || isConnecting}
                    >
                      {isConnecting ? '正在连接…' : '连接数据库'}
                    </Button>
                    {isConnecting && (
                      <Button
                        variant="link"
                        className="database-login-text-action"
                        onClick={onGuideCancel}
                      >
                        取消连接
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="database-login-secondary"
                      onClick={onPasteKey}
                      disabled={isConnecting}
                    >
                      从剪贴板粘贴并安全保存
                    </Button>
                  </div>
                )}
              </Tabs>

              <div className="database-login-footer-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={onClearKey}
                >
                  清除已保存密钥
                </Button>
                <span>语屿 YUYU</span>
              </div>
              <p className="database-login-storage-note">
                清除数据库密钥不会删除微信数据，也不会移除账号识别记录。
                {import.meta.env.DEV && import.meta.env.VITE_DB_KEY
                  ? ' 当前密钥来自开发环境变量 VITE_DB_KEY，清除按钮不会修改 .env。'
                  : ''}
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
