# YUYU Desktop — 公开主应用迁移基础

这是全新 Git 历史的本地准备仓库，只包含逐文件审查的应用接口、运行时管理和协议消费者。
**完整 Electron/React 应用仍在迁移，当前不能作为完整桌面产品启动。**
私有数据库、媒体格式、密码学、密钥捕获及网络协议实现位于独立 Go/C runtime。

## 当前能力

- 固定版本匿名下载、摘要验证、安全解包、原子激活及重新验证。
- stdio RPC、同步/异步桥接、取消、账号所有权和关闭失败传播。
- 微信身份/消息消费者；完整 DatabasePort、分页、语音读取和数据库提交观察。
- 账号媒体定位、分块传输和完整摘要校验；ImageMediaPort 的变体选择、诊断和持久缓存。
- 密钥验证/捕获和 iLink 会话消费者；文本及指定本地媒体发送，未知结果不自动重试。
- 安装后先验完整包，再组合账号数据库/图片端口；关闭和重开共享资源生命周期。
- Telegram 账号/缓存消费者；合成测试与公开文件导出检查。

这里的能力需要匹配的**未发布本地候选**。默认公开下载目录仍为 v0.1.0-dev.2，
尚不包含新增 Go host；不能把协议实现当成该版本已经具备的功能。新图片解码器已装入本地 dev.8 候选归档，但还未发布。缓存每次命中核对来源及实际载荷，受限目录内持久化，不包含格式解密。

## 本地检查

Node 22、pnpm 7.33.7。Python 3 仅用于测试生成合成 ZIP，不是产品运行依赖。

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm typecheck
corepack pnpm test
corepack pnpm runtime:list
corepack pnpm runtime:install --application telegram --version 0.1.0-dev.2
corepack pnpm runtime:verify
```

下载文件写入忽略的 `.runtime/`。macOS arm64 候选已完成合成原生进程测试；Windows
x64/ARM64 仅交叉编译，实机测试待安排。没有真实账号登录、注入或发送验收。

## 剩余迁移和发布边界

数据库密钥授权适配、语音编解码和 iLink 账号/登录/轮询/回复上下文/远程媒体/typing
协议编排已具备离线验证；尚需完成产品 provider 与完整 Electron 主进程、preload、Renderer
集成、独立启动和业务回归。完整源码清单及许可证/署名
审查尚未完成；当前不授予新许可。不用空数据、降级实现或跳过测试代替缺失能力。

仓库不包含原私库历史、二进制、私有实现、研究材料、日志或凭据。
[公开目标仓库](https://github.com/wuyouMaster/yuyu-desktop) 已创建但源码尚未推送；
没有启用 Actions 或发布。本地提交不等于公开交付。


独立候选验收可在本仓库构建 worker（不读取私有仓库源码）：

```sh
corepack pnpm build:runtime-worker
# 显式提供本地候选 ZIP、扩展合成数据库目录及合成 HEVC 文件的绝对路径：
# YUYU_TEST_WECHAT_ARCHIVE / YUYU_TEST_DATABASE_DETAILS_ROOT / YUYU_TEST_HEVC_FIXTURE
corepack pnpm test:runtime:protocol
```

输入缺失会失败，不会跳过；候选包、合成媒体及编译输出都不进入本仓库。测试通过匿名
回环 HTTP 安装包，再读取合成数据库、解码、关闭重开和验证缓存，另验证产物改写拒绝。
这是应用协议组合验收，完整 Electron 界面和真实账号验收尚未完成。


图片密钥自动检查另有未打包的 dev.9 候选：只处理所选账号和支持的元数据目录，
仅在完整样本校验且 runtime 正常关闭后报告成功。该适配器只声明 autoGetImageKey；
不代表数据库进程捕获、提权或 Intel 安装已经完成，也不属于 dev.8 安装包能力。


新增安装包同步校验与受控 host 工厂：仅运行应用固定目录内且完整校验成功的 host，
清理继承环境，并保留授权操作所需的关闭宽限。`WechatCDNClient` 使用 512 KiB 分块
传输 64 MiB 以内消息媒体，核对输入/输出 SHA-256，不在应用内实现解密。
真实候选 host 的合成 9 MiB CDN 测试需显式提供 `YUYU_TEST_WECHAT_HOST`，先构建 worker，
再运行 `pnpm test:runtime:protocol tests/runtime-protocol/wechat-cdn.test.ts`。
输入缺失或密文损坏均失败；不代表真实账号、Windows 实机或公共发布验收。
