<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { Network, RefreshCw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import GatewayRemediationList from '../components/workbench/GatewayRemediationList.vue';
import { displayStatus } from '../i18n/domain/status';

const loading = ref(false);
const error = ref('');
const state = ref<any>({});
const actionResult = ref<any>(null);
const resourceRef = ref('');
const actor = ref('webui-operator');
const capability = ref('service.read');
const identityRef = ref('user:webui-operator');
const identityId = ref('');
const grantId = ref('');
const executeMode = ref('dry_run');
const idempotencyKey = ref('');
const platformName = ref('wechat-ilink');
const wechatBotType = ref('3');
const wechatQrCode = ref('');
const connectorServiceId = ref('');
const connectorServiceToolId = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const sourceSnapshotResult = ref<any>(null);
const sourceSnapshotPackId = ref('webui-edge-supply');
const sourceSnapshotAdapterId = ref('csv');
const sourceSnapshotResourceRef = ref('file:///tmp/cowd-edge-supply-orders.csv');
const sourceSnapshotTable = ref('orders');
const sourceSnapshotLimit = ref(100);
const sourceIncrementalStrategy = ref('offset');
const sourceIncrementalCursor = ref('');
const sourceIncrementalOffset = ref(0);
const sourceUpdatedAtField = ref('');
const sourceCursorField = ref('');
const sourceEventText = ref(JSON.stringify([
  {
    event_id: 'evt-1001',
    event_type: 'record.changed',
    operation: 'upsert',
    resource_ref: 'bitable://app/table',
    table: 'orders',
    rows: [{ order_id: 'O-2001', qty: 8 }],
  },
], null, 2));
const sourceSnapshotRowsText = ref(JSON.stringify([
  {
    order_id: 'O-1001',
    supplier_id: 'S-A',
    part_id: 'P-7',
    qty: 12,
    event_time: '2026-07-02T00:00:00Z',
  },
  {
    order_id: 'O-1002',
    supplier_id: 'S-B',
    part_id: 'P-9',
    qty: 4,
    event_time: '2026-07-02T01:00:00Z',
  },
], null, 2));
const sourceSnapshotError = ref('');

const accounts = computed(() => Array.isArray(state.value.accounts?.accounts) ? state.value.accounts.accounts : []);
const capabilities = computed(() => Array.isArray(state.value.capabilities?.capabilities) ? state.value.capabilities.capabilities : []);
const capabilityContract = computed(() => state.value.capabilityContract || {});
const capabilityCoverage = computed(() => capabilityContract.value.coverage || {});
const openApiDocument = computed(() => state.value.openApi || {});
const openAiTools = computed(() => state.value.openAiTools || {});
const openApiPathCount = computed(() => Object.keys(openApiDocument.value.paths || {}).length);
const contractCapabilities = computed(() => Array.isArray(capabilityContract.value.capabilities) ? capabilityContract.value.capabilities : []);
const contractOverviewRows = computed(() => [
  { label: t('page.gateway.contract.routes'), value: capabilityCoverage.value.route_count ?? capabilityContract.value.route_count ?? 0 },
  { label: t('page.gateway.contract.capabilities'), value: capabilityCoverage.value.capability_count ?? capabilityContract.value.capability_count ?? 0 },
  { label: t('page.gateway.contract.p1'), value: capabilityCoverage.value.p1_count ?? 0 },
  { label: t('page.gateway.contract.aiVisible'), value: capabilityCoverage.value.ai_visible_count ?? 0 },
  { label: t('page.gateway.contract.openapi'), value: capabilityCoverage.value.openapi_path_count ?? openApiPathCount.value },
  { label: t('page.gateway.contract.tools'), value: openAiTools.value.tool_count ?? capabilityCoverage.value.openai_tool_count ?? openAiTools.value.tools?.length ?? 0 },
  { label: t('page.gateway.contract.parity'), value: capabilityCoverage.value.route_contract_parity ? 'yes' : 'no' },
]);
const gatewayContractRows = computed(() => contractCapabilities.value
  .filter((item: any) => item.domain === 'connector' || item.domain === 'cross_plane' || item.domain === 'surface' || item.domain === 'edge' || item.http?.path?.startsWith('/api/gateway'))
  .slice(0, 24)
  .map((item: any) => ({
    id: item.id,
    domain: item.domain,
    method: item.http?.method || '-',
    path: item.http?.path || '-',
    risk: item.risk || '-',
    visible: item.surface_visibility?.webui === false ? 'hidden' : 'webui',
  })));
const openAiToolRows = computed(() => (Array.isArray(openAiTools.value.tools) ? openAiTools.value.tools : [])
  .slice(0, 18)
  .map((item: any) => ({
    name: item.function?.name || '-',
    description: item.function?.description || '-',
    parameters: Object.keys(item.function?.parameters?.properties || {}).length,
  })));
const resources = computed(() => Array.isArray(state.value.resources?.resources) ? state.value.resources.resources : Array.isArray(state.value.resources?.items) ? state.value.resources.items : []);
const mcpServers = computed(() => Array.isArray(state.value.mcp?.servers) ? state.value.mcp.servers : []);
const connectorServices = computed(() => Array.isArray(state.value.connectorServices?.services) ? state.value.connectorServices.services : []);
const edgeRegistry = computed(() => state.value.edge || {});
const edgeHealth = computed(() => edgeRegistry.value.health || state.value.edgeHealth?.health || {});
const edgeMessageConnectors = computed(() => Array.isArray(edgeRegistry.value.message_connectors) ? edgeRegistry.value.message_connectors : []);
const edgeSourceConnectors = computed(() => Array.isArray(edgeRegistry.value.source_connectors) ? edgeRegistry.value.source_connectors : []);
const edgeAutomationConnectors = computed(() => Array.isArray(edgeRegistry.value.automation_connectors) ? edgeRegistry.value.automation_connectors : []);
const connectorSourceAdapters = computed(() => Array.isArray(state.value.connectorSources?.adapters) ? state.value.connectorSources.adapters : []);
const configReloadStatus = computed(() => state.value.configReload || {});
const configReloadRestartFields = computed(() => {
  const fields = configReloadStatus.value?.restart_required?.fields;
  return Array.isArray(fields) && fields.length ? fields.join(', ') : '-';
});
const executions = computed(() => Array.isArray(state.value.executions?.executions) ? state.value.executions.executions : []);
const identities = computed(() => Array.isArray(state.value.identities?.identities) ? state.value.identities.identities : []);
const grants = computed(() => Array.isArray(state.value.grants?.grants) ? state.value.grants.grants : []);
const edgeRows = computed(() => [
  ...edgeMessageConnectors.value.map((item: any) => ({ ...item, edge_type: 'message' })),
  ...edgeSourceConnectors.value.map((item: any) => ({ ...item, edge_type: 'source' })),
  ...edgeAutomationConnectors.value.map((item: any) => ({ ...item, edge_type: 'automation' })),
].map((item: any) => ({
  domain: item.domain || item.edge_type || '-',
  id: item.id || '-',
  name: item.name || item.id || '-',
  status: item.runtime?.status || item.status || (item.requires_sidecar ? 'sidecar' : 'declared'),
  lifecycle: item.lifecycle || item.access_mode || '-',
  capabilities: Array.isArray(item.capabilities) ? item.capabilities.length : item.capability_count ?? '-',
  routes: item.route_count ?? '-',
  resources: item.resource_count ?? '-',
  source: item.source || item.family || '-',
})));
const messageConnectorRows = computed(() => edgeMessageConnectors.value.map((item: any) => ({
  id: item.id || '-',
  name: item.name || item.id || '-',
  status: item.runtime?.status || item.status || 'declared',
  capabilities: Array.isArray(item.capabilities) ? item.capabilities.join(', ') : item.capability_count ?? '-',
  entry: item.entry || '-',
  diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.length : 0,
})));
const sourceConnectorRows = computed(() => edgeSourceConnectors.value.map((item: any) => ({
  id: item.id || '-',
  name: item.name || item.id || '-',
  adapter: item.adapter_id || '-',
  family: item.family || '-',
  mode: item.access_mode || '-',
  sidecar: item.requires_sidecar ? 'required' : 'optional',
  snapshot: item.supports_snapshot ? 'yes' : 'no',
  incremental: item.supports_incremental ? 'yes' : 'no',
  schema: item.supports_schema_discovery ? 'yes' : 'no',
  runtime: item.runtime?.status || 'declared',
})));
const sourceRuntimeRows = computed(() => connectorSourceAdapters.value.map((item: any) => {
  const manifest = item.manifest || item;
  const runtime = item.runtime_state || item.state || {};
  return {
    adapter: manifest.adapter_id || item.adapter_id || runtime.adapter_id || '-',
    name: manifest.display_name || manifest.name || '-',
    family: manifest.family || '-',
    status: runtime.status || 'declared',
    watermarks: Array.isArray(runtime.watermarks) ? runtime.watermarks.length : 0,
    last_run: runtime.last_run_at_ms || '-',
    degraded: runtime.degraded_reason || runtime.last_error || '-',
  };
}));
const sourceWatermarkRows = computed(() => connectorSourceAdapters.value
  .flatMap((item: any) => {
    const runtime = item.runtime_state || item.state || {};
    return (Array.isArray(runtime.watermarks) ? runtime.watermarks : []).map((watermark: any) => ({
      adapter: watermark.adapter_id || runtime.adapter_id || '-',
      resource: watermark.resource_ref || '-',
      table: watermark.table || '-',
      strategy: watermark.strategy || '-',
      cursor: watermark.cursor || watermark.high_watermark || watermark.offset || '-',
      checksum: watermark.checksum || '-',
    }));
  }));
const sourceIncrementalWatermark = computed(() => {
  const adapter = sourceSnapshotAdapterId.value.trim() || 'csv';
  if (!sourceIncrementalCursor.value && !sourceIncrementalOffset.value) return undefined;
  return {
    adapter_id: adapter,
    resource_ref: sourceSnapshotResourceRef.value.trim(),
    table: sourceSnapshotTable.value.trim() || undefined,
    strategy: sourceIncrementalStrategy.value,
    cursor: sourceIncrementalCursor.value || undefined,
    offset: sourceIncrementalOffset.value || undefined,
    high_watermark: sourceIncrementalStrategy.value === 'updated_at_field' ? sourceIncrementalCursor.value || undefined : undefined,
    updated_at_ms: Date.now(),
  };
});
const sourceSnapshotReadPlan = computed(() => ({
  adapter_id: sourceSnapshotAdapterId.value.trim() || 'csv',
  resource_ref: sourceSnapshotResourceRef.value.trim(),
  table: sourceSnapshotTable.value.trim() || undefined,
  limit: Number(sourceSnapshotLimit.value) || 100,
  metadata: {
    source: 'webui-edge',
    intent: 'matrix-source-snapshot',
    updated_at_field: sourceUpdatedAtField.value || undefined,
    cursor_field: sourceCursorField.value || undefined,
  },
}));
const accountRows = computed(() => accounts.value.map((item: any) => ({
  provider: item.provider || item.provider_id || item.id,
  account: item.account_id || item.id || '-',
  status: item.status || (item.enabled === false ? 'disabled' : 'ready'),
  scopes: (item.scopes || item.enabled_bindings || []).join(', '),
})));
const capabilityRows = computed(() => capabilities.value.slice(0, 14).map((item: any) => ({
  id: item.id || item.capability_id || item.name,
  provider: item.provider || '-',
  risk: item.risk || item.risk_level || '-',
  mode: item.mode || item.access || '-',
})));
const resourceRows = computed(() => resources.value.slice(0, 14).map((item: any) => ({
  reference: item.reference || item.resource_ref || item.id,
  title: item.title || item.name || '-',
  kind: item.kind || item.mime || '-',
  status: item.status || '-',
})));
const executionRows = computed(() => executions.value.slice(0, 12).map((item: any) => ({
  id: item.execution_id || item.id,
  status: item.status || item.decision || '-',
  capability: item.requested_capability || item.capability || '-',
  provider: item.provider_account || item.provider || '-',
})));
const identityRows = computed(() => identities.value.slice(0, 12).map((item: any) => ({
  id: item.id,
  principal: item.principal_id,
  identity: item.identity_ref,
  trust: item.trust,
})));
const grantRows = computed(() => grants.value.slice(0, 12).map((item: any) => ({
  id: item.id,
  principal: item.principal_id,
  capability: item.capability,
  type: item.grant_type,
})));
const gatewayAlignmentRows = computed(() => [
  {
    lane: 'EdgeHost',
    owner: 'Gateway',
    backend: edgeHealth.value.status || 'unknown',
    webui: `${edgeRows.value.length} edges`,
    tui: 'surface unchanged',
    action: edgeRows.value.length ? 'monitor edge domains' : 'refresh /api/edges projection',
  },
  {
    lane: 'Connectors',
    owner: 'Gateway',
    backend: state.value.summary?.status || 'registry',
    webui: `${accounts.value.length} accounts / ${capabilities.value.length} capabilities`,
    tui: 'status and receipts',
    action: accounts.value.length ? 'manage grants' : 'configure connector accounts',
  },
  {
    lane: 'Resources',
    owner: 'Gateway -> Reality Core',
    backend: resources.value.length ? 'indexed' : 'empty',
    webui: `${resources.value.length} resources`,
    tui: 'evidence projection',
    action: resources.value.length ? 'revalidate or promote memory' : 'ingest connector resources',
  },
  {
    lane: 'Cross-plane',
    owner: 'Gateway policy gate',
    backend: state.value.crossPlane?.status || 'preflight',
    webui: `${identities.value.length} identities / ${grants.value.length} grants`,
    tui: 'approval cockpit',
    action: executions.value.length ? 'review execution evidence' : 'simulate policy before commit',
  },
]);
const gatewayAlignmentStatus = computed(() => {
  if (state.value.summary?.__state && state.value.summary.__state !== 'ready') return state.value.summary.__state;
  if (!accounts.value.length) return 'degraded';
  return 'ready';
});
const gatewayRemediationRows = computed(() => [
  {
    id: 'edge-host',
    lane: 'EdgeHost',
    severity: edgeRows.value.length ? 'ready' : 'degraded',
    problem: edgeRows.value.length ? 'Edge projection is visible.' : 'No Edge projection data is available.',
    evidence: `message=${edgeMessageConnectors.value.length}, source=${edgeSourceConnectors.value.length}, automation=${edgeAutomationConnectors.value.length}`,
    next_action: edgeRows.value.length ? 'Inspect connector manifests and source-adapter readiness.' : 'Verify /api/edges connector discovery.',
  },
  {
    id: 'connector-accounts',
    lane: 'Connector accounts',
    severity: accounts.value.length ? 'ready' : 'degraded',
    problem: accounts.value.length ? 'Connector accounts are configured.' : 'Connector account registry is empty.',
    evidence: `${accounts.value.length} accounts, ${capabilities.value.length} capabilities`,
    next_action: accounts.value.length ? 'Review grants before commit mode.' : 'Configure connector accounts or keep external surfaces disabled.',
  },
  {
    id: 'resources',
    lane: 'Resources',
    severity: resources.value.length ? 'ready' : 'degraded',
    problem: resources.value.length ? 'Connector resources are indexed.' : 'No connector resources are available for promotion.',
    evidence: `${resources.value.length} resources`,
    next_action: resources.value.length ? 'Revalidate selected resource before memory promotion.' : 'Run connector ingestion or verify adapter resources.',
  },
  {
    id: 'cross-plane-grants',
    lane: 'Cross-plane grants',
    severity: grants.value.length ? 'ready' : 'blocked',
    problem: grants.value.length ? 'Grant registry can authorize governed dispatch.' : 'No grants exist for cross-plane execution.',
    evidence: `${identities.value.length} identities, ${grants.value.length} grants`,
    next_action: grants.value.length ? 'Simulate policy before execute.' : 'Create identity and grant before commit execution.',
  },
  {
    id: 'executions',
    lane: 'Executions',
    severity: executions.value.length ? 'ready' : 'info',
    problem: executions.value.length ? 'Execution audit is available.' : 'No recent cross-plane execution evidence.',
    evidence: `${executions.value.length} executions`,
    next_action: executions.value.length ? 'Review execution receipts and audit evidence.' : 'Run dry-run execution to verify policy path.',
  },
]);
const connectorServiceRows = computed(() => connectorServices.value.slice(0, 10).map((item: any) => ({
  id: item.id,
  provider: item.provider || '-',
  family: item.family || '-',
  mode: item.read_only ? 'read-only' : 'service',
})));
const connectorServiceToolRows = computed(() => {
  const tools = state.value.connectorServiceTools?.tools || state.value.connectorServiceTools?.items || [];
  return Array.isArray(tools) ? tools.slice(0, 10).map((item: any) => ({
    id: item.capability_id || item.id || item.tool || '-',
    family: item.family || '-',
    risk: item.risk || '-',
    mode: item.supports_commit ? 'commit' : 'dry-run',
  })) : [];
});
const gatewayEvidence = computed(() => [
  ...executionRows.value.slice(0, 3).map((row) => ({
    id: String(row.id || ''),
    kind: 'cross-plane execution',
    status: String(row.status || 'recorded'),
    summary: `${row.capability || 'capability'} via ${row.provider || 'provider'}`,
    source: 'gateway.cross-plane',
  })),
  ...resourceRows.value.slice(0, 2).map((row) => ({
    id: String(row.reference || ''),
    kind: 'connector resource',
    status: String(row.status || 'indexed'),
    summary: String(row.title || row.reference || 'resource'),
    source: 'gateway.connector',
  })),
]);
const resourceGovernanceContract = computed(() => ({
  id: 'gateway.resource.memory-promotion',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.7985293dee'),
  endpoint: '/api/connectors/resources/promote-memory',
  method: 'POST',
  summary: t('script.pages.gatewaypage.summary.6a293743f8'),
  current_return: t('script.pages.gatewaypage.current_return.63f3f441d2'),
  validate: '/api/connectors/resources/revalidate',
  plan: '/api/connectors/resources/revalidate',
  dry_run: '/api/connectors/resources/revalidate',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.0be653fa14'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.ec0b646fc5'),
  affected_refs: resourceRef.value ? [resourceRef.value] : [],
}));
const crossPlaneExecuteContract = computed(() => ({
  id: 'gateway.cross-plane.execute',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.55633ae2ab'),
  endpoint: '/api/cross-plane/action/execute',
  method: 'POST',
  summary: t('script.pages.gatewaypage.summary.43fcdcb696'),
  current_return: t('script.pages.gatewaypage.current_return.86a5e061e1'),
  validate: '/api/cross-plane/policy/simulate',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.0c3dd8430c'),
  receipt: true,
  audit_ref: true,
  changed_refs: false,
  approval_required: true,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.10cc5d2b8b'),
  affected_refs: [resourceRef.value, capability.value, identityRef.value].filter(Boolean),
}));
const identityGovernanceContract = computed(() => ({
  id: 'gateway.cross-plane.identity',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.c1aeadb2b5'),
  endpoint: '/api/cross-plane/identities',
  method: 'POST',
  summary: t('script.pages.gatewaypage.summary.90da051361'),
  current_return: t('script.pages.gatewaypage.current_return.939ff3a655'),
  validate: '/api/cross-plane/identity/resolve',
  plan: '/api/cross-plane/identity/resolve',
  dry_run: '/api/cross-plane/identity/resolve',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.54bdfdd748'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.05108df5a6'),
  affected_refs: [identityRef.value, actor.value].filter(Boolean),
}));
const grantGovernanceContract = computed(() => ({
  id: 'gateway.cross-plane.grant',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.e54a6bb605'),
  endpoint: '/api/cross-plane/grants',
  method: 'POST',
  summary: t('script.pages.gatewaypage.summary.623089ae79'),
  current_return: t('script.pages.gatewaypage.current_return.b04f8219e1'),
  validate: '/api/cross-plane/action/preflight',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.c48167a782'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.723b7125e8'),
  affected_refs: [capability.value, resourceRef.value, actor.value].filter(Boolean),
}));
const identityRevokeContract = computed(() => ({
  id: 'gateway.cross-plane.identity.revoke',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.d45e9af88b'),
  endpoint: '/api/cross-plane/identities/:id',
  method: 'DELETE',
  summary: t('script.pages.gatewaypage.summary.df056b14ee'),
  current_return: t('script.pages.gatewaypage.current_return.c9321abf5f'),
  validate: '/api/cross-plane/identity/resolve',
  plan: '/api/cross-plane/identity/resolve',
  dry_run: '/api/cross-plane/identity/resolve',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.a0ecbacdb6'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.05108df5a6'),
  affected_refs: [identityId.value, identityRef.value].filter(Boolean),
}));
const grantRevokeContract = computed(() => ({
  id: 'gateway.cross-plane.grant.revoke',
  domain: 'gateway',
  title: t('script.pages.gatewaypage.title.2e8f565125'),
  endpoint: '/api/cross-plane/grants/:id',
  method: 'DELETE',
  summary: t('script.pages.gatewaypage.summary.339201a1f8'),
  current_return: t('script.pages.gatewaypage.current_return.0f7925b4c6'),
  validate: '/api/cross-plane/action/preflight',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: t('script.pages.gatewaypage.live_policy.a855eba479'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.gatewaypage.kernel_boundary.723b7125e8'),
  affected_refs: [grantId.value, capability.value].filter(Boolean),
}));

function crossPlaneAction() {
  return {
    actor_principal: actor.value,
    actor_identity_ref: identityRef.value || null,
    source_channel: 'channel://webui/local',
    session_id: 'webui-gateway',
    requested_capability: capability.value,
    provider_account: accounts.value[0]?.account_id || accounts.value[0]?.id || 'webui-local',
    target_ref: null,
    resource_ref: resourceRef.value || null,
    risk: 'medium',
    data_classification: 'internal',
    identity_trust: 'unknown',
  };
}

function defaultEdgeSourcePack() {
  return {
    source_pack_id: sourceSnapshotPackId.value,
    source_name: 'webui_edge_supply',
    owner: 'webui',
    access_mode: 'file',
    refresh_mode: 'snapshot',
    entity_mappings: [
      {
        source_entity: 'supplier',
        matrix_entity_type: 'supplier',
        source_key_field: 'supplier_id',
      },
      {
        source_entity: 'part',
        matrix_entity_type: 'part',
        source_key_field: 'part_id',
      },
    ],
    fact_mappings: [{
      source_table: sourceSnapshotTable.value.trim() || 'orders',
      fact_type: 'supply.order',
      metric_key: 'supply_qty',
      entity_ref_fields: ['supplier_id', 'part_id'],
      measure_fields: ['qty'],
      event_time_field: 'event_time',
      dedup_key: 'order_id',
      delta_signature: 'order_id',
    }],
    relation_mappings: [{
      source_table: sourceSnapshotTable.value.trim() || 'orders',
      relation_type: 'supplies',
      from_source_key_field: 'supplier_id',
      to_source_key_field: 'part_id',
      attribute_fields: ['qty'],
      dedup_key: 'order_id',
    }],
    reconciliation_rules: ['source_snapshot_is_idempotent'],
    quality_rules: ['dedup_key_required'],
    metadata: {
      source: 'webui-edge',
      edge_domain: 'source-connector',
    },
  };
}

function parseSourceSnapshotRows() {
  const parsed = JSON.parse(sourceSnapshotRowsText.value || '[]');
  if (!Array.isArray(parsed)) throw new Error(t('edge.snapshot.rowsInvalid'));
  return parsed;
}

async function upsertEdgeSourcePack() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.matrixSourcePackUpsert(defaultEdgeSourcePack());
  selectedDetail.value = sourceSnapshotResult.value;
}

