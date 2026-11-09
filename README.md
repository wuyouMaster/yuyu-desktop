# YUYU Desktop

Electron / React 应用层、主进程服务和运行时协议消费者。数据库、私有媒体格式、密钥捕获、
语音编解码、iLink 网络协议和旧发送组件兼容处理由独立 Go/C runtime 实现。
此仓库不包含私有源码、二进制、研究文档、日志、用户数据或原私库 Git 历史。

## 数据与模板

YUYU 不自动读取或迁移 TraceMemo / WechatExplorer 的旧密钥和导出，也不会删除原文件。
请重新配置数据源；新导出保存到文档目录下的 `YUYU/导出`。远程模板市场暂不可用，
内置和已安装的本地模板仍可使用。

## macOS

连接微信前，请先安装对应运行时并按应用引导选择数据源。密钥获取及系统授权的可用性
取决于运行时、系统和客户端版本；若应用提示能力不可用，请查看运行时状态并手动配置。
请仅在理解系统安全影响并确认适用环境后调整系统安全设置。

## 本地开发

Node 22、pnpm 7.33.7；先安装锁定依赖和 Playwright Chromium：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm dev
```

应用可在没有 runtime、没有账号时独立启动。初始引导允许直接进入主界面；数据源附近和
设置中均可管理运行时。下载有真实字节进度、取消与重试，校验完成后须重启再配置数据源。
下载在连续两分钟无进度或总耗时超过一小时时终止；持续传输的慢速连接可继续完成。
`build/icon.png` 从受审查 SVG 生成，构建产物、临时测试截图和下载文件均被 Git 忽略。
全新安装默认不启动本地 API，可在 API 页面手动开启；已有设置保持原来的开启状态。
本地 API 未启用时，Token 在打开 API 设置时按需创建；启用服务前仍必须完成安全存储和鉴权。
启动时账号发现只检查是否存在已保存的数据库密钥；需要读取密钥时才访问系统安全存储。

当前 macOS arm64 默认公开目录为微信 `0.1.0-dev.13`、钉钉 `0.1.0-dev.2` 和 Telegram
`0.1.0-dev.5`，三个运行时均为实验性开发预览。桌面 1.0.0 正式发布不改变它们的
`development-only` 状态；能力以实际界面和协议检查为准。旧包安装成功不代表新协议可用。
开发验收可由主进程用 `YUYU_RUNTIME_TEST_CATALOG` 指定绝对路径的固定摘要目录，
打包应用不接受该覆盖；Renderer 不能提供目录、命令或 host 路径。正式地址只能在新产物
发布并核对匿名下载后更新。

## 原生 Telegram for macOS

数据源入口区分 Telegram（macOS 原生版）和 Telegram Desktop。原生版通过运行时
`client.inspect`、`macos.conversations` 和 `macos.messages` 只读浏览本地会话及消息，
主进程固定客户端及数据目录，界面仅提交不透明候选标识。按需分页，可显示已识别的
附件类型、文件名、尺寸及时长等元数据；不支持附件播放、下载、
发送或补载云端历史。未知会话类型和昵称不作推断。切换或断开数据源会关闭自有读取进程。

当前公开目录中的 Telegram dev.5 已包含这些原生接口，并已核对公开附件的匿名下载与摘要。
已安装的 dev.3 不包含这些接口，需要通过运行时管理更新并重启应用。
运行时目前仅验收原生 Telegram 13.2.0 / build 283467 的 macOS arm64 小样本；完整历史、
其他客户端版本和媒体内容仍未验收。原 Telegram Desktop 接口继续独立保留。

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
node --test tests/tooling/public-app-export.test.mjs tests/tooling/macos-signing.test.cjs tests/tooling/release-artifacts.test.mjs
corepack pnpm test:e2e:build
corepack pnpm exec playwright test
corepack pnpm build:unpack
```

macOS 视觉基线位于 `tests/e2e/__screenshots__/darwin/`，使用公开的合成聊天 fixture 和
本仓库生成的图标，不依赖私仓文件。普通测试使用严格全页或对应控件截图断言；缺失或不匹配
会失败。界面有预期变化时，须逐张审阅合成内容和布局，显式更新基线并重新运行普通比较，
不要用更新基线掩盖未查明的回归。Windows 专用手动目录用例在 macOS 的既有平台跳过保持原状，
不代表 Windows 已通过。

