# Cowd Edge

`cowd-edge` 是 Cowd 的独立边缘能力仓库。它承载非 TUI 的用户界面 surface，以及可按需构建、按需安装的外部连接器。

当前版本：`0.9.662`。

## 1. 定位

Cowd Core 负责 AI Harness 内核、Gateway、Runtime、Memory、Matrix、Connector 合同和 SourceSnapshot 落库。Cowd Edge 负责把外部世界接入 Gateway，但不把平台 SDK、前端工程、长连接协议或重型驱动编译进 core 默认构建。

Edge 下分两大类：

```text
surfaces
  面向人的界面，例如 WebUI。TUI 本轮仍在 core，不迁移。

connectors
  message
    飞书、邮件、企微、微信 iLink 等消息入口/出口。
  source
    PostgreSQL、MySQL、MariaDB、飞书多维表、Lark Base 等数据源快照和事件归一化。
  automation
    后续 webhook、browser-rpa 等副作用动作。
```

## 2. 核心原则

- Gateway 是唯一 EdgeHost：发现、启动、配置、健康、callback、static、event、delivery、repair 都由 Gateway 管理。
- Runtime 不依赖本仓库，不链接平台 SDK，不直接持有外部连接。
- WebUI 是 surface；飞书、邮件、企微、微信 iLink 是 message connector。
- Source connector 只返回标准 `SourceRecordBatch`，不直接写 Matrix，不直接创建 memory。
- Matrix 的 SourceSnapshot、SourcePack、事实/关系/证据落库仍由 core 完成。
- 数据库 Source 使用 `limit + 1` 判定下一页，不执行全表 `COUNT(*)`；增量窗口分页完成前只推进
  continuation offset，最后一页才推进字段水位线，避免同一水位值跨页时漏数。
- 同一资源的增量读取串行，不同资源可以并行；Edge 只返回候选 `watermark_after`，持久提交仍由
  Gateway/Matrix owner 完成。
- 平台文档操作、后台操作、业务动作不内置到 message connector；后续通过 skill/tool 安装。
- managed Edge 可以由 Rust 或其他语言实现；生产协议统一使用私有 UDS 上的 authenticated HTTP/2。stdio JSONL 仅保留给一次一请求的 OneShot 单元。

## 3. 当前目录

当前仓库的目标结构如下：

```text
crates/edge-contract
  Edge 生命周期、sealed runtime manifest 与 v2 wire 合同。

crates/edge-adapters
  sidecar runtime、平台适配实现、消息/资源连接器二进制入口。

surfaces/webui
  Vue/Vite WebUI 静态 surface。

connectors/message/feishu
connectors/message/email
connectors/message/wecom
connectors/message/wechat-ilink
  消息连接器 manifest 和发布单元。

connectors/source/postgres
connectors/source/mysql
connectors/source/mariadb
connectors/source/feishu-bitable
connectors/source/lark-bitable
  Source connector manifest 和发布单元。
```

本阶段 TUI 不迁移。`tui` 仍作为 core 内置 interactive surface，通过 Gateway HTTP API 使用后端能力。

## 4. 构建

WebUI：

```bash
# Node.js 22.12+（或兼容 Vite 8 的 Node.js 20.19+）
npm --prefix surfaces/webui install
npm --prefix surfaces/webui test
npm --prefix surfaces/webui run build
```

Edge sidecar：

```bash
cargo check --workspace --bins
cargo build --release -p edge-adapters --bins --features source-db
```

9 个逻辑 Connector 使用 6 个依赖族 artifact；安装器将二进制放在 Edge 安装根的 `bin/`，manifest 继续各自独立：

```text
surfaces/webui/dist
bin/cowd-edge-open-platform-message
bin/cowd-edge-email-message
bin/cowd-edge-wecom-message
bin/cowd-edge-wechat-ilink-message
bin/cowd-edge-bitable-source
bin/cowd-edge-sql-source
```

## 5. Manifest 合同