async function planEdgeSourceSnapshot() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.matrixSourceSnapshotPlan(sourceSnapshotPackId.value, {
    resource_ref: sourceSnapshotResourceRef.value,
    estimated_rows: Number(sourceSnapshotLimit.value) || undefined,
  });
  selectedDetail.value = sourceSnapshotResult.value;
}

async function runEdgeSourceSnapshotRows() {
  sourceSnapshotError.value = '';
  try {
    const rows = parseSourceSnapshotRows();
    sourceSnapshotResult.value = await api.matrixSourceSnapshotRun(sourceSnapshotPackId.value, {
      snapshot: {
        source_system: 'webui_edge_supply',
        source_kind: 'file',
        resource_ref: sourceSnapshotResourceRef.value,
        schema_version: `source:${sourceSnapshotAdapterId.value || 'webui'}:${sourceSnapshotTable.value || 'orders'}`,
        row_count: rows.length,
        confidence: 0.95,
        metadata: {
          source: 'webui-edge',
          mode: 'direct_rows',
        },
      },
      rows,
    });
    selectedDetail.value = sourceSnapshotResult.value;
  } catch (err) {
    sourceSnapshotError.value = err instanceof Error ? err.message : String(err);
  }
}

async function runEdgeSourceSnapshotReadPlan() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.matrixSourceSnapshotRun(sourceSnapshotPackId.value, {
    source_read_plan: sourceSnapshotReadPlan.value,
  });
  selectedDetail.value = sourceSnapshotResult.value;
}

