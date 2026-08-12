# Cowd Edge 文档

本目录只保存当前产品有效的架构、操作和发布说明，不保存阶段计划、临时测试输出或本地运行数据。

## 系统说明书

- [HTML 总入口](manual/index.html)：中文默认，可切换英文和明暗主题。
- [架构与生命周期](manual/architecture.html)
- [消息连接器](manual/message-connectors.html)
- [数据源连接器](manual/source-connectors.html)
- [WebUI Surface](manual/webui.html)
- [构建、配置与排障](manual/operations.html)

说明书以 `v0.9.677` 的 manifest、Edge v2 合同、WebUI 源码和发布门禁为事实依据。运行状态以 Gateway 的 Edge 投影为准，静态文档不代替在线健康检查。

## v0.9.677 WebUI 能力要点

- Chat 用户/系统消息一键复制（Clipboard API + 兼容回退）。
- 每个最终结果“分支新会话”：复用 `branchSession`，创建后自动切换并重载消息；store 级 in-flight guard 防双击。
- 发布门禁：`npm run test:smoke` 校验 12 路由渲染、dist 静态引用完整性与 P12 锚点；CI 新增 Playwright e2e + dist 完整性。
- 执行图视口修复与 v0.9.676 能力保持不回退（见下方历史要点）。

- live 订阅收敛为单条物理连接，surface_instance 使用 `observerId:tab:<nonce>`，多标签不再共享
  订阅计数；页面卸载必定关闭租约。
- 授权失效自动恢复每浏览器会话最多一次，再次失效只提示、不循环刷新。
- 执行图视口按图 id 持久化：缩放/平移后打开节点详情不再回弹；拓扑变化或方向切换才重新 fit。
- 阻断卡片只渲染结构化 `failure_kind`/`recovery_hints`，不再按正文关键词猜测。
- bash 等工具活动树显示 `command_category` 标签；`get_context_remaining`、`current_time`、
  `request_plugin_install`（显式不支持）已进入能力合同。
