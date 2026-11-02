# YUYU Desktop

Electron / React 应用层、主进程服务和运行时协议消费者。数据库、私有媒体格式、密钥捕获、
语音编解码、iLink 网络协议和旧发送组件兼容处理由独立 Go/C runtime 实现。
此仓库不包含私有源码、二进制、研究文档、日志、用户数据或原私库 Git 历史。

## 本地开发

Node 22、pnpm 7.33.7；先安装锁定依赖和 Playwright Chromium：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm dev
```

应用可在没有 runtime、没有账号时独立启动。初始引导允许直接进入主界面；数据源附近和
设置中均可管理运行时。下载有真实字节进度、取消与重试，校验完成后须重启再配置数据源。
`build/icon.png` 从受审查 SVG 生成，构建产物、测试截图和下载文件均被 Git 忽略。

**当前默认公开目录仍是 `0.1.0-dev.2`，不包含新增 Go host。** 新数据库、密钥、语音和
完整 iLink 需要另行批准发布的匹配候选，不能把旧版本安装成功当作新增能力已可用。
开发验收可由主进程用 `YUYU_RUNTIME_TEST_CATALOG` 指定绝对路径的固定摘要目录，
打包应用不接受该覆盖；Renderer 不能提供目录、命令或 host 路径。正式地址只能在新产物
发布并核对匿名下载后更新。新包未发布前，本版本是本地迁移候选。

## 接口边界

- 安装器校验归档与 manifest 摘要、应用、平台、文件清单和每个文件；不继承 GitHub 凭据。
- 主进程创建受控 stdio worker，支持同步/异步 RPC、取消、超时、关闭和错误传播。
- 数据库接口包含分页、身份/联系人、消息、语音内容、媒体索引及提交观察。
- 媒体定位与解密在 runtime；应用只处理 DTO、内容摘要、分块传输和展示缓存。
- 数据库密钥获取需显式授权，先验证所选数据库再保存。没有后台自动提权或捕获。
- iLink 包含账号/登录、持续轮询、接收确认、会话回复上下文、媒体和输入状态租约；
  结果不明确的发送不会自动重试。旧发送组件仍属独立显式启动能力。
- 系统 OCR、语音识别和 Electron 等第三方依赖由包管理器安装，不把它们的二进制提交进 Git。

## 验证与打包

```sh
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:component
corepack pnpm test:skill-install
node --test tests/tooling/public-app-export.test.mjs
corepack pnpm test:e2e:build
corepack pnpm exec playwright test
corepack pnpm build:unpack
```

视觉基线为原私仓已审核的外部输入，不随公开源码分发；设置 `YUYU_VISUAL_BASELINE_ROOT`
到包含平台子目录的基线根目录，`YUYU_TEST_ICON` 指向原合成截图输入图标。缺失基线会失败，
不会自动创建或更新。当前原基线还反映早于多数据源/运行时入口改造的界面；差异必须单独
核对，不能以更新基线或放宽断言处理。Windows 专用手动目录用例在 macOS 的既有平台跳过
保持原状，不用它证明 Windows 已通过。

真实原生合成测试需明确提供候选与 fixtures，缺失时失败：

```sh
corepack pnpm build:runtime-worker
# YUYU_TEST_WECHAT_ARCHIVE / YUYU_TEST_DATABASE_DETAILS_ROOT / YUYU_TEST_HEVC_FIXTURE
# YUYU_TEST_WECHAT_AUDIO_HOST / YUYU_TEST_WECHAT_HOST / YUYU_TEST_WECHAT_CDN_HOST
corepack pnpm test:runtime:protocol
node scripts/smoke-install-flow.mjs <absolute-candidate.zip> <absolute-synthetic-account>
```

`smoke-install-flow` 使用隔离配置、回环 HTTP、真实安装器及 Electron preload，验证未安装、
匿名下载、重启、合成数据库连接与联系人。它不证明公网发布、真实账号或 Windows 行为。
macOS arm64 已进行本地验证；Windows 仅交叉编译，实测待安排。目录打包不是签名/公证发布。
没有自动推送、发布或 Actions。

## 来源与交付

应用沿用原项目的作者标识和第三方依赖署名，见 [NOTICE](NOTICE.md)。当前不新增许可证授权。
推送和发布须单独确认源仓库、分支、全部提交、目标 remote 的实际 URL 与目标分支。
[公开目标仓库](https://github.com/wuyouMaster/yuyu-desktop) 与私有 runtime 仓库分离。