async function runEdgeSourceIncremental() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.connectorSourceRunIncremental(sourceSnapshotAdapterId.value.trim() || 'csv', {
    resource_ref: sourceSnapshotResourceRef.value.trim(),
    table: sourceSnapshotTable.value.trim() || undefined,
    limit: Number(sourceSnapshotLimit.value) || 100,
    watermark: sourceIncrementalWatermark.value,
    metadata: {
      source: 'webui-edge',
      strategy: sourceIncrementalStrategy.value,
      updated_at_field: sourceUpdatedAtField.value || undefined,
      cursor_field: sourceCursorField.value || undefined,
      rows: sourceSnapshotAdapterId.value.trim() === 'csv' ? undefined : undefined,
    },
  });
  selectedDetail.value = sourceSnapshotResult.value;
  await refresh();
}

async function pollEdgeSourceEvents() {
  sourceSnapshotError.value = '';
  let events: unknown[] = [];
  try {
    const parsed = JSON.parse(sourceEventText.value || '[]');
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    sourceSnapshotError.value = err instanceof Error ? err.message : String(err);
    return;
  }
  sourceSnapshotResult.value = await api.connectorSourcePollEvents(sourceSnapshotAdapterId.value.trim() || 'feishu_bitable', { events });
  selectedDetail.value = sourceSnapshotResult.value;
}