Edge 单元由 `surface.json` 描述。文件名暂沿用现有 Gateway 发现逻辑，语义上表示 Edge manifest。

WebUI surface：

```json
{
  "schema": "cowd.surface.v1",
  "id": "webui",
  "name": "Cowd WebUI",
  "version": "0.9.662",
  "kind": "web-surface",
  "resources": [
    { "kind": "static", "mount": "/", "dir": "./dist", "spa": true }
  ],
  "default_enabled": true
}
```

Message connector：

```json
{
  "schema": "cowd.surface.v1",
  "id": "feishu",
  "name": "Feishu Message Connector",
  "version": "0.9.662",
  "kind": "message-connector",
  "runtime": {
    "kind": "managed",
    "artifact": "cowd-edge-open-platform-message",
    "driver_profile": "feishu-message",
    "transport": "uds-http2"
  },
  "capabilities": [
    "message.ingress",
    "message.egress",
    "message.callback",
    "message.health",
    "message.processing_lifecycle"
  ],
  "routes": [
    { "kind": "callback", "path": "/events", "method": "POST", "public": true }
  ],
  "default_enabled": false
}
```

Source connector：

```json
{
  "schema": "cowd.surface.v1",
  "id": "feishu-bitable",
  "name": "Feishu Bitable Source Connector",
  "version": "0.9.662",
  "kind": "source-connector",
  "runtime": {
    "kind": "managed",
    "artifact": "cowd-edge-bitable-source",
    "driver_profile": "feishu-bitable",
    "transport": "uds-http2"
  },
  "capabilities": [
    "source.schema_discovery",
    "source.snapshot",
    "source.incremental",
    "source.event",
    "source.health"
  ],
  "default_enabled": false
}
```

## 6. Managed Edge v2 协议

Gateway 为每个逻辑 Connector 启动独立进程，创建权限为 `0600` 的 UDS 和一次性 credential。Edge 消费 credential 后删除文件，双方在一个持久 H2 连接上多路复用 control、message、source 与 event stream；JSON 仅作为 DTO 编码。

```json
POST /_cowd/edge/v2/handshake
POST /_cowd/edge/v2/configure
POST /_cowd/edge/v2/connect
GET  /_cowd/edge/v2/health
GET  /_cowd/edge/v2/events
POST /_cowd/edge/v2/events/ack
```

Message connector 使用 `/message/send` 与 `/action`；Source 使用 `/source/read`、`/source/schema`、`/source/incremental` 和 `/source/watermark/commit`。完整 DTO 规范位于 `contracts/edge/v2/schema.json`，生成物不得手工修改。

响应仍使用共享 `SurfaceFrame` 业务 DTO；H2 stream 提供 correlation、取消和流控，event 使用 sequence + ACK 重放合同。

## 7. Gateway 对接

Gateway 负责：

- 扫描安装目录和用户配置目录下的 `surfaces/*`、`connectors/message/*`、`connectors/source/*`。
- 统一启动、停止、重启、修复 managed sidecar。
- 转发 WebUI static resource。
- 转发 message callback/webhook。
- 保存 message inbox/outbox/delivery ledger。
- 触发 Source connector 读取 batch，并把 rows 交给 Matrix SourceSnapshot。

Gateway API 分层：

| API | 用途 |
|---|---|
| `/api/edges/*` | Edge 总览、分类、健康、运行态 |
| `/api/surfaces/*` | UI surface 业务域 |
| `/api/connectors/*` | Connector 合同、账户、资源、Source adapter |
| `/api/matrix/source-packs/*/snapshots/*` | SourceSnapshot plan/run/list/get |

WebUI 的 Session 加载遵守两阶段读取合同：

1. 先读取 `/api/sessions/:id/history-index`，获得恢复代际、checkpoint、索引覆盖、近期元数据和导航卡片，不传输消息正文；
2. 首屏只读取最近一页正文，向上滚动时再分页；执行图、Turn 活动和证据只在全景面板展开后按需加载。

