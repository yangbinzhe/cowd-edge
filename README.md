# Cowd Surface

`cowd-surface` 是 Cowd 的独立 surface 仓库。当前版本：`0.9.418`。

本仓库承载除 TUI 之外的所有 UI surface 和外部渠道 sidecar。core 仓库只保留 `surface` 协议、Gateway 装载/调度能力和可选 TUI；WebUI、飞书、邮件、企微、微信 iLink 以及后续更多 surface 都在本仓库按需独立构建、独立演进。

## 1. 设计目标

### 1.1 为什么独立

非 TUI surface 会引入大量与 AI Harness 内核无关的依赖：

- WebUI 的 Node/Vite/Vue 生态。
- 飞书、企微、微信 iLink 的 HTTP/WebSocket/crypto/protobuf 依赖。
- 邮件的 SMTP/IMAP/TLS/mail parser 依赖。
- 未来移动端、桌面端、机器人端或其他语言实现的 surface。

这些能力都需要存在，但不应该进入 core 的默认 debug 构建，也不应该让 Runtime 直接链接平台 SDK。因此独立出 `cowd-surface`，用 manifest + JSONL sidecar 协议连接 Gateway。

### 1.2 边界原则

- Gateway 负责发现 surface、转发静态资源、转发 callback、收集 health/events，并通过 JSONL 调度 sidecar。
- Runtime 不依赖本仓库，不链接平台 SDK，不直接持有渠道连接。
- 每个非 TUI surface 都是可按需构建的独立包。
- WebUI 也是 surface，和外部渠道一样通过 manifest 被 Gateway 识别。
- 渠道文档操作、平台高级操作不内置到 surface，后续通过 skill/tool 安装。
- sidecar 可以用 Rust 实现，也可以由其他语言按同一 JSONL 协议实现。
- 外部渠道只负责连接、接收、发送、callback、health 和本平台消息状态清理，不持有 Cowd Runtime、Memory、Matrix 或 provider。

## 2. 目录结构

```text
crates/surface
  Surface JSONL 协议合同，和 cowd core 保持同步。

crates/surface-adapters
  平台适配实现与 sidecar 二进制入口。

surfaces/webui
  Vue/Vite WebUI 静态 surface。

surfaces/feishu
  飞书 surface manifest。

surfaces/email
  邮件 surface manifest。

surfaces/wecom
  企微 surface manifest。

surfaces/wechat-ilink
  微信 iLink surface manifest。
```

## 3. Surface 类型

### 3.1 WebUI 静态 surface

WebUI 是浏览器管理面，负责复杂状态、表格、过滤、详情、批量操作、证据 drill-down 和治理回执展示。

构建：

```bash
npm --prefix surfaces/webui install
npm --prefix surfaces/webui test
npm --prefix surfaces/webui run build
```

构建产物：

```text
surfaces/webui/dist
```

Gateway 通过 core 配置读取该目录：

```yaml
gateway:
  webui_dir: "/path/to/cowd-surface/surfaces/webui/dist"
```

构建结果必须包含 `dist/index.html`。Gateway 根路由和 `/s/webui/*` 的 SPA fallback 都依赖这个入口；`index.dev.html` 是开发入口，不作为唯一发布入口。

### 3.2 外部渠道 sidecar

外部渠道 surface 是独立进程，通过 stdio JSONL 与 Gateway 通信。

构建：

```bash
cargo check --workspace --bins
cargo build --release -p surface-adapters --bins
```

输出：

```text
target/release/cowd-surface-feishu
target/release/cowd-surface-email
target/release/cowd-surface-wecom
target/release/cowd-surface-wechat-ilink
```

## 4. Manifest 合同

每个 surface 由 `surface.json` 描述。

```json
{
  "schema": "cowd.surface.v1",
  "id": "feishu",
  "name": "Feishu Surface",
  "version": "0.9.418",
  "kind": "external-integration",
  "entry": "./cowd-surface-feishu",
  "transport": "stdio-jsonl",
  "lifecycle": "managed",
  "capabilities": ["ingress", "egress", "callback", "health"],
  "routes": [
    { "kind": "callback", "path": "/events", "method": "POST", "public": true }
  ],
  "resources": [],
  "health": { "mode": "jsonl", "interval_ms": 30000 },
  "default_enabled": false
}
```

核心字段：

| 字段 | 含义 |
|---|---|
| `schema` | 协议版本，当前为 `cowd.surface.v1`。 |
| `id` | surface 唯一 ID。 |
| `kind` | `web-surface`、`external-integration` 等。 |
| `entry` | sidecar 可执行文件；静态 WebUI 可为空。 |
| `transport` | 当前为 `stdio-jsonl`。 |
| `lifecycle` | `builtin`、`one-shot` 或 `managed`。 |
| `capabilities` | surface 声明的能力。 |
| `routes` | 需要 Gateway 转发的 callback/webhook/OAuth route。 |
| `resources` | 静态资源挂载，例如 WebUI `dist`。 |
| `health` | registry health 或 JSONL health。 |