async function loadEdgeSourceSnapshots() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.matrixSourceSnapshots(sourceSnapshotPackId.value);
  selectedDetail.value = sourceSnapshotResult.value;
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [platforms, platformDetail, summary, nextAccounts, nextCapabilities, nextResources, mcp, servicesData, connectorSources, edge, crossPlane, identitiesData, grantsData, audit, adapters, nextExecutions, configReload, capabilityContractData, openApi, openAiToolsData] = await Promise.all([
      api.platforms(),
      api.platform(platformName.value),
      api.connectorsSummary(),
      api.connectorAccounts(),
      api.connectorCapabilities(),
      api.connectorResources(),
      api.connectorMcpServers(),
      api.connectorServices(),
      api.connectorSources(),
      api.edgeRegistry(),
      api.crossPlaneSummary(),
      api.crossPlaneIdentities(),
      api.crossPlaneGrants(),
      api.crossPlaneAudit(),
      api.crossPlaneAdapters(),
      api.crossPlaneExecutions(),
      api.configReloadStatus(),
      api.gatewayCapabilityContract(),
      api.gatewayOpenApi(),
      api.gatewayOpenAiTools(),
    ]);
    const services = Array.isArray(servicesData?.services) ? servicesData.services : [];
    const nextServiceId = connectorServiceId.value || services[0]?.id || '';
    const serviceTools = nextServiceId ? await api.connectorServiceTools(nextServiceId) : { tools: [] };
    state.value = { platforms, platformDetail, summary, accounts: nextAccounts, capabilities: nextCapabilities, resources: nextResources, mcp, connectorServices: servicesData, connectorSources, connectorServiceTools: serviceTools, edge, crossPlane, identities: identitiesData, grants: grantsData, audit, adapters, executions: nextExecutions, configReload, capabilityContract: capabilityContractData, openApi, openAiTools: openAiToolsData };
    connectorServiceId.value = nextServiceId;
    const tools = Array.isArray(serviceTools?.tools) ? serviceTools.tools : [];
    connectorServiceToolId.value = connectorServiceToolId.value || tools[0]?.capability_id || '';
    if (!resourceRef.value) {
      resourceRef.value = resources.value[0]?.reference || resources.value[0]?.resource_ref || '';
    }
    identityId.value = identityId.value || identities.value[0]?.id || '';
    grantId.value = grantId.value || grants.value[0]?.id || '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadPlatform() {
  state.value = { ...(state.value || {}), platformDetail: await api.platform(platformName.value) };
}

