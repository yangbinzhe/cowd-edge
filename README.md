# Cowd Edge

`cowd-edge` 是 Cowd 的独立边缘能力仓库。它承载非 TUI 的用户界面 surface，以及可按需构建、按需安装的外部连接器。

当前版本：`0.9.419`。

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
- 平台文档操作、后台操作、业务动作不内置到 message connector；后续通过 skill/tool 安装。
- sidecar 可以由 Rust 或其他语言实现；当前主协议统一使用 stdio JSONL。

## 3. 当前目录

当前仓库的目标结构如下：

```text
crates/edge-contract
  Edge JSONL 生命周期与 manifest 合同。

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
npm --prefix surfaces/webui install
npm --prefix surfaces/webui test
npm --prefix surfaces/webui run build
```

Edge sidecar：

```bash
cargo check --workspace --bins
cargo build --release --workspace --bins
cargo build --release -p edge-adapters --features source-db --bin cowd-edge-postgres-source --bin cowd-edge-mysql-source --bin cowd-edge-mariadb-source
```

构建产物按连接器类型进入对应安装目录：

```text
surfaces/webui/dist
connectors/message/feishu/cowd-edge-feishu-message
connectors/message/email/cowd-edge-email-message
connectors/message/wecom/cowd-edge-wecom-message
connectors/message/wechat-ilink/cowd-edge-wechat-ilink-message
connectors/source/postgres/cowd-edge-postgres-source
connectors/source/mysql/cowd-edge-mysql-source
connectors/source/mariadb/cowd-edge-mariadb-source
connectors/source/feishu-bitable/cowd-edge-feishu-bitable-source
connectors/source/lark-bitable/cowd-edge-lark-bitable-source
```

## 5. Manifest 合同

Edge 单元由 `surface.json` 描述。文件名暂沿用现有 Gateway 发现逻辑，语义上表示 Edge manifest。

WebUI surface：

```json
{
  "schema": "cowd.surface.v1",
  "id": "webui",
  "name": "Cowd WebUI",
  "version": "0.9.419",
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
  "version": "0.9.419",
  "kind": "message-connector",
  "entry": "./cowd-edge-feishu-message",
  "transport": "stdio-jsonl",
  "lifecycle": "managed",
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
  "version": "0.9.419",
  "kind": "source-connector",
  "entry": "./cowd-edge-feishu-bitable-source",
  "transport": "stdio-jsonl",
  "lifecycle": "managed",
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

## 6. JSONL 协议

Gateway 与 sidecar 每行传输一个 JSON frame。生命周期帧在 Surface、Message Connector、Source Connector 之间复用：

```json
{"type":"handshake","id":"req-1","protocol":"cowd.surface.v1","gateway_version":"0.9.419"}
{"type":"configure","id":"req-2","surface":"feishu","config":{}}
{"type":"connect","id":"req-3","surface":"feishu"}
{"type":"health","id":"req-4","surface":"feishu"}
```

Message connector 使用 `send` 和 message action：

```json
{"type":"send","id":"req-5","surface":"feishu","recipient":"oc_xxx","thread":null,"text":"hello","metadata":{}}
{"type":"action","id":"req-6","surface":"feishu","action":"message.processing_complete","payload":{"message_id":"om_xxx"}}
```

Source connector 使用 source action：

```json
{"type":"action","id":"req-7","surface":"feishu-bitable","action":"source.read_batch","payload":{"adapter_id":"feishu_bitable","resource_ref":"feishu-bitable://app/table","limit":100}}
{"type":"action","id":"req-8","surface":"postgres","action":"source.schema_discovery","payload":{"adapter_id":"postgres","resource_ref":"postgres://***:***@localhost/db","table":"public.orders"}}
{"type":"action","id":"req-9","surface":"feishu-bitable","action":"source.event.normalize","payload":{"events":[{"event_type":"record.changed","app_token":"app","table_id":"tbl","record_ids":["rec_1"]}]}}
```

响应必须返回标准 payload；Source connector 的 `source.read_batch` 必须返回 core `connector::SourceRecordBatch` 兼容结构。

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