真实原生合成测试需明确提供候选与 fixtures，缺失时失败：

```sh
corepack pnpm build:runtime-worker
# YUYU_TEST_WECHAT_ARCHIVE / YUYU_TEST_DATABASE_DETAILS_ROOT / YUYU_TEST_HEVC_FIXTURE
# YUYU_TEST_WECHAT_AUDIO_HOST / YUYU_TEST_WECHAT_HOST / YUYU_TEST_WECHAT_CDN_HOST
# YUYU_TEST_TELEGRAM_ARCHIVE / YUYU_TEST_TELEGRAM_FIXTURE (synthetic JSON)
corepack pnpm test:runtime:protocol
node scripts/smoke-install-flow.mjs <absolute-candidate.zip> <absolute-synthetic-account>
# 对固定清单中的公开 HTTPS 地址做无凭据安装验证
node scripts/smoke-install-flow.mjs <absolute-candidate.zip> <absolute-synthetic-account> --published
# 在本地目录包上验证相同公开安装与重启流程
node scripts/smoke-install-flow.mjs <absolute-candidate.zip> <absolute-synthetic-account> --packaged <absolute-app-executable>
```

`smoke-install-flow` 使用隔离配置、真实安装器及 Electron preload，验证未安装、下载、重启、
合成数据库连接与联系人。默认使用回环 HTTP；`--published` 使用固定清单中的公开 HTTPS 地址，
不配置下载凭据。它不证明真实账号或 Windows 行为。
macOS arm64 已进行本地验证；Windows x64 已完成云端打包和隔离配置启动检查，安装和升级
仍待验证。macOS 打包会修复嵌套代码的
本地 ad-hoc 签名并验证整个应用；这不是 Developer ID 签名或公证发布。
本地验证不会自动推送、发布或触发 Actions。

Telegram `0.1.0-dev.5` 的 storage host 位于 `telegram/telegram-storage-host`，兼容检查和
启动使用同一固定路径；旧 dev.2 不含该 host。Telegram 协议测试从公开 ZIP 安装并读取
明确提供的合成数据，不会访问真实账号。

## 来源与交付