async function startWechatQr() {
  actionResult.value = await api.wechatIlinkQrStart(wechatBotType.value);
  wechatQrCode.value = actionResult.value?.data?.qrcode || actionResult.value?.data?.qr_code || wechatQrCode.value;
}

async function pollWechatQr() {
  if (!wechatQrCode.value) return;
  actionResult.value = await api.wechatIlinkQrPoll(wechatQrCode.value, location.origin);
}

async function loadConnectorServiceTools() {
  if (!connectorServiceId.value) return;
  const serviceTools = await api.connectorServiceTools(connectorServiceId.value);
  state.value = { ...(state.value || {}), connectorServiceTools: serviceTools };
  const tools = Array.isArray(serviceTools?.tools) ? serviceTools.tools : [];
  connectorServiceToolId.value = tools[0]?.capability_id || connectorServiceToolId.value;
}

async function executeConnectorServiceTool() {
  if (!connectorServiceId.value || !connectorServiceToolId.value) return;
  const resourceId = (resourceRef.value || 'webui-doc').split('/').filter(Boolean).pop() || 'webui-doc';
  actionResult.value = await api.connectorServiceExecute(connectorServiceId.value, {
    actor_principal: actor.value,
    actor_identity_ref: identityRef.value || null,
    source_channel: 'channel://webui/local',
    session_id: 'webui-gateway',
    tool_id: connectorServiceToolId.value,
    resource_id: resourceId,
    title: t('script.pages.gatewaypage.title.d8117c19e6'),
    mode: executeMode.value,
    idempotency_key: idempotencyKey.value || undefined,
  });
}

async function revalidateResource() {
  if (!resourceRef.value) return;
  actionResult.value = await api.connectorRevalidateResource(resourceRef.value);
  await refresh();
}

async function promoteResourceMemory() {
  if (!resourceRef.value) return;
  actionResult.value = await api.connectorPromoteMemory(resourceRef.value);
  await refresh();
}

async function runPreflight() {
  actionResult.value = await api.crossPlanePreflight(crossPlaneAction());
  await refresh();
}

async function simulatePolicy() {
  actionResult.value = await api.crossPlanePolicySimulate(crossPlaneAction());
  await refresh();
}

async function executeCrossPlaneAction() {
  actionResult.value = await api.crossPlaneExecute(crossPlaneAction(), executeMode.value, idempotencyKey.value || undefined);
  await refresh();
}

async function createIdentity() {
  const body = {
    id: identityId.value || `idb-webui-${Date.now()}`,
    principal_id: actor.value,
    identity_ref: identityRef.value,
    trust: 'verified',
    source: 'webui',
    created_at: new Date().toISOString(),
    expires_at: null,
  };
  actionResult.value = await api.crossPlaneCreateIdentity(body);
  identityId.value = actionResult.value?.data?.identity?.id || actionResult.value?.identity?.id || identityId.value;
  await refresh();
}

