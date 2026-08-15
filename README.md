# Cowd Edge

Cowd Edge 是 Cowd 的浏览器控制面、消息渠道与外部数据接入层。它把前端技术栈、平台 SDK、长连接、邮件协议和数据库驱动隔离在 Core Runtime 之外，让人、平台与数据通过明确合同进入同一条受治理执行链。

Edge 不是第二套 AI Runtime：Gateway 是唯一 EdgeHost，Core 仍然拥有 Session、Task、Mission、模型循环、Memory、Matrix、权限、审计与恢复。Edge 负责协议适配、可靠传输和浏览器呈现，不推导任务或事实终态。

```text
People / Platforms / Data
          │
          ▼
┌────────────────────────────────────────────────────────────────┐
│ Cowd Edge                                                      │
│                                                                │
│  WebUI Surface       Message Connectors      Source Connectors │
│  Mission / Graph     Feishu / Email          SQL / Bitable     │
│  Agent / Evidence    WeCom / WeChat iLink    Snapshot / Delta  │
│                                                                │
│  edge-contract ── edge-adapters ── managed sidecars            │
└───────────────────────────┬────────────────────────────────────┘
                            │ surface.json + authenticated UDS/H2
                            ▼
                   Cowd Gateway / SurfaceHost
                            │
                            ▼
             Runtime / Mission / Memory / Matrix / APP
```

三条边界贯穿所有实现：

- 消息 Connector 不创建 Session、不选择模型、不执行 AI Turn。
- 数据源 Connector 不直接写入 Memory 或 Matrix，只输出合同约束的数据批次、水位线和收据。
- WebUI 不推导任务终态，只呈现 Gateway 的授权投影与短暂传输状态。

## 核心模块

工作区只有 `edge-contract` 与 `edge-adapters` 两个 Rust crate；WebUI 是独立静态 Surface。

| 模块 | 位置 | 核心职责 |
|---|---|---|
| **WebUI Surface** | `surfaces/webui` | 对话、Mission、执行图、Agent、Reality、工具、技能、Surface、审计、设置与签名 APP 控制台 |
| **Edge Contract** | `crates/edge-contract` | Manifest、生命周期、健康、消息动作、Source batch/watermark、事件与 ACK 的 wire 合同 |
| **Managed Server** | `edge-adapters::managed_server` | UDS/H2 服务、握手、配置、健康、事件多路复用、背压、取消与优雅退出 |
| **Message Sidecar** | `edge-adapters::message_sidecar` | 消息能力、收发、动作、事件流、账户控制与平台 Adapter 装配 |
| **Source Sidecar** | `edge-adapters::source_sidecar` | Schema、Snapshot、Incremental、事件批次、水位线与读取计划 |
| **Platform Adapters** | `edge-adapters::platform` | 飞书、邮件、企微、微信 iLink 的协议、鉴权、媒体、回调与长连接 |
| **Source DB** | `edge-adapters::source_db` | PostgreSQL、MySQL、MariaDB 的只读 Schema、分页快照与增量读取 |
| **Driver Profiles** | `contracts/driver-profiles.json` | 逻辑 Connector 到 artifact、Manifest、能力与配置合同的唯一映射 |
| **Message Mirror** | `edge-adapters::mirror` | 受规则约束的消息镜像、方向控制、去重与回环防护 |

```text
surface.json
    │
    ├── stable identity / kind / capability
    ├── artifact / driver profile / transport
    ├── config schema / route / resource
    └── health / repair / default-enabled
    │
    ▼
Driver Profile ──► Managed Server ──► Domain Handler
                                           │
                         ┌─────────────────┴─────────────────┐
                         ▼                                   ▼
                 Message Sidecar                       Source Sidecar
                         │                                   │
                 Platform Adapter                   SQL / Bitable Adapter
```

## 接入拓扑与发布模型

仓库定义九个逻辑 Connector、六个可发布 Sidecar artifact 和十份 `surface.json`（九个 Connector 加 WebUI）。每个逻辑 Connector 有独立 ID、Manifest、配置、健康与修复状态；相近协议共享 artifact，但不共享逻辑身份或故障状态。

```text
9 个逻辑 Connector / 6 个 artifact
├── feishu-message       ─┐
│                         └─ cowd-edge-open-platform-message
├── email-message        ─── cowd-edge-email-message
├── wecom-message        ─── cowd-edge-wecom-message
├── wechat-ilink-message ─── cowd-edge-wechat-ilink-message
├── feishu-bitable       ─┐
│                         ├─ cowd-edge-bitable-source
├── lark-bitable         ─┘
├── postgres             ─┐
├── mysql                 ├─ cowd-edge-sql-source
└── mariadb              ─┘
```

