# Cowd Surface

`cowd-surface` 是 Cowd 的独立 surface 仓库，承载除 TUI 之外的所有用户界面和外部渠道 sidecar。当前版本：`0.9.353`。

core 仓库只保留 `surface` 协议、Gateway 装载/调度能力和可选 TUI。WebUI、飞书、邮件、企微、微信 iLink 以及后续更多 surface 都在本仓库按需独立构建、独立安装、独立演进。

## 目录结构

```text
crates/surface             Surface JSONL 协议合同，和 cowd core 保持同步
crates/surface-adapters    平台适配实现与 sidecar 二进制入口
surfaces/webui             Vue/Vite WebUI 静态 surface
surfaces/feishu            飞书 surface manifest
surfaces/email             邮件 surface manifest
surfaces/wecom             企微 surface manifest
surfaces/wechat-ilink      微信 iLink surface manifest
```

## 边界原则

- Gateway 负责发现 surface、转发静态资源、转发 callback、收集 health/events，并通过 JSONL 调度 sidecar。
- Runtime 不依赖本仓库，不链接平台 SDK，不直接持有渠道连接。
- 每个非 TUI surface 都是可按需构建的独立包。
- WebUI 也是 surface，和飞书/邮件/企微/微信 iLink 一样通过 manifest 被 Gateway 识别。
- 渠道文档操作等扩展能力不内置到 surface，后续通过 skill/tool 安装。

## 构建

WebUI：

```bash
npm --prefix surfaces/webui install
npm --prefix surfaces/webui test
npm --prefix surfaces/webui run build
```

sidecar：

```bash
cargo check --workspace --bins
cargo build --release -p surface-adapters --bins
```

构建后会得到：

```text
target/release/cowd-surface-feishu
target/release/cowd-surface-email
target/release/cowd-surface-wecom
target/release/cowd-surface-wechat-ilink
```

## 安装模型

每个 surface 安装单元包含：

```text
surface.json
可执行 sidecar 或静态资源目录
```

Gateway 读取 surface 目录后，根据 manifest 提供：

- `/api/surfaces`
- `/api/surfaces/:id/health`
- `/api/surfaces/:id/events`
- `/s/:surface/*path`
- `/surface-callback/:surface/*path`

这使 WebUI、外部渠道、未来移动端或其他语言实现的 surface 都能使用同一个 Gateway/Surface 协议接入 Cowd。