async function revokeIdentity() {
  if (!identityId.value) return;
  actionResult.value = await api.crossPlaneRevokeIdentity(identityId.value);
  identityId.value = '';
  await refresh();
}

async function resolveIdentity() {
  actionResult.value = await api.crossPlaneResolveIdentity(identityRef.value);
  await refresh();
}

async function createGrant() {
  const body = {
    id: grantId.value || `grant-webui-${Date.now()}`,
    principal_id: actor.value,
    capability: capability.value,
    account_id: accounts.value[0]?.account_id || accounts.value[0]?.id || null,
    target_ref: null,
    resource_ref: resourceRef.value || null,
    source_channel: 'channel://webui/local',
    grant_type: 'persistent',
    expires_at: null,
    remaining_uses: null,
    created_by: 'webui',
    approval_id: null,
  };
  actionResult.value = await api.crossPlaneCreateGrant(body);
  grantId.value = actionResult.value?.data?.grant?.id || actionResult.value?.grant?.id || grantId.value;
  await refresh();
}

async function revokeGrant() {
  if (!grantId.value) return;
  actionResult.value = await api.crossPlaneRevokeGrant(grantId.value);
  grantId.value = '';
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page gateway-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.gateway.page.text.3545d93ed9') }}</h1>
        <p>{{ t('page.gateway.page.text.0c015c80ce') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.gateway.page.inline.eac49d64ff') : t('page.gateway.page.inline.e8f3da1a82') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row">
      <article class="metric-card">
        <span>{{ t('page.gateway.page.text.614b9c3c15') }}</span>
        <strong>{{ accounts.length }}</strong>
        <small>{{ displayStatus(state.summary?.status || 'unknown') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.gateway.page.text.93f1af14ce') }}</span>
        <strong>{{ capabilities.length }}</strong>
        <small>{{ formatCount('resources', resources.length) }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.gateway.page.text.e437a47858') }}</span>
        <strong>{{ executions.length }}</strong>
        <small>{{ t('page.gateway.page.text.7fe818b5cc') }}</small>
      </article>
      <article class="metric-card" :data-tone="configReloadStatus.restart_required?.required ? 'warn' : (configReloadStatus.status === 'invalid' ? 'danger' : 'success')">
        <span>{{ t('config.reload.label') }}</span>
        <strong>{{ configReloadStatus.status || 'unknown' }}</strong>
        <small>{{ configReloadStatus.restart_required?.required ? configReloadRestartFields : (configReloadStatus.trigger || 'auto') }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('edge.gateway.title') }}</h2>
          <StatusPill :status="edgeHealth.status || 'unknown'" />
        </header>
        <p>{{ t('edge.gateway.detail') }}</p>
        <DataTable v-if="edgeRows.length" searchable copyable row-key="id" :rows="edgeRows" :columns="['domain', 'id', 'name', 'status', 'lifecycle', 'capabilities', 'routes', 'resources', 'source']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.empty.title')" :detail="t('edge.empty.detail')" />
        <ObjectInspectorDrawer :title="t('edge.gateway.raw')" :data="edgeHealth || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="alignment">
        <header>
          <h2>{{ t('page.gateway.page.text.3aaa20c63d') }}</h2>
          <StatusPill :status="gatewayAlignmentStatus" />
        </header>
        <p>{{ t('page.gateway.page.text.5a99daa9a9') }}</p>
        <DataTable searchable copyable row-key="lane" :rows="gatewayAlignmentRows" :columns="['lane', 'owner', 'backend', 'webui', 'tui', 'action']" @row-click="selectedDetail = $event" />
        <GatewayRemediationList :rows="gatewayRemediationRows" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="alignment">
        <header>
          <h2>{{ t('page.gateway.contract.title') }}</h2>
          <StatusPill :status="capabilityContract.__state && capabilityContract.__state !== 'ready' ? capabilityContract.__state : (capabilityCoverage.route_contract_parity ? 'ready' : 'degraded')" />
        </header>
        <p>{{ t('page.gateway.contract.detail') }}</p>
        <section class="metric-row compact">
          <article v-for="row in contractOverviewRows" :key="row.label" class="metric-card">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </article>
        </section>
        <DataTable v-if="gatewayContractRows.length" searchable copyable row-key="id" :rows="gatewayContractRows" :columns="['domain', 'method', 'path', 'risk', 'visible']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.contract.empty')" :detail="t('page.gateway.contract.emptyDetail')" />
        <DataTable v-if="openAiToolRows.length" searchable copyable row-key="name" :rows="openAiToolRows" :columns="['name', 'description', 'parameters']" @row-click="selectedDetail = $event" />
        <ObjectInspectorDrawer :title="t('page.gateway.contract.raw')" :data="{ contract: capabilityContract, openapi: { openapi: openApiDocument.openapi, path_count: openApiPathCount }, openai_tools: openAiTools }" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.df4bfe6273') }}</h2>
          <StatusPill :status="state.summary?.__state || 'ready'" />
        </header>
        <DataTable v-if="accountRows.length" searchable copyable :rows="accountRows" :columns="['provider', 'account', 'status', 'scopes']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.bed97233b0')" :detail="t('page.gateway.page.detail.51394d64f1')" />
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.a0df395cfc')" :data="state.platforms || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('edge.connectors.title') }}</h2>
          <StatusPill :status="edgeMessageConnectors.length || edgeSourceConnectors.length ? 'ready' : 'degraded'" />
        </header>
        <p>{{ t('edge.connectors.detail') }}</p>
        <DataTable v-if="messageConnectorRows.length" searchable copyable row-key="id" :rows="messageConnectorRows" :columns="['id', 'name', 'status', 'capabilities', 'entry', 'diagnostics']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.message.empty.title')" :detail="t('edge.message.empty.detail')" />
        <DataTable v-if="sourceConnectorRows.length" searchable copyable row-key="id" :rows="sourceConnectorRows" :columns="['id', 'name', 'adapter', 'family', 'mode', 'sidecar', 'snapshot', 'incremental', 'schema', 'runtime']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.source.empty.title')" :detail="t('edge.source.empty.detail')" />
        <DataTable v-if="sourceRuntimeRows.length" searchable copyable row-key="adapter" :rows="sourceRuntimeRows" :columns="['adapter', 'name', 'family', 'status', 'watermarks', 'last_run', 'degraded']" @row-click="selectedDetail = $event" />
        <DataTable v-if="sourceWatermarkRows.length" searchable copyable row-key="resource" :rows="sourceWatermarkRows" :columns="['adapter', 'resource', 'table', 'strategy', 'cursor', 'checksum']" @row-click="selectedDetail = $event" />
        <ObjectInspectorDrawer :title="t('edge.connectors.raw')" :data="{ message_connectors: edgeMessageConnectors, source_connectors: edgeSourceConnectors, source_runtime: state.connectorSources, automation_connectors: edgeAutomationConnectors }" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('edge.snapshot.title') }}</h2>
          <span>/api/matrix/source-packs/:id/snapshots/run</span>
        </header>
        <p>{{ t('edge.snapshot.detail') }}</p>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('edge.snapshot.field.sourcePack') }}
            <input v-model="sourceSnapshotPackId" type="text" />
          </label>
          <label class="field-line">
            {{ t('edge.snapshot.field.adapter') }}
            <input v-model="sourceSnapshotAdapterId" type="text" list="edge-source-adapters" />
            <datalist id="edge-source-adapters">
              <option v-for="connector in edgeSourceConnectors" :key="connector.adapter_id || connector.id" :value="connector.adapter_id || connector.id" />
              <option value="csv" />
              <option value="jsonl" />
              <option value="sqlite" />
              <option value="feishu_bitable" />
              <option value="lark_bitable" />
            </datalist>
          </label>
        </div>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('edge.snapshot.field.resource') }}
            <input v-model="sourceSnapshotResourceRef" type="text" />
          </label>
          <label class="field-line">
            {{ t('edge.snapshot.field.table') }}
            <input v-model="sourceSnapshotTable" type="text" />
          </label>
          <label class="field-line">
            {{ t('edge.snapshot.field.limit') }}
            <input v-model.number="sourceSnapshotLimit" type="number" min="1" max="1000" />
          </label>
        </div>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('edge.source.incremental.strategy') }}
            <select v-model="sourceIncrementalStrategy">
              <option value="offset">offset</option>
              <option value="updated_at_field">updated_at_field</option>
              <option value="cursor_field">cursor_field</option>
            </select>
          </label>
          <label class="field-line">
            {{ t('edge.source.incremental.cursor') }}
            <input v-model="sourceIncrementalCursor" type="text" />
          </label>
          <label class="field-line">
            {{ t('edge.source.incremental.offset') }}
            <input v-model.number="sourceIncrementalOffset" type="number" min="0" />
          </label>
        </div>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('edge.source.incremental.updatedAtField') }}
            <input v-model="sourceUpdatedAtField" type="text" placeholder="updated_at" />
          </label>
          <label class="field-line">
            {{ t('edge.source.incremental.cursorField') }}
            <input v-model="sourceCursorField" type="text" placeholder="id" />
          </label>
        </div>
        <label class="field-line">
          {{ t('edge.snapshot.field.rows') }}
          <textarea v-model="sourceSnapshotRowsText" rows="6" />
        </label>
        <label class="field-line">
          {{ t('edge.source.event.fixture') }}
          <textarea v-model="sourceEventText" rows="5" />
        </label>
        <p v-if="sourceSnapshotError" class="field-error">{{ sourceSnapshotError }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="upsertEdgeSourcePack">{{ t('edge.snapshot.action.seed') }}</button>
          <button class="ghost-action" type="button" @click="planEdgeSourceSnapshot">{{ t('edge.snapshot.action.plan') }}</button>
          <button class="primary-action" type="button" @click="runEdgeSourceSnapshotRows">{{ t('edge.snapshot.action.runRows') }}</button>
          <button class="ghost-action" type="button" @click="runEdgeSourceSnapshotReadPlan">{{ t('edge.snapshot.action.runReadPlan') }}</button>
          <button class="primary-action" type="button" @click="runEdgeSourceIncremental">{{ t('edge.source.incremental.run') }}</button>
          <button class="ghost-action" type="button" @click="pollEdgeSourceEvents">{{ t('edge.source.event.poll') }}</button>
          <button class="ghost-action" type="button" @click="loadEdgeSourceSnapshots">{{ t('edge.snapshot.action.list') }}</button>
        </div>
        <RequestReceipt :receipt="sourceSnapshotResult" :title="t('edge.snapshot.receipt')" />
        <ObjectInspectorDrawer :title="t('edge.snapshot.readPlan')" :data="sourceSnapshotReadPlan" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.715580f4cf') }}</h2>
          <span>{{ platformName }}</span>
        </header>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('template.pages.gatewaypage.123a7f2fcc') }}
            <input v-model="platformName" type="text" />
          </label>
          <label class="field-line">
            {{ t('template.pages.gatewaypage.88fbc4477f') }}
            <input v-model="wechatBotType" type="text" />
          </label>
        </div>
        <label class="field-line">
          {{ t('template.pages.gatewaypage.88c0393033') }}
          <input v-model="wechatQrCode" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="loadPlatform">{{ t('page.gateway.page.text.997144189c') }}</button>
          <button class="ghost-action" type="button" @click="startWechatQr">{{ t('page.gateway.page.text.5b05d63e12') }}</button>
          <button class="ghost-action" type="button" :disabled="!wechatQrCode" @click="pollWechatQr">{{ t('page.gateway.page.text.45ad9b8b7f') }}</button>
        </div>
        <DataTable v-if="connectorServiceRows.length" searchable copyable row-key="id" :rows="connectorServiceRows" :columns="['id', 'provider', 'family', 'mode']" @row-click="selectedDetail = $event" />
        <label class="field-line">
          {{ t('page.gateway.field.connectorService') }}
          <input v-model="connectorServiceId" type="text" />
        </label>
        <button class="ghost-action" type="button" :disabled="!connectorServiceId" @click="loadConnectorServiceTools">{{ t('page.gateway.page.text.63dce7d3eb') }}</button>
        <DataTable v-if="connectorServiceToolRows.length" searchable copyable row-key="id" :rows="connectorServiceToolRows" :columns="['id', 'family', 'risk', 'mode']" @row-click="selectedDetail = $event" />
        <label class="field-line">
          {{ t('page.gateway.field.serviceTool') }}
          <input v-model="connectorServiceToolId" type="text" />
        </label>
        <button class="ghost-action" type="button" :disabled="!connectorServiceId || !connectorServiceToolId" @click="executeConnectorServiceTool">{{ t('page.gateway.page.text.c0e6cf81d6') }}</button>
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.83dadbfefc')" />
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.f8bba99b1e')" :data="{ platform: state.platformDetail, connectorServices: state.connectorServices, connectorServiceTools: state.connectorServiceTools }" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.b4e80b5466') }}</h2>
          <span>{{ t('common.shownCount', { count: capabilityRows.length, unit: t('unit.capabilities') }) }}</span>
        </header>
        <DataTable v-if="capabilityRows.length" searchable copyable row-key="id" :rows="capabilityRows" :columns="['id', 'provider', 'risk', 'mode']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.e6acca3a2d')" :detail="t('page.gateway.page.detail.662c9ed56d')" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.cd60e278cf') }}</h2>
          <span>{{ formatCount('servers', mcpServers.length) }}</span>
        </header>
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.c593f2c735')" :data="state.mcp || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="resources">
        <header>
          <h2>{{ t('page.gateway.page.text.d3bc27eaea') }}</h2>
          <span>{{ formatCount('resources', resources.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.gateway.field.resourceRef') }}
          <input v-model="resourceRef" type="text" />
        </label>
        <GovernedActionPanel
          :contract="resourceGovernanceContract"
          :payload="{ resource_ref: resourceRef }"
          :receipt="actionResult"
          @plan="revalidateResource"
          @dry-run="revalidateResource"
          @live="promoteResourceMemory"
        />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.1355cb4c75')" />
        <DataTable v-if="resourceRows.length" searchable copyable row-key="reference" :rows="resourceRows" :columns="['reference', 'title', 'kind', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.e0f40327a7')" :detail="t('page.gateway.page.detail.fe442047a7')" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>{{ t('page.gateway.page.text.edae12bca9') }}</h2>
          <span>{{ displayStatus(state.crossPlane?.status || 'preflight') }}</span>
        </header>
        <label class="field-line">
          {{ t('page.tools.field.actor') }}
          <input v-model="actor" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.tools.field.capability') }}
          <input v-model="capability" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.gateway.field.identityRef') }}
          <input v-model="identityRef" type="text" />
        </label>
        <GovernedActionPanel
          :contract="crossPlaneExecuteContract"
          :payload="{ action: crossPlaneAction(), mode: executeMode, idempotency_key: idempotencyKey || undefined }"
          :receipt="actionResult"
          @plan="runPreflight"
          @dry-run="simulatePolicy"
          @live="executeCrossPlaneAction"
        />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.280dcfc888')" />
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.023d50a0fe')" :data="state.crossPlane || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="identities">
        <header>
          <h2>{{ t('page.gateway.page.text.1a7b03d75e') }}</h2>
          <span>{{ formatCount('identities', identities.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.gateway.field.identityBindingId') }}
          <input v-model="identityId" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="resolveIdentity">{{ t('page.gateway.page.text.3a3008153e') }}</button>
        </div>
        <GovernedActionPanel
          :contract="identityGovernanceContract"
          :payload="{ id: identityId, principal_id: actor, identity_ref: identityRef, trust: 'verified' }"
          :receipt="actionResult"
          @plan="resolveIdentity"
          @dry-run="resolveIdentity"
          @live="createIdentity"
        />
        <GovernedActionPanel
          :contract="identityRevokeContract"
          :payload="{ id: identityId, identity_ref: identityRef }"
          :receipt="actionResult"
          @plan="resolveIdentity"
          @dry-run="resolveIdentity"
          @live="revokeIdentity"
        />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.5951c14fea')" />
        <DataTable v-if="identityRows.length" searchable copyable row-key="id" :rows="identityRows" :columns="['id', 'principal', 'identity', 'trust']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.ade00e463b')" :detail="t('page.gateway.page.detail.deb867b228')" />
        <label class="field-line">
          {{ t('page.gateway.field.grantId') }}
          <input v-model="grantId" type="text" />
        </label>
        <GovernedActionPanel
          :contract="grantGovernanceContract"
          :payload="{ id: grantId, principal_id: actor, capability, resource_ref: resourceRef || null }"
          :receipt="actionResult"
          @plan="runPreflight"
          @dry-run="simulatePolicy"
          @live="createGrant"
        />
        <GovernedActionPanel
          :contract="grantRevokeContract"
          :payload="{ id: grantId, capability, resource_ref: resourceRef || null }"
          :receipt="actionResult"
          @plan="runPreflight"
          @dry-run="simulatePolicy"
          @live="revokeGrant"
        />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.008a7b6909')" />
        <DataTable v-if="grantRows.length" searchable copyable row-key="id" :rows="grantRows" :columns="['id', 'principal', 'capability', 'type']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.aca4aa4ff7')" :detail="t('page.gateway.page.detail.f58a29a773')" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>{{ t('page.gateway.page.text.92c5112468') }}</h2>
          <span>{{ executeMode }}</span>
        </header>
        <label class="field-line">
          {{ t('page.gateway.field.mode') }}
          <select v-model="executeMode">
            <option value="dry_run">{{ t('executionMode.dryRun') }}</option>
            <option value="commit">{{ t('executionMode.commit') }}</option>
          </select>
        </label>
        <label class="field-line">
          {{ t('page.gateway.field.idempotencyKey') }}
          <input v-model="idempotencyKey" type="text" :placeholder="t('page.gateway.page.placeholder.7915771597')" />
        </label>
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.1a70dec206')" />
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.178eed6c71')" :data="actionResult || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>{{ t('page.gateway.page.text.0cef581c98') }}</h2>
          <span>{{ formatCount('executions', executionRows.length) }}</span>
        </header>
        <DataTable v-if="executionRows.length" searchable copyable row-key="id" :rows="executionRows" :columns="['id', 'status', 'capability', 'provider']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.746b965ff4')" :detail="t('page.gateway.page.detail.10a566c783')" />
        <EvidenceTrace :items="gatewayEvidence" :title="t('page.gateway.page.title.abd0756c8f')" />
        <DetailDrawer :title="t('page.gateway.page.title.402c21482a')" :row="selectedDetail" @close="selectedDetail = null" />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.21964d7bc6')" />
        <ObjectInspectorDrawer :title="t('page.gateway.page.title.18f4a5d2d9')" :data="actionResult || state.audit || {}" />
      </section>
    </section>
  </section>
</template>
