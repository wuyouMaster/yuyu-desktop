# YUYU Desktop — 公开主应用迁移基础

这是全新 Git 历史的本地准备仓库，只包含逐文件审查的应用接口、运行时管理和协议消费者。
**完整 Electron/React 应用仍在迁移，当前不能作为完整桌面产品启动。**
私有数据库、媒体格式、密码学、密钥捕获及网络协议实现位于独立 Go/C runtime。

## 当前能力

- 固定版本匿名下载、摘要验证、安全解包、原子激活及重新验证。
- stdio RPC、同步/异步桥接、取消、账号所有权和关闭失败传播。
- 微信身份/消息消费者；完整 DatabasePort、分页、语音读取和数据库提交观察。
- 账号媒体定位、分块传输和完整摘要校验；ImageMediaPort 的变体选择、诊断和持久缓存。
- 密钥验证/捕获和 iLink 会话消费者；收件处理成功后确认，发送未知结果不自动重试。
- Telegram 账号/缓存消费者；合成测试与公开文件导出检查。

这里的能力需要匹配的**未发布本地候选**。默认公开下载目录仍为 v0.1.0-dev.2，
尚不包含新增 Go host；不能把协议实现当成该版本已经具备的功能。新图片解码器也尚未
装入可下载归档。缓存每次命中核对来源及实际载荷，受限目录内持久化，不包含格式解密。

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

仍需接入产品 provider、密钥授权与自动元数据选择、完整 iLink 编排/媒体/typing，以及
Electron 主进程、preload、Renderer、构建和完整业务回归。完整源码清单及许可证/署名
审查尚未完成；当前不授予新许可。不用空数据、降级实现或跳过测试代替缺失能力。

仓库不包含原私库历史、二进制、私有实现、研究材料、日志或凭据。
[公开目标仓库](https://github.com/wuyouMaster/yuyu-desktop) 已创建但源码尚未推送；
没有启用 Actions 或发布。本地提交不等于公开交付。