## 5. JSONL 协议

Gateway 与 sidecar 每行传输一个 JSON frame。

典型请求：

```json
{"type":"handshake","id":"req-1","protocol":"cowd.surface.v1","surface":"feishu"}
```

典型响应：

```json
{"type":"handshake-ok","id":"req-1","capabilities":["ingress","egress","health"]}
```

发送消息：

```json
{"type":"send","id":"req-2","surface":"feishu","target":"chat:demo","payload":{"text":"hello"}}
```

操作回执：

```json
{"type":"ok","id":"req-2","payload":{"delivered":true}}
```

事件上报：

```json
{"type":"event","id":"evt-1","surface":"feishu","event":"message.received","payload":{"text":"hi"}}
```

Gateway 对 managed sidecar 复用进程，并按 request id 匹配响应；event frame 会进入 surface event buffer。

处理状态清理 action：

```json
{"type":"action","id":"req-3","surface":"feishu","action":"message.processing_complete","payload":{"message_id":"om_xxx"}}
{"type":"action","id":"req-4","surface":"feishu","action":"message.processing_failed","payload":{"message_id":"om_xxx","error":"runtime failed"}}
```

Feishu sidecar 收到用户消息后会在原消息上设置 `Typing` reaction。Gateway 完成 runtime turn、回复成功、空回复或失败时会发送上述 action；Feishu reply 发送路径也会用 `reply_to` 做兜底清理，保证已经回复的消息不再残留“处理中”标记。

## 6. Gateway 对接

Gateway 根据 manifest 提供统一入口：

| API | 用途 |
|---|---|
| `GET /api/surfaces` | 已发现 surface 列表 |
| `GET /api/surfaces/:id/health` | surface health |
| `GET /api/surfaces/:id/events` | sidecar event buffer |
| `GET /api/surfaces/:id/routes` | route 摘要 |
| `GET /api/surfaces/:id/resources` | resource 摘要 |
| `GET /api/surfaces/:id/inbox` | 持久 inbound 消息账本，含 active/terminal snapshot |
| `GET /api/surfaces/:id/outbox` | 持久 outbound 投递账本 |
| `GET /api/surfaces/:id/deliveries` | delivery event 账本 |
| `POST /api/surfaces/:id/inbox/:message_id/replay` | 重放 inbound 消息 |
| `POST /api/surfaces/:id/outbox/:delivery_id/retry` | 重试 outbound delivery |
| `POST /api/surfaces/:id/outbox/:delivery_id/dead-letter` | 移入 DLQ |
| `GET /s/:surface/*path` | 静态资源转发 |
| `GET|POST /surface-callback/:surface/*path` | callback/webhook 转发 |

Gateway 保持后端服务职责：发现、转发、调度、观测。具体 UI 渲染和平台 SDK 行为都在 surface 侧。

## 7. 当前 surface

| surface | 类型 | 状态 | 说明 |
|---|---|---|---|
| `webui` | static web surface | active | Vue/Vite 浏览器管理面，构建产物由 Gateway 托管。 |
| `feishu` | managed sidecar | active | 飞书 WebSocket 收消息、文本回复、callback、health、Typing reaction 生命周期清理。 |
| `email` | managed sidecar | scaffolded | SMTP/IMAP、health。 |
| `wecom` | managed sidecar | scaffolded | 企微消息、callback crypto、health。 |
| `wechat-ilink` | managed sidecar | scaffolded | QR login、long-poll、message egress。 |

`active` 表示该 surface 已接入当前 Gateway surface 协议并具备真实可用路径；`scaffolded` 表示 surface 包、manifest 和 sidecar 入口已经存在，但真实平台凭据、长期运行策略和深度场景验证仍需按具体渠道继续推进。

## 8. 验证

Rust sidecar：

```bash
cargo fmt --all --check
cargo check --workspace --bins
```

WebUI：

```bash
npm --prefix surfaces/webui test
npm --prefix surfaces/webui run build
```

构建 release sidecar：

```bash
cargo build --release -p surface-adapters --bins
```

## 9. 演进方向

- 每个 surface 可以继续拆成更独立的包或独立代码库，但协议保持不变。
- 平台高级操作不回流 Gateway/Runtime，进入 skill/tool 体系。
- WebUI、外部渠道、未来移动端都按同一 surface 发现和投递模型接入。
- JSONL 是长期主协议，不再引入多协议过渡层。
- Gateway 可以继续增强 surface 状态展示、自动发现、按需拉起和资源代理，但不链接平台 SDK。