全景活动面板同时消费 Gateway 的连续输入归属、历史恢复状态、上下文覆盖和
Harness/Provider 分段延迟。WebUI 不重建第二套 Session、Mission 或执行状态。

对话执行过程采用三层投影：主对话只保留 Agent、Tool、审批、失败和最终回答等业务事件；右侧活动按用户 Turn、Team/Agent 通道及 Tool 依赖波次展示完整时间线；执行图默认压缩为目标、Team、Agent 与关键门禁节点，Tool 作为 Agent 的并行批次下钻。实时 `AgentLifecycle` 与 Gateway 持久回放使用同一身份键，刷新不会新增伪步骤；活动只覆盖既有图节点状态，不反向创造 Runtime 拓扑。

### 7.1 WebUI 加载与治理边界

- 默认关闭右侧全景栏时，不请求执行图、证据、Memory、工作区等全景数据；展开后再按当前
  Session 和可见面板异步接线。
- 会话切换先读取历史索引和最近正文，活动图、证据和其他面板不阻塞聊天首屏。
- 各业务页不再展示重复的 OpenAPI/端点清单；完整能力合同、OpenAPI 和 OpenAI tools 只在
  Gateway 管理页按需读取。
- Memory 页直接消费 Gateway 的自动治理状态、最近运行统计和人工扫描回执。夜间治理运行中
  禁止重复发起手动全盘扫描；扫描结束后再允许操作。
- 页面发布版本从 Gateway health 与 Edge 构建常量组合，避免为显示版本额外加载完整 OpenAPI。
- 前端缓存只保存可失效的读取投影和浏览器交互状态，不替代 Gateway 的 Session、审批或执行真相。
- 对话主时间线直接消费 session SSE；早于 execution receipt 到达的思考、工具和证据事件会迁移到正式
  execution，不依赖刷新或右侧全景栏才能显示。
- 工作区只保留文件树和弹窗预览；文本、Markdown、HTML、图片与下载在同一预览器处理，文件名和
  文件大小使用可读格式，预览器提供链接复制与文本编辑。
- Skills 管理面区分目录、Surface 投影、文件树、运行记录和治理；上传的 `.tar` 包由 Gateway 检查后
  安装，WebUI 不自行解包或绕过技能治理。
- Mission Control 的定时任务页消费 Runtime 唯一调度存储，支持 at、interval、cron、时区、权限上限、
  立即运行、暂停、恢复与删除；不存在前端调度器或第二套执行链路。

## 8. 当前能力状态

| 单元 | 目标域 | 当前状态 |
|---|---|---|
| `webui` | Surface | 已接入 Gateway static，继续在 `surfaces/webui` |
| `feishu` | Message Connector | 已有 WebSocket、消息收发、callback、health、processing lifecycle；目录语义待迁移 |
| `email` | Message Connector | 已有 sidecar scaffold，需按 message connector 目录迁移 |
| `wecom` | Message Connector | 已有 sidecar scaffold，需按 message connector 目录迁移 |
| `wechat-ilink` | Message Connector | 已有 sidecar scaffold，需按 message connector 目录迁移 |
| `postgres` | Source Connector | 已有 schema discovery、snapshot batch、incremental plan、event normalize；需使用 `source-db` feature 构建，真实读取需配置 DSN 或 host/database/user。 |
| `mysql` | Source Connector | 已有 schema discovery、snapshot batch、incremental plan、event normalize；需使用 `source-db` feature 构建，真实读取需配置 DSN 或 host/database/user。 |
| `mariadb` | Source Connector | 已有 schema discovery、snapshot batch、incremental plan、event normalize；需使用 `source-db` feature 构建，通过 MySQL wire protocol 连接。 |
| `feishu-bitable` | Source Connector | 已有 schema discovery、snapshot batch、incremental plan、event normalize；fixture 可测，真实远端读取需配置飞书凭据和 app/table。 |
| `lark-bitable` | Source Connector | 已有 schema discovery、snapshot batch、incremental plan、event normalize；fixture 可测，真实远端读取需配置 Lark 凭据和 app/table。 |
