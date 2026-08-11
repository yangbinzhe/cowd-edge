# Cowd Edge

> 当前版本：`0.9.672` · 外部连接与浏览器 Surface 仓库

Cowd Edge 把用户界面、消息平台和外部数据源接入 Cowd Gateway，同时将平台 SDK、长连接协议、邮件协议和数据库驱动隔离在 Core 之外。Gateway 是唯一 EdgeHost；Runtime 不依赖本仓库。

## 架构定位

```text
People / Platforms / Data
          │
          ▼
┌────────────────────────────────────────────────────┐
│ Cowd Edge                                          │
│  Web Surface   Message Connectors   Source Connectors│
│  WebUI         Feishu / Email       SQL / Bitable  │
│                WeCom / WeChat                      │
└───────────────────────┬────────────────────────────┘
                        │ manifest + private UDS/H2
                        ▼
               Cowd Gateway / SurfaceHost
                        │
                        ▼
                 Runtime / Reality Core
```

- `surfaces/webui`：Gateway 挂载的 Vue/Vite 静态控制面；TUI 仍属于 Core。
- `connectors/message`：飞书、邮件、企微和微信 iLink 的消息收发与媒体适配。
- `connectors/source`：PostgreSQL、MySQL、MariaDB、飞书多维表和 Lark Base 的只读快照与增量读取。
- `crates/edge-contract`：发现、生命周期、消息和数据源 wire 合同。
- `crates/edge-adapters`：受 Gateway 托管的 sidecar 与平台适配实现。

消息连接器不创建 Session、不执行模型循环；数据源连接器不直接写 Memory 或 Matrix。身份绑定、可靠账本、Runtime 调度、SourcePack 映射和事实提交都由 Core 负责。

## 快速使用

```bash
# WebUI 开发
npm --prefix surfaces/webui install
npm run dev:webui

# 全量合同检查与构建
npm run check
npm run build

# 版本、manifest 与 Core 合同门禁
node scripts/edge-version-gate.mjs --version 0.9.672 --core ../cowd
```

九个逻辑连接器复用六个发布 artifact；每个逻辑连接器仍有独立 ID、配置、健康和修复状态。安装后由 Gateway 自动发现，配置通过校验后热应用或有界重启。

## 系统说明书

打开 [中文默认的 HTML 说明书](docs/manual/index.html)，可在页面右上角切换英文：

| 分册 | 内容 |
|---|---|
| [Edge 总览](docs/manual/index.html) | 仓库定位、发布清单和关键边界 |
| [架构与生命周期](docs/manual/architecture.html) | manifest、Managed Edge v2、状态和自动修复 |
| [消息连接器](docs/manual/message-connectors.html) | Session 绑定、可靠消息、媒体与失败恢复 |
| [数据源连接器](docs/manual/source-connectors.html) | 快照、增量、水位线和 Matrix 消费 |
| [WebUI Surface](docs/manual/webui.html) | 控制台信息架构、对话呈现和性能规则 |
| [构建、配置与排障](docs/manual/operations.html) | 构建矩阵、安装布局、热加载和排障路径 |

发布验收以源码、manifest、Gateway 能力合同和测试门禁为准；README 不声明静态 manifest 当前在线。
