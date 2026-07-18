# V550 cowd-edge UDS/H2 版本证据

版本：`0.9.550`。结论：V550 managed transport、artifact/profile 与合同门禁通过。

- 生产 server：同 UID + constant-time token、一次性 credential、`0600` UDS、H2 multiplex、1 MiB request limit、256 in-flight、30 秒 handler timeout。
- event：4096 replay buffer、sequence/ACK、future ACK 拒绝、满队列背压、lag replay。
- 6 个 artifact 服务 9 个独立逻辑 profile；manifest 和 Rust registry 均由 `contracts/driver-profiles.json` 生成。
- 真实二进制矩阵同时启动 9 个进程并完成 9 次 bootstrap、72 次并发 health；耗时范围 `1.819–5.583 ms`，credential 全消费、socket 全 `0600`。
- 单 UDS/H2 连接 64 个 50 ms delayed action 在 `<500 ms` 内完成，最大并发 `>=8`；取消、event replay/ACK、oversize、Feishu/Lark 域名隔离测试通过。
- canonical schema SHA-256：`b75aa5d5bfa21afa0899828de3ba43349bae5754c60af95f79cd3a895cc13ed7`；generated Rust SHA-256：`16fcd9e56834b716c6e5fdf1f87fd729e4b24fad6090ffb5d5e242b6030a61f4`，与 Cowd 完全一致。

本体提交门禁复核：

- `cargo fmt --all -- --check` 通过。
- `cargo check --workspace --all-targets --features source-db` 通过。
- `cargo test --workspace --features source-db`：401 passed / 0 failed；4 个示例型文档测试按设计 ignored。
- `node scripts/eval-managed-edge-h2.mjs` 再次通过：9 个真实进程、72 个并发 health 请求全部成功，单 profile 批次耗时 `1.839–8.979 ms`，credential 全部消费，socket 全部为 `0600`。
- WebUI `index.html` 引用的 4 个入口资产全部存在，静态构建产物没有悬空引用。

V551/V552 才负责解除 Message/Source 业务 owner 的 coarse lock、短命 pool/client 和全批响应；这些残留没有被错误计入 V550。