平台或数据库差异由 Driver Profile 注入，生命周期、健康、Wire Protocol 与 Sidecar 宿主保持一致。一个 artifact 的实现复用不会把多个逻辑 Connector 合并成同一实例。

## WebUI Surface

`surfaces/webui` 是 Vue 3、Vite 与 TypeScript 构建的浏览器控制面，由 Gateway 作为同源静态 Surface 挂载。它围绕真实工作对象组织界面：

- **Chat**：流式回答、推理分组、工具活动树、证据、审批与会话分支。
- **Mission Control**：Mission、Task、Schedule、Team、Agent、审批、恢复与 Execution Graph。
- **Agent Workbench**：Agent 目录、能力画像、Team Template、运行证据与 review gate。
- **Runtime / Reality**：执行真相、策略决策、用量、Memory、Matrix、Fact Flow 与证据链。
- **Surface / Gateway**：Edge 拓扑、生命周期、健康、消息账本、投递回执与修复入口。
- **APP Surface**：Gateway 从已验签 Bundle 的 presentation/web root 投影 sanitized 同源页面；静态列表与资产不激活 Worker，用户首次业务请求才按策略激活。

```text
Gateway Capability Contract
            │
            ▼
Generated API + Projection Registry
            │
   ┌────────┼───────────┐
   ▼        ▼           ▼
HTTP Read  SSE Live   Action Receipt
   │        │           │
   └────────┼───────────┘
            ▼
 Mission Graph / Activity Tree / Evidence / APP Surface
```

iframe APP 使用 opaque sandbox、精确父窗口与 origin、nonce/replay 校验、受限凭据头、显式 credit/backpressure、cancel/dispose 和授权失效传播。WebUI 不装配 APP 源码，也不把业务页面编译进自身；Bundle 变更由 Gateway 重新启动后发现和准入。

API matrix、能力一致性、i18n、原始载荷、治理语义、浏览器 E2E 与发布验收均有门禁。Gateway 不可用或能力缺失时，界面显示明确的 unavailable/degraded 状态，不使用静态数据伪装在线能力。

## Message Connectors

| Connector | 接入方式 | 主要能力 | 发布 artifact |
|---|---|---|---|
| **飞书** | Open Platform 长连接 / 回调 | 文本、图片、语音、文档、视频、卡片、编辑、删除、Chat 信息、回调与处理状态 | `cowd-edge-open-platform-message` |
| **Email** | SMTP / IMAP | 文本与文档发送、邮件接收、独立收发模式与健康状态 | `cowd-edge-email-message` |
| **企微** | Callback + API | 消息收发、回调验签、加解密与健康状态 | `cowd-edge-wecom-message` |
| **微信 iLink** | QR 登录 + 长轮询 | 文本、图片、Chat 信息、账户管理、长轮询与健康状态 | `cowd-edge-wechat-ilink-message` |

```text
Platform Event
     │ 验签 / 解密 / 去重 / 规范化 / 媒体缓存
     ▼
Message Sidecar Event
     │ sequence + correlation + ACK
     ▼
Gateway SurfaceHost
     │ inbox → Session/Task → AI Turn → outbox
     ▼
Message Action → Platform Receipt
```

`MessageConnectorContract` 描述 endpoint、resource mode、最大消息长度、Markdown 方言、线程与附件能力。平台差异停留在 Adapter 内，不泄漏为 Core 任务分支。Connector descriptor 的存在不等于所有外部账号、凭据与平台组合已经完成生产认证。

## Source Connectors

| Connector | 读取对象 | 发布 artifact |
|---|---|---|
| **PostgreSQL / MySQL / MariaDB** | Schema、表、分页 Snapshot、基于水位线的增量 | `cowd-edge-sql-source` |
| **飞书多维表格 / Lark Base** | Base、Table、字段 Schema、记录 Snapshot/Incremental | `cowd-edge-bitable-source` |

```text
Gateway SourceReadPlan
          │ resource / table / fields / limit / cursor
          ▼
Source Sidecar ──► SQL or Bitable Adapter
          │
          ▼
SourceRecordBatch
  schema + rows + cursor + checksum + row_count
          │
          ▼
Gateway Validation ──► Matrix Transaction ──► Receipt
          │                                      │
          └──── final chunk success ─────────────┘
                         │
                         ▼
                  Watermark Commit
```

Source Connector 只执行受计划约束的读取。只读权限、分页上限、预期 revision 与 watermark compare-and-set 防止适配器成为无治理的数据写入旁路；SourcePack 映射、事务提交、receipt 和 watermark 推进由 Core 数据面负责。

