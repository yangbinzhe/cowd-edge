# Cowd Edge

> Cowd 的浏览器控制面、消息渠道与外部数据接入层

当前版本：`0.9.692`

Cowd Edge 把人、平台与数据接入 Cowd Gateway，同时把前端技术栈、平台 SDK、长连接、邮件协议和数据库驱动隔离在 Core Runtime 之外。它不是另一套 AI Runtime：Gateway 是唯一 EdgeHost，Core 仍然拥有 Session、Task、Mission、模型循环、Memory、Matrix、权限、审计与恢复。

当前仓库包含一个 WebUI Surface、九个逻辑 Connector 和六个可发布 Sidecar artifact。每个逻辑 Connector 都有独立 ID、Manifest、配置、健康、状态与修复策略；同类 Connector 复用发布 artifact，避免复制运行实现。

## 1. 架构定位

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
            Runtime / Mission / Memory / Matrix / App Host
```

Edge 遵循三条不可跨越的边界：

- 消息 Connector 不创建 Session、不选择模型、不执行 AI Turn。
- 数据源 Connector 不直接写入 Memory 或 Matrix，只输出受合同约束的数据批次、水位线和收据。
- WebUI 不推导任务终态，只呈现 Gateway 提供的授权投影与短暂传输态。

## 2. 核心模块

| 模块 | 位置 | 核心职责 |
|---|---|---|
| **WebUI Surface** | `surfaces/webui` | 对话、Mission、执行图、Agent、Reality、工具、技能、Surface、审计与设置控制台 |
| **Edge Contract** | `crates/edge-contract` | Manifest、生命周期、健康、消息动作、Source batch/watermark、事件与 ACK 的 wire 合同 |
| **Managed Server** | `edge-adapters::managed_server` | UDS/H2 服务、握手、配置、健康、事件多路复用、背压、取消和优雅退出 |
| **Message Sidecar** | `edge-adapters::message_sidecar` | 消息能力描述、收发、动作、事件流、账户控制与平台 Adapter 装配 |
| **Source Sidecar** | `edge-adapters::source_sidecar` | Schema、Snapshot、Incremental、事件批次、水位线和读取计划 |
| **Platform Adapters** | `edge-adapters::platform` | 飞书、邮件、企微、微信 iLink 的协议、鉴权、媒体、回调和长连接实现 |
| **Source DB** | `edge-adapters::source_db` | PostgreSQL、MySQL、MariaDB 的只读 Schema、分页快照和增量读取 |
| **Driver Profiles** | `contracts/driver-profiles.json` | 逻辑 Connector 到 artifact、Manifest、能力和配置合同的唯一映射 |
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

## 3. WebUI Surface

`surfaces/webui` 是 Vue 3、Vite 与 TypeScript 构建的浏览器控制面，由 Gateway 作为静态 Surface 挂载。它围绕真实工作对象组织界面，而不是把后端能力复制成互不相关的演示页面。

主要工作面包括：

- **Chat**：流式回答、推理分组、工具活动树、证据抽屉、审批与会话分支。
- **Mission Control**：全局 Mission、Task 归属、Schedule、Team、Agent、审批、恢复和 Execution Graph。
- **Agent Workbench**：Agent 目录、能力画像、受管定义、Team Template、运行证据与 review gate。
- **Runtime**：执行真相、策略决策、节点活动、用量、性能和内核诊断。
- **Reality Core**：Memory、Matrix、Fact Flow、上下文召回、知识治理与证据链。
- **Surface / Gateway**：Edge 拓扑、生命周期、健康、消息账本、投递回执和修复入口。
- **Tools / Skills / Audit / Settings**：能力投影、风险动作、审计检索和运行配置。
- **App Surface**：按 AppRegistry 装配垂直业务界面，MFG 是首个参考实现。

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
 Mission Graph / Activity Tree / Evidence / Workbench
```

WebUI 的 API matrix、能力一致性、i18n、原始载荷、治理语义、浏览器 E2E 和发布验收均由脚本门禁覆盖。Gateway 不可用或能力缺失时，界面显示明确的 unavailable/degraded 状态，不使用静态数据伪装在线能力。

## 4. 消息 Connector

| Connector | 接入方式 | 主要能力 | 发布 artifact |
|---|---|---|---|
| **飞书** | Open Platform 长连接 / 回调 | 文本、图片、语音、文档、视频、卡片、编辑、删除、Chat 信息、回调、处理状态 | `cowd-edge-open-platform-message` |
| **Email** | SMTP / IMAP | 文本与文档发送、邮件接收、独立收发模式和健康状态 | `cowd-edge-email-message` |
| **企微** | Callback + API | 消息收发、回调验签、加解密和健康状态 | `cowd-edge-wecom-message` |
| **微信 iLink** | QR 登录 + 长轮询 | 文本、图片、Chat 信息、账户管理、长轮询和健康状态 | `cowd-edge-wechat-ilink-message` |

消息域统一使用 `MessageConnectorContract` 描述 endpoint、resource mode、最大消息长度、Markdown 方言、线程与附件能力。平台差异保留在 Adapter 内，不泄漏为 Core 的任务分支。

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
Message Action
     │ 文本 / 媒体 / 卡片 / 编辑 / 状态清理
     ▼