应用沿用原项目的作者标识和第三方依赖署名，见 [NOTICE](NOTICE.md)。当前不新增许可证授权。
推送和发布须单独确认源仓库、分支、全部提交、目标 remote 的实际 URL 与目标分支。
[公开目标仓库](https://github.com/wuyouMaster/yuyu-desktop) 与私有 runtime 仓库分离。

## 应用更新渠道

主应用的发布说明和安装包使用 `wuyouMaster/yuyu-desktop` 的 Releases；三个 runtime
仍各自从 `runtime.lock.json` 指定的地址下载。手动下载入口指向 Releases 列表，便于查看预发布。
更新检查只选择公开的 Release，忽略尚未发布的草稿和只有标签的版本。稳定版本只选择稳定
Release；预览版本可选择同一预览渠道或较新的稳定版本，alpha 也可选择 beta。Windows 更新使用完整安装包并
保留更新元数据的摘要检查；公开版本列表不可访问时显示错误，不会回退到未核实的标签。
默认目录构建不配置更新源，检查更新会显示尚未配置。`electron-builder.release.yml` 是仅供
公开应用使用的发布配置，指向该公开仓库并先生成草稿；未经明确授权不得上传或发布。
在干净、已提交的 macOS arm64 或 Windows x64 工作区，可运行
`corepack pnpm build:release:candidate` 生成 `dist/release-candidate/`，不会上传；已有目录需先
移走或改名。构建会检查包内容，验证更新元数据中的文件大小和 SHA-512，并生成包含源码提交、
runtime 锁文件摘要及各产物 SHA-256 的清单。

macOS arm64 打包前运行 `python3 scripts/prepare-public-ffmpeg.py build --download`，从官方来源
获取并验证固定摘要的 FFmpeg 9.0.2 与 Opus 1.5.2 源码，在本机构建不含 GPL/nonfree 组件的
FFmpeg。也可提前将这两份源归档放入 `.tmp/public-ffmpeg-sources/` 后不加 `--download` 离线
构建。打包会验证源码、构建记录、许可证文本和二进制配置，替换 `ffmpeg-static` 自带的 macOS
可执行文件，并在安装包内保留源码、许可和构建脚本。对已准备的二进制运行
`FFMPEG_BIN="$PWD/.tmp/public-ffmpeg/ffmpeg" corepack pnpm test:ffmpeg` 验证合成音频转换。
Windows 的 FFmpeg 和第三方许可仍需单独核对；本项目依赖的其他包也各有许可要求。
聊天中的 `[微笑]` 等文本表情按消息原文显示，不再附带微信内置表情图片；独立表情包消息
仍按现有媒体能力处理。

推送与 `package.json` 版本完全一致的标签（例如 `v0.0.0-migration.6`）后，
[发布工作流](.github/workflows/release-draft.yml) 在 macOS arm64 和 Windows x64 分别构建和
执行检查；两边通过后才创建预发布 Release 草稿，并下载核对全部文件。草稿包含 macOS DMG、
ZIP、Windows NSIS 安装程序、更新元数据、blockmap 和平台清单，不会自动公开发布。标签必须
指向包含此工作流的提交，且不可复用已有 Release。推送标签会触发 Actions，须事先按贡献规范
取得本次推送授权。该工作流只接受带预发布标识的版本；稳定版本标签会使检查失败，
必须另行准备并验收正式发布流程。正式 macOS 自动更新仍需
签名、公证、ZIP 和实际升级验证；Windows 需要 NSIS 安装包及目标平台更新验证。预发布与稳定
渠道的版本策略、发布及真实升级结果须另行核验，不能把模拟事件或目录构建当成上线成功。

桌面正式版目标为 1.0.0、macOS arm64，三个独立运行时继续提供实验性开发预览。
本次采用无 Developer ID 签名、公证的发行方式，范围和限制见
[1.0.0 发布说明](docs/releases/1.0.0.md)。运行
`corepack pnpm release:stable:preflight` 可检查本机平台、版本、干净工作区、Developer ID
Application 身份、公证钥匙串配置名称以及运行时目录中的稳定版本状态；它不会构建、上传或
发布，也不会输出凭据。检查通过不代表凭据有效、签名或公证成功，更不代表真实账号、安装或
更新验收通过。预检条件满足后，可在本机运行 `corepack pnpm build:stable:candidate`，
使用独立配置签名和公证，生成不上传的 macOS 候选；该入口仍需在真实证书和凭据配置后完成
首次端到端验证，当前不能视为已验收。现有预览工作流不能用于稳定版。

如果明确选择不使用 Developer ID 签名及公证，可运行
`corepack pnpm release:stable:preflight --unsigned` 和
`corepack pnpm build:stable:candidate --unsigned`。这只跳过签名身份和公证要求，仍要求
macOS arm64、1.0.0、干净提交及三个稳定运行时；候选只保留本地 ad-hoc 完整性检查，
不会上传。未签名且未公证的应用可能被 macOS Gatekeeper 阻止，必须在交付时明确说明，
实际安装、更新、运行时及第三方许可仍需单独验收。
`v1.0.0` 标签有单独的 macOS arm64 无签名草稿工作流；预览工作流会跳过稳定标签。该流程
只上传未公开的草稿并回读核验附件，不会自动公开；标签推送会触发 Actions，仍需取得本次
推送授权。默认预检仍要求稳定运行时；按本次发行范围，工作流显式附加
`--allow-experimental-runtimes`，允许版本号带预发布后缀、状态为 `development-only`
的固定目录项，仍拒绝缺失、重复、平台错误或状态与版本不一致的运行时。目录状态不改写，
发布说明和管理界面保留实验性提示。本机对应命令为：

```sh
corepack pnpm release:stable:preflight --unsigned --allow-experimental-runtimes
corepack pnpm build:stable:candidate --unsigned --allow-experimental-runtimes
```

本次正式版不提供 Windows 安装包或 `latest.yml`；既有 Windows 预览的更新检查可能因而失败，
Windows 用户仍可从此前的预览 Release 页面下载原有安装包。macOS 继续通过 Release 页面
下载更新，不启用未验收的应用内自动安装。

可用 `corepack pnpm audit:packaged-licenses <app.asar 路径>` 离线列出归档内各 npm 包目录
缺少非空许可证或 NOTICE 文件的情况；发现缺项或无法读取元数据时命令返回非零。该检查仅
提供部分审核线索：目录之外的统一署名、打包进 JS 的依赖、原生二进制及其传递依赖、许可证
内容与具体分发义务仍须逐项核对；通过不代表许可审核完成。