## Managed transport、lifecycle 与 security

`edge-contract` 定义所有 Edge 单元共享的管理平面，以及 Message 与 Source 各自独立的业务合同。共享生命周期不意味着把二者压缩成万能 JSON Action。

```text
发现             准备               启动                握手/配置
surface.json ──► UDS 0600 ────────► artifact ────────► authenticated H2
                   + credential       + profile
                                                            │
                                                            ▼
                      Ready：持久 H2 多路复用
                      control · message · source · events
                      sequence · ACK · correlation
                      cancellation · backpressure
                                  │
                   ┌──────────────┼──────────────┐
                   ▼              ▼              ▼
              health probe   backoff/repair   drain/stop
```

- Managed Sidecar 使用权限为 `0600` 的 Unix Domain Socket、短期 credential 与认证 H2。
- 每个事件带 sequence、correlation 和 ACK；重连从已确认位置继续。
- 平台事件、Card Action、消息镜像与 Source watermark 使用稳定去重键。
- 持久连接支持并发上限、deadline、背压、取消与优雅 drain。
- 每个逻辑 Connector 独立健康与 circuit；共享 artifact 不共享故障状态。
- Manifest schema、运行配置与 Driver Profile 必须一致，无效配置不替换健康实例。

运行状态包含 discovered、starting、ready、degraded、restarting、unavailable、disabled、failed 与 circuit-open。配置通过显式校验和受管生命周期生效；artifact、driver profile、transport 或安装内容变化需要有界重启，不承诺运行时热替换。

## Core、APP 与外部平台

```text
External World
  ├── Browser ───────────────► Edge WebUI
  ├── Message Platforms ─────► Edge Message Connectors
  └── Databases / Tables ────► Edge Source Connectors
                                      │
                                      ▼
                              Gateway / SurfaceHost
                                      │
                  ┌───────────────────┼───────────────────┐
                  ▼                   ▼                   ▼
              Core Runtime       Reality Core       AppPlatform
              Turn/Graph         Memory/Matrix      signed Worker
```

| 关系 | 所有权 |
|---|---|
| Edge → Gateway | 发现、握手、配置、健康、事件、消息动作与数据批次通过显式合同交换。 |
| Gateway → Runtime | Gateway 将受理后的用户意图交给 Runtime；Edge 不直接调用模型循环。 |
| Gateway → Matrix | Source batch 经校验和事务提交进入 Matrix；Edge 不持有事实终态。 |
| APP → Edge WebUI | Gateway 从签名 Bundle 提供 sanitized 同源 Surface；APP 私库与业务状态仍由受管 Worker 持有。 |
| Core → Edge Contract | Core 消费冻结合同，并用版本门禁校验 schema、Manifest 与 Driver Profile。 |

APP、Edge 与 Core 不共享数据库句柄或业务表。APP 通过产品中立 transport 与 signed typed CoreBridge 请求 Core 能力；Edge 通过 Message/Source 合同接入外部世界。

## 构建与部署

```bash
# WebUI 开发
npm ci --prefix surfaces/webui
npm run dev:webui

# WebUI、Connector 合同与 Rust 检查
npm run check

# WebUI + 六个 Sidecar artifact
npm run build

# 仅构建 Sidecar
npm run build:sidecars
```

Gateway 通过 `gateway.webui_dir` 挂载 `surfaces/webui/dist`。Connector 的 `surface.json` 随安装内容进入 Edge 搜索目录，由 Gateway 发现；配置满足 schema 后进入 ready，缺少凭据或外部服务不可达时进入带原因的 degraded 或 failed。SQL artifact 需要构建 `source-db` feature。

## 系统说明书

打开 [中文默认的 HTML 说明书](docs/manual/index.html)，页面右上角可切换英文：

| 分册 | 内容 |
|---|---|
| [Edge 总览](docs/manual/index.html) | 仓库定位、发布清单与关键边界 |
| [架构与生命周期](docs/manual/architecture.html) | Manifest、Managed Edge、状态与修复 |
| [消息 Connector](docs/manual/message-connectors.html) | Session 绑定、可靠消息、媒体与失败恢复 |
| [数据源 Connector](docs/manual/source-connectors.html) | Snapshot、Incremental、Watermark 与 Matrix 消费 |
| [WebUI Surface](docs/manual/webui.html) | 控制台、签名 APP Surface、对话呈现与性能规则 |
| [构建、配置与排障](docs/manual/operations.html) | 构建矩阵、安装布局、配置生效与排障路径 |