Platform Receipt
```

飞书 Adapter 还包含访问控制、路由规则、Markdown/Card 转换、媒体上传下载、处理队列、Typing reaction 和 Approval Card；微信 iLink 支持 QR 账户创建与持久化；消息去重与 processing complete/failed 使重连和失败路径保持幂等。

## 5. 数据源 Connector

| Connector | 读取对象 | 发布 artifact |
|---|---|---|
| **PostgreSQL** | Schema、表、分页 Snapshot、基于水位线的增量 | `cowd-edge-sql-source` |
| **MySQL** | Schema、表、分页 Snapshot、基于水位线的增量 | `cowd-edge-sql-source` |
| **MariaDB** | Schema、表、分页 Snapshot、基于水位线的增量 | `cowd-edge-sql-source` |
| **飞书多维表格** | Base、Table、字段 Schema、记录 Snapshot/Incremental | `cowd-edge-bitable-source` |
| **Lark Base** | Base、Table、字段 Schema、记录 Snapshot/Incremental | `cowd-edge-bitable-source` |

Source Connector 输出 `SourceRecordBatch`、Schema、cursor、checksum、truncated 标记和 `SourceWatermark`。Gateway 与 Matrix 数据面负责 SourcePack 映射、事务提交、receipt 和 watermark 推进，Connector 只执行受计划约束的读取。

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

只读约束、分页上限、预期 revision 和 watermark compare-and-set 防止数据源适配器变成无治理的数据写入旁路。

## 6. Edge Contract 与 Managed Edge v2

`edge-contract` 同时定义所有 Edge 单元共享的管理平面，以及 Message 与 Source 各自独立的业务合同。共享生命周期不意味着把消息和数据源压缩成一个万能 JSON Action。

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
              ready/degraded restart/circuit terminate/unlink
```

运行状态包括 `discovered`、`starting`、`ready`、`degraded`、`restarting`、`unavailable`、`disabled`、`failed` 和 `circuit-open`。失败按 Manifest、入口、Spawn、Exit、Health、Protocol、Auth、Network 等类别归因；Supervisor 仅在 Repair Policy 允许时重启，超过窗口阈值后打开 circuit，阻止无限拉起。

纯配置变更通过校验后可在线 configure；artifact、driver profile、transport 或安装内容变化触发有界重启。错误配置保留当前可用实例，并把拒绝原因投影到 Gateway。

## 7. 可靠性与安全边界

- **私有传输**：Managed Sidecar 使用权限为 `0600` 的 Unix Domain Socket、短期 credential 与认证 H2。
- **事件可靠性**：每个事件带 sequence、correlation 和 ACK；重连从已确认位置继续。
- **幂等与去重**：平台事件、Card Action、消息镜像和 Source watermark 各有稳定去重键。
- **背压与取消**：持久连接支持多路复用、并发上限、请求取消、deadline 和优雅 drain。
- **故障隔离**：每个逻辑 Connector 独立健康与 circuit；共享 artifact 不共享故障状态。
- **配置治理**：Manifest schema、运行配置与 Driver Profile 三方一致；无效配置不替换健康实例。
- **职责隔离**：身份绑定、消息账本、Session 路由、模型执行、事实提交和审计都由 Core 持有。

## 8. 与 Core、App 和外部平台的关系

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
              Core Runtime       Reality Core          App Host
              Turn/Graph         Memory/Matrix         MFG/future
```

| 关系 | 所有权 |
|---|---|
| Edge → Gateway | 发现、握手、配置、健康、事件、消息动作和数据批次通过显式合同交换。 |
| Gateway → Runtime | Gateway 将受理后的用户意图交给 Runtime；Edge 不直接调用模型循环。 |
| Gateway → Matrix | Source batch 经校验和事务提交进入 Matrix；Edge 不持有事实终态。 |
| App → Edge WebUI | App 提供版本锁定的 UI source，由 WebUI Host 装配；App 业务状态仍由 Core App Host 管理。 |
| Core → Edge Contract | Core 使用生成合同副本，并通过版本门禁验证 schema、Manifest 和 Driver Profile 一致性。 |

## 9. 使用与构建

```bash
# WebUI 开发
npm --prefix surfaces/webui install
npm run dev:webui

# WebUI、Connector 合同与 Rust 检查
npm run check

# WebUI + 六个 Sidecar artifact
npm run build

# 仅构建 Sidecar
npm run build:sidecars
```

Gateway 通过 `gateway.webui_dir` 挂载 `surfaces/webui/dist`。Connector 的 `surface.json` 随安装内容进入 Edge 搜索目录，由 Gateway 自动发现；配置满足 schema 后进入 `ready`，缺少凭据或外部服务不可达时进入带原因的 `degraded` 或 `failed`。

## 10. 发布矩阵

```text
9 个逻辑 Connector
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

逻辑实例独立、实现 artifact 复用，是 Edge 的核心发布模型：平台或数据库差异由 Driver Profile 注入，生命周期、健康、Wire Protocol 与 Sidecar 宿主保持一致。

## 系统说明书

打开 [中文默认的 HTML 说明书](docs/manual/index.html)，页面右上角可切换英文：

| 分册 | 内容 |
|---|---|
| [Edge 总览](docs/manual/index.html) | 仓库定位、发布清单和关键边界 |
| [架构与生命周期](docs/manual/architecture.html) | Manifest、Managed Edge v2、状态和自动修复 |
| [消息 Connector](docs/manual/message-connectors.html) | Session 绑定、可靠消息、媒体与失败恢复 |
| [数据源 Connector](docs/manual/source-connectors.html) | Snapshot、Incremental、Watermark 和 Matrix 消费 |
| [WebUI Surface](docs/manual/webui.html) | 控制台信息架构、对话呈现和性能规则 |
| [构建、配置与排障](docs/manual/operations.html) | 构建矩阵、安装布局、热加载和排障路径 |
