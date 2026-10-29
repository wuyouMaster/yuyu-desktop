# YUYU Desktop — 公开主应用迁移基础

这是全新 Git 历史的本地准备仓库，当前只导入经过审查的运行时管理和公共协议基础。
**完整 Electron/React 应用尚未迁入，暂不能作为完整桌面产品启动。**
剩余私有 TypeScript 实现按应用归属逐步改为 Go/C 原生 runtime；不会为追求空壳启动而
移除现有业务或用空结果替代尚未提供的能力。

当前包含：

- 固定版本 runtime 下载、摘要验证、安全解包、原子激活和重新验证。
- 无需凭据的三个公开 v0.1.0-dev.2 runtime 下载目录。
- 版本化 stdio 客户端、取消/超时/生命周期语义及 Telegram 存储、微信身份/消息能力契约。
- 合成测试和公开源码导出检查；不包含二进制、研究资料、日志、私有实现或原仓库历史。

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm typecheck
corepack pnpm test
corepack pnpm runtime:list
corepack pnpm runtime:install --application telegram --version 0.1.0-dev.2
corepack pnpm runtime:verify
```

Node 22、pnpm 7.33.7。Python 3 仅用于测试生成合成 ZIP，不是产品运行依赖。
下载后的产物写入忽略的 .runtime/。目前公开 v0.1.0-dev.2 产物仅验证 macOS arm64，
不包含本地新写的 Go 存储 host。不要把协议接口存在误认为该版本已具备对应能力。

Telegram 缓存、微信身份和消息解析已有本地 Go 候选与公共消费端；候选尚未公开发布。
后续需完成 WeChat 数据库、媒体、密钥等原生替换，再迁入产品代码、
构建配置和完整回归。公开许可与上游署名需要在完整导入前核对；当前未授予新许可。
已创建空的公开仓库 https://github.com/wuyouMaster/yuyu-desktop 并配置对应 origin。
源码尚未推送，未配置 Actions 或执行发布；本地提交不等于已公开发布。

公共 RPC 桥接器让同步和异步调用共享一个常驻原生进程，保持数据库连接的所有权。
这仅提供传输语义，不代表已发布的 runtime 已具备完整数据库能力。

`WechatDatabaseClient` 新增只读数据库协议消费端与严格 DTO 校验，本地 macOS Go/C
候选已进行合成加密库进程验证。公开目录 dev.2 尚不包含该能力；完整数据库接口、
大结果分页、Windows、真实账号和完整桌面业务仍待迁移验收。

本地候选补充了严格语音查询、数据库提交变更观察，以及 DAT/CDN 媒体字节协议客户端。
监控停止后阻止迟到回调，后端错误上报并停止；这不是逐行日志或撤回保护。
媒体单次请求目前限制 4 MiB，大媒体、路径定位和完整业务尚未接通。
Windows x64/ARM64 后端交叉编译成功，实机测试待安排，未宣称 Windows 功能通过。
