import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent
} from './ui'

export function UsageGuideButton(): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z" />
          </svg>
          使用说明
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>YUYU 使用说明</DialogTitle>
          <DialogDescription>
            从选择数据源到开始使用，按需要完成配置即可。本说明可离线阅读。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="start" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full shrink-0 grid-cols-3" aria-label="使用说明章节">
            <TabsTrigger value="start">快速开始</TabsTrigger>
            <TabsTrigger value="sources">连接数据源</TabsTrigger>
            <TabsTrigger value="questions">常见问题</TabsTrigger>
          </TabsList>
          <div className="min-h-0 overflow-y-auto px-1 pb-1 text-sm leading-6">
            <TabsContent value="start" className="space-y-4">
              <div className="rounded-lg border border-border bg-muted p-4">
                <h3 className="font-semibold">可以先进入主界面</h3>
                <p className="mt-1 text-muted-foreground">
                  点击“暂不连接，进入主界面”，先浏览应用或完成设置。未连接时，“从一个数据源开始”页会保留配置入口。
                </p>
              </div>
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  <strong>选择一个数据源。</strong>从微信、钉钉或 Telegram
                  开始；以后可以继续添加和切换。
                </li>
                <li>
                  <strong>按需安装运行时。</strong>
                  运行时是读取或操作对应应用所需的工具。在“管理应用运行时”中选择应用和版本，安装完成后按提示重启启用。Telegram
                  JSON 导入无需运行时。
                </li>
                <li>
                  <strong>连接并检查数据。</strong>
                  回到所选数据源完成配置。连接后选择一个会话，确认消息能正常显示，再按工作区提供的能力浏览或搜索。
                </li>
              </ol>
              <p className="text-muted-foreground">
                进入主界面后，顶部数据源选择器可添加或切换数据源；旁边的“管理应用运行时”可继续安装工具。也可从“设置
                → 高级 → 应用运行时”进入。
              </p>
            </TabsContent>
            <TabsContent value="sources" className="space-y-4">
              <section
                className="space-y-1 rounded-lg border border-border p-4"
                aria-label="微信使用说明"
              >
                <h3 className="font-semibold">微信</h3>
                <p>
                  点击“配置微信”，按“检查环境 → 准备并获取密钥 →
                  验证连接”操作，确认数据目录和账号。系统授权及何时登录微信，以连接页面的当前提示为准。
                </p>
                <p className="text-muted-foreground">
                  已有当前账号数据库密钥时，可使用“高级用户”手动连接。运行时安装完成不代表已取得密钥或连接成功。
                </p>
              </section>
              <section
                className="space-y-1 rounded-lg border border-border p-4"
                aria-label="钉钉使用说明"
              >
                <h3 className="font-semibold">钉钉</h3>
                <p>
                  准备对应运行时并登录本机钉钉，点击“配置钉钉 →
                  检测本机钉钉”。读取验证通过后，选择“连接钉钉只读数据”。无需填写微信密钥。
                </p>
                <p className="text-muted-foreground">
                  当前以浏览、分析为主，不支持发送；组织身份和媒体解析仍在完善。
                </p>
              </section>
              <section
                className="space-y-1 rounded-lg border border-border p-4"
                aria-label="Telegram 使用说明"
              >
                <h3 className="font-semibold">Telegram</h3>
                <p>
                  在“配置 Telegram”中选择连接本机客户端，按界面提示准备运行时和权限；也可选择
                  Telegram Desktop 导出的 JSON 文件直接导入。
                </p>
                <p className="text-muted-foreground">
                  JSON
                  导入不要求运行时，也不会登录账号。不同连接方式提供的能力，以当前工作区提示为准。
                </p>
              </section>
            </TabsContent>
            <TabsContent value="questions" className="space-y-4">
              <section className="space-y-1">
                <h3 className="font-semibold">下载好了，为什么还没有聊天记录？</h3>
                <p>
                  安装只准备工具。显示“重启后启用”时先重启，再到数据源卡片继续连接，或从顶部数据源选择器添加数据源；下载不会自动登录或发送消息。
                </p>
              </section>
              <section className="space-y-1">
                <h3 className="font-semibold">下载失败或没有可用运行时怎么办？</h3>
                <p>
                  查看安装状态和错误提示，检查网络或下载链接后重试。自定义链接需对应当前所选版本的安装包。若提示当前平台不支持，请等待对应平台产物；Telegram
                  JSON 导入仍可独立使用。
                </p>
              </section>
              <section className="space-y-1">
                <h3 className="font-semibold">为什么不同数据源的功能不一样？</h3>
                <p>
                  每种数据源的读取、搜索和发送能力不同，以工作区显示为准。切换来源时，请先完成当前正在执行的任务。
                </p>
              </section>
              <section className="space-y-1">
                <h3 className="font-semibold">必须配置 AI 吗？</h3>
                <p>
                  不必。浏览记录不要求 AI；需要 AI 问答等能力时，再到“设置 → AI
                  模型”配置服务。使用远程 AI 功能时，完成任务所需的内容可能发送给所选服务。
                </p>
              </section>
            </TabsContent>
          </div>
        </Tabs>
        <DialogFooter className="shrink-0 border-t border-border pt-4">
          <DialogClose asChild>
            <Button>我知道了</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
