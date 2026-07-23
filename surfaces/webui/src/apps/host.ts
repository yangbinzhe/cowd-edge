/**
 * Edge 面向静态装配 APP 的公开宿主 ABI。
 * 外部 APP 只能通过这个模块访问通用 UI、认证请求、投影和本地化能力。
 */
export { api, ApiWriteError } from '../api/client';
export { read, write, registerRequestedCapabilities } from '../api/client';
export { t, tc, useI18n, locale, setLocale, registerMessages } from '../i18n';
export type { Locale, MessageParams } from '../i18n';
export type { components as GatewayComponents } from '../generated/gateway-api';
export { useProjectionRegistryStore } from '../stores/projectionRegistry';
export { adaptEntityImpact } from '../adapters/graph/entityImpact';
export { adaptMetricLineage } from '../adapters/graph/metricLineage';
export { resolveAppRuntimeExecutionId } from '../adapters/strategyDecision';
export { publicErrorSummary } from '../utils/publicError';
export type { GraphViewModel } from '../types/graph';

export { default as ApiStateBanner } from '../components/workbench/ApiStateBanner.vue';
export { default as DataTable } from '../components/workbench/DataTable.vue';
export { default as EmptyState } from '../components/workbench/EmptyState.vue';
export { default as EvidenceTrace } from '../components/workbench/EvidenceTrace.vue';
export { default as ObjectInspectorDrawer } from '../components/workbench/ObjectInspectorDrawer.vue';
export { default as RequestReceipt } from '../components/workbench/RequestReceipt.vue';
export { default as GraphSurface } from '../components/graph/GraphSurface.vue';
export { graphDiagnostics } from '../components/graph/graphRuntime';
export { default as StrategyDecisionSummary } from '../components/runtime/StrategyDecisionSummary.vue';
