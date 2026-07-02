<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { Network, RefreshCw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import GatewayRemediationList from '../components/workbench/GatewayRemediationList.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
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
const resources = computed(() => Array.isArray(state.value.resources?.resources) ? state.value.resources.resources : Array.isArray(state.value.resources?.items) ? state.value.resources.items : []);
const mcpServers = computed(() => Array.isArray(state.value.mcp?.servers) ? state.value.mcp.servers : []);
const connectorServices = computed(() => Array.isArray(state.value.connectorServices?.services) ? state.value.connectorServices.services : []);
const surfaces = computed(() => Array.isArray(state.value.surfaces?.registry?.surfaces) ? state.value.surfaces.registry.surfaces : []);
const surfaceHost = computed(() => state.value.surfaceHealth?.host || state.value.surfaceHealth || {});
const surfaceRuntime = computed(() => Array.isArray(state.value.surfaceHealth?.runtime) ? state.value.surfaceHealth.runtime : []);
const edgeRegistry = computed(() => state.value.edge || {});
const edgeHealth = computed(() => edgeRegistry.value.health || state.value.edgeHealth?.health || {});
const edgeSurfaces = computed(() => Array.isArray(edgeRegistry.value.surfaces) ? edgeRegistry.value.surfaces : []);
const edgeMessageConnectors = computed(() => Array.isArray(edgeRegistry.value.message_connectors) ? edgeRegistry.value.message_connectors : []);
const edgeSourceConnectors = computed(() => Array.isArray(edgeRegistry.value.source_connectors) ? edgeRegistry.value.source_connectors : []);
const edgeAutomationConnectors = computed(() => Array.isArray(edgeRegistry.value.automation_connectors) ? edgeRegistry.value.automation_connectors : []);
const channels = computed(() => Array.isArray(state.value.channels?.channels) ? state.value.channels.channels : []);
const executions = computed(() => Array.isArray(state.value.executions?.executions) ? state.value.executions.executions : []);
const identities = computed(() => Array.isArray(state.value.identities?.identities) ? state.value.identities.identities : []);
const grants = computed(() => Array.isArray(state.value.grants?.grants) ? state.value.grants.grants : []);
const edgeRows = computed(() => [
  ...edgeSurfaces.value.map((item: any) => ({ ...item, edge_type: 'surface' })),
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
const sourceSnapshotReadPlan = computed(() => ({
  adapter_id: sourceSnapshotAdapterId.value.trim() || 'csv',
  resource_ref: sourceSnapshotResourceRef.value.trim(),
  table: sourceSnapshotTable.value.trim() || undefined,
  limit: Number(sourceSnapshotLimit.value) || 100,
  metadata: {
    source: 'webui-edge',
    intent: 'matrix-source-snapshot',
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
const surfaceRows = computed(() => surfaces.value.slice(0, 12).map((item: any) => ({
  runtime: surfaceRuntime.value.find((runtime: any) => runtime.surface === item.id)?.status || item.status || '-',
  id: item.id,
  name: item.name || item.id || '-',
  kind: item.kind || '-',
  lifecycle: item.lifecycle || '-',
  failures: surfaceRuntime.value.find((runtime: any) => runtime.surface === item.id)?.consecutive_failures ?? 0,
  restarts: surfaceRuntime.value.find((runtime: any) => runtime.surface === item.id)?.restart_count ?? 0,
  circuit: surfaceRuntime.value.find((runtime: any) => runtime.surface === item.id)?.circuit_open ? 'open' : 'closed',
  routes: Array.isArray(item.routes) ? item.routes.length : Number(item.routes || 0),
  resources: Array.isArray(item.resources) ? item.resources.length : Number(item.resources || 0),
})));
const channelRows = computed(() => channels.value.slice(0, 12).map((item: any) => ({
  channel: item.channel || item.name || '-',
  config: item.configuration_status || '-',
  runtime: item.runtime?.status || 'not-attached',
  enabled: item.enabled === false ? 'no' : 'yes',
  credential: item.credential_present ? 'present' : 'missing',
  failures: item.runtime?.consecutive_failures ?? 0,
  restarts: item.runtime?.restart_count ?? 0,
  circuit: item.runtime?.circuit_open ? 'open' : 'closed',
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
    lane: 'Surface host',
    owner: 'Gateway',
    backend: surfaceHost.value.status || state.value.surfaceHealth?.status || 'unknown',
    webui: surfaces.value.length ? `${surfaces.value.length} surfaces` : 'no registry data',
    tui: surfaces.value.some((item: any) => String(item.id || '').toLowerCase() === 'tui') ? 'registered' : 'projected by Gateway',
    action: surfaces.value.length ? 'monitor events' : 'start gateway or refresh registry',
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
  if (state.value.surfaceHealth?.__offline || state.value.summary?.__offline) return 'offline';
  if (!surfaces.value.length || !accounts.value.length) return 'degraded';
  return 'ready';
});
const gatewayRemediationRows = computed(() => [
  {
    id: 'edge-host',
    lane: 'EdgeHost',
    severity: edgeRows.value.length ? 'ready' : 'degraded',
    problem: edgeRows.value.length ? 'Edge projection is visible.' : 'No Edge projection data is available.',
    evidence: `surfaces=${edgeSurfaces.value.length}, message=${edgeMessageConnectors.value.length}, source=${edgeSourceConnectors.value.length}, automation=${edgeAutomationConnectors.value.length}`,
    next_action: edgeRows.value.length ? 'Use Edge rows to distinguish UI surfaces, message connectors, and source connectors.' : 'Verify /api/edges and SurfaceHost manifest roots.',
  },
  {
    id: 'surface-host',
    lane: 'Surface host',
    severity: state.value.surfaceHealth?.__offline ? 'blocked' : surfaces.value.length ? 'ready' : 'degraded',
    problem: surfaces.value.length ? 'Surface registry is visible.' : 'No surface registry data is available.',
    evidence: `status=${surfaceHost.value.status || state.value.surfaceHealth?.status || 'unknown'}, surfaces=${surfaces.value.length}`,
    next_action: surfaces.value.length ? 'Monitor route/resource events.' : 'Start Gateway, refresh SurfaceHost, then inspect /api/surfaces/health.',
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
const gatewayContext = computed(() => [
  { label: t('edge.context.total'), value: edgeRows.value.length, tone: edgeRows.value.length ? 'success' : 'warn' },
  { label: t('script.pages.gatewaypage.label.f243224b11'), value: `${surfaces.value.length} surfaces`, tone: surfaces.value.length ? 'success' : 'warn' },
  { label: t('script.pages.gatewaypage.label.4b1e9501b9'), value: accounts.value.length, tone: accounts.value.length ? 'success' : 'warn' },
  { label: t('script.pages.gatewaypage.label.42c248d3eb'), value: identities.value.length },
  { label: t('script.pages.gatewaypage.label.8999e5848a'), value: executions.value.length },
]);
const gatewayWorkflow = computed(() => [
  { id: 'surfaces', label: t('edge.workflow.host'), status: edgeRows.value.length ? 'ready' : 'degraded', count: edgeRows.value.length },
  { id: 'surfaces', label: t('script.pages.gatewaypage.label.f086bb51e1'), status: surfaces.value.length ? 'ready' : 'idle', count: surfaces.value.length },
  { id: 'connectors', label: t('script.pages.gatewaypage.label.4b1e9501b9'), status: accounts.value.length ? 'ready' : 'degraded', count: accounts.value.length },
  { id: 'resources', label: t('script.pages.gatewaypage.label.87df60de33'), status: resourceRows.value.length ? 'ready' : 'idle', count: resourceRows.value.length },
  { id: 'identities', label: t('script.pages.gatewaypage.label.7e5a975b6a'), status: identityRows.value.length ? 'ready' : 'blocked', count: identityRows.value.length },
  { id: 'identities', label: t('script.pages.gatewaypage.label.c02329c48f'), status: grantRows.value.length ? 'ready' : 'blocked', count: grantRows.value.length },
  { id: 'executions', label: t('script.pages.gatewaypage.label.6ea36ce8d4'), status: actionResult.value ? 'active' : 'idle', description: executeMode.value },
]);
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

async function loadEdgeSourceSnapshots() {
  sourceSnapshotError.value = '';
  sourceSnapshotResult.value = await api.matrixSourceSnapshots(sourceSnapshotPackId.value);
  selectedDetail.value = sourceSnapshotResult.value;
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [platforms, platformDetail, summary, nextAccounts, nextCapabilities, nextResources, mcp, servicesData, edge, surfacesData, surfaceHealth, channelsData, crossPlane, identitiesData, grantsData, audit, adapters, nextExecutions] = await Promise.all([
      api.platforms(),
      api.platform(platformName.value),
      api.connectorsSummary(),
      api.connectorAccounts(),
      api.connectorCapabilities(),
      api.connectorResources(),
      api.connectorMcpServers(),
      api.connectorServices(),
      api.edgeRegistry(),
      api.surfaceRegistry(),
      api.surfaceHostHealth(),
      api.channels(),
      api.crossPlaneSummary(),
      api.crossPlaneIdentities(),
      api.crossPlaneGrants(),
      api.crossPlaneAudit(),
      api.crossPlaneAdapters(),
      api.crossPlaneExecutions(),
    ]);
    const services = Array.isArray(servicesData?.services) ? servicesData.services : [];
    const nextServiceId = connectorServiceId.value || services[0]?.id || '';
    const serviceTools = nextServiceId ? await api.connectorServiceTools(nextServiceId) : { tools: [] };
    state.value = { platforms, platformDetail, summary, accounts: nextAccounts, capabilities: nextCapabilities, resources: nextResources, mcp, connectorServices: servicesData, connectorServiceTools: serviceTools, edge, surfaces: surfacesData, surfaceHealth, channels: channelsData, crossPlane, identities: identitiesData, grants: grantsData, audit, adapters, executions: nextExecutions };
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
  actionResult.value = await api.writeReceipt('/api/connectors/resources/revalidate', {
    method: 'POST',
    body: JSON.stringify({ reference: resourceRef.value }),
  });
  await refresh();
}

async function promoteResourceMemory() {
  if (!resourceRef.value) return;
  actionResult.value = await api.writeReceipt('/api/connectors/resources/promote-memory', {
    method: 'POST',
    body: JSON.stringify({ reference: resourceRef.value }),
  });
  await refresh();
}

async function runPreflight() {
  actionResult.value = await api.writeReceipt('/api/cross-plane/action/preflight', {
    method: 'POST',
    body: JSON.stringify(crossPlaneAction()),
  });
  await refresh();
}

async function simulatePolicy() {
  actionResult.value = await api.writeReceipt('/api/cross-plane/policy/simulate', {
    method: 'POST',
    body: JSON.stringify(crossPlaneAction()),
  });
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
  actionResult.value = await api.writeReceipt('/api/cross-plane/identities', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  identityId.value = actionResult.value?.data?.identity?.id || actionResult.value?.identity?.id || identityId.value;
  await refresh();
}

async function revokeIdentity() {
  if (!identityId.value) return;
  actionResult.value = await api.writeReceipt(`/api/cross-plane/identities/${encodeURIComponent(identityId.value)}`, { method: 'DELETE' });
  identityId.value = '';
  await refresh();
}

async function resolveIdentity() {
  actionResult.value = await api.writeReceipt('/api/cross-plane/identity/resolve', {
    method: 'POST',
    body: JSON.stringify({ identity_ref: identityRef.value }),
  });
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
  actionResult.value = await api.writeReceipt('/api/cross-plane/grants', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  grantId.value = actionResult.value?.data?.grant?.id || actionResult.value?.grant?.id || grantId.value;
  await refresh();
}

async function revokeGrant() {
  if (!grantId.value) return;
  actionResult.value = await api.writeReceipt(`/api/cross-plane/grants/${encodeURIComponent(grantId.value)}`, { method: 'DELETE' });
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
    <PrimaryContextBar :items="gatewayContext" density="compact" :max-visible="4" />
    <WorkflowStrip :steps="gatewayWorkflow" :title="t('page.gateway.page.title.15380a6a3f')" density="compact" />

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
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.gateway.page.text.d5cf00c093') }}</span>
        <strong>{{ surfaces.length }}</strong>
        <small>{{ displayStatus(surfaceHost.status || state.surfaceHealth?.status || 'unknown') }} / {{ surfaceHost.circuit_open_count || 0 }} circuit</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.gateway.page.text.9fcdea7846') }}</span>
        <strong>{{ identities.length }}/{{ grants.length }}</strong>
        <small>{{ t('page.gateway.page.text.caec320908') }}</small>
      </article>
      <article class="metric-card" :data-tone="edgeRows.length ? 'success' : 'warn'">
        <span>{{ t('edge.metric.total') }}</span>
        <strong>{{ edgeRows.length }}</strong>
        <small>{{ t('edge.metric.breakdown', { surfaces: edgeSurfaces.length, message: edgeMessageConnectors.length, source: edgeSourceConnectors.length }) }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="surfaces">
        <header>
          <h2>{{ t('edge.gateway.title') }}</h2>
          <StatusPill :status="edgeHealth.status || 'unknown'" />
        </header>
        <p>{{ t('edge.gateway.detail') }}</p>
        <DataTable v-if="edgeRows.length" :rows="edgeRows" :columns="['domain', 'id', 'name', 'status', 'lifecycle', 'capabilities', 'routes', 'resources', 'source']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.empty.title')" :detail="t('edge.empty.detail')" />
        <RawPayload :title="t('edge.gateway.raw')" :data="edgeHealth || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="alignment">
        <header>
          <h2>{{ t('page.gateway.page.text.3aaa20c63d') }}</h2>
          <StatusPill :status="gatewayAlignmentStatus" />
        </header>
        <p>{{ t('page.gateway.page.text.5a99daa9a9') }}</p>
        <DataTable :rows="gatewayAlignmentRows" :columns="['lane', 'owner', 'backend', 'webui', 'tui', 'action']" @row-click="selectedDetail = $event" />
        <GatewayRemediationList :rows="gatewayRemediationRows" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="surfaces">
        <header>
          <h2>{{ t('page.gateway.page.text.f13f7c3a12') }}</h2>
          <StatusPill :status="state.surfaceHealth?.__offline ? 'offline' : (surfaceHost.status || state.surfaceHealth?.status || 'ready')" />
        </header>
        <p>{{ t('page.gateway.page.text.7fa2efe0a9') }}</p>
        <DataTable v-if="surfaceRows.length" :rows="surfaceRows" :columns="['runtime', 'id', 'name', 'kind', 'lifecycle', 'failures', 'restarts', 'circuit', 'routes', 'resources']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.ae647d6b79')" :detail="t('page.gateway.page.detail.767891561a')" />
        <RawPayload :title="t('page.gateway.page.title.ed73c8169c')" :data="state.surfaceHealth || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.df4bfe6273') }}</h2>
          <StatusPill :status="state.summary?.__offline ? 'offline' : 'ready'" />
        </header>
        <DataTable v-if="accountRows.length" :rows="accountRows" :columns="['provider', 'account', 'status', 'scopes']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.bed97233b0')" :detail="t('page.gateway.page.detail.51394d64f1')" />
        <DataTable v-if="channelRows.length" :rows="channelRows" :columns="['channel', 'config', 'runtime', 'enabled', 'credential', 'failures', 'restarts', 'circuit']" @row-click="selectedDetail = $event" />
        <RawPayload :title="t('page.gateway.page.title.a0df395cfc')" :data="state.platforms || {}" />
        <RawPayload :title="t('page.gateway.page.title.513df4116b')" :data="state.channels || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>{{ t('edge.connectors.title') }}</h2>
          <StatusPill :status="edgeMessageConnectors.length || edgeSourceConnectors.length ? 'ready' : 'degraded'" />
        </header>
        <p>{{ t('edge.connectors.detail') }}</p>
        <DataTable v-if="messageConnectorRows.length" :rows="messageConnectorRows" :columns="['id', 'name', 'status', 'capabilities', 'entry', 'diagnostics']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.message.empty.title')" :detail="t('edge.message.empty.detail')" />
        <DataTable v-if="sourceConnectorRows.length" :rows="sourceConnectorRows" :columns="['id', 'name', 'adapter', 'family', 'mode', 'sidecar', 'snapshot', 'incremental', 'schema', 'runtime']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('edge.source.empty.title')" :detail="t('edge.source.empty.detail')" />
        <RawPayload :title="t('edge.connectors.raw')" :data="{ message_connectors: edgeMessageConnectors, source_connectors: edgeSourceConnectors, automation_connectors: edgeAutomationConnectors }" />
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
        <label class="field-line">
          {{ t('edge.snapshot.field.rows') }}
          <textarea v-model="sourceSnapshotRowsText" rows="6" />
        </label>
        <p v-if="sourceSnapshotError" class="field-error">{{ sourceSnapshotError }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="upsertEdgeSourcePack">{{ t('edge.snapshot.action.seed') }}</button>
          <button class="ghost-action" type="button" @click="planEdgeSourceSnapshot">{{ t('edge.snapshot.action.plan') }}</button>
          <button class="primary-action" type="button" @click="runEdgeSourceSnapshotRows">{{ t('edge.snapshot.action.runRows') }}</button>
          <button class="ghost-action" type="button" @click="runEdgeSourceSnapshotReadPlan">{{ t('edge.snapshot.action.runReadPlan') }}</button>
          <button class="ghost-action" type="button" @click="loadEdgeSourceSnapshots">{{ t('edge.snapshot.action.list') }}</button>
        </div>
        <RequestReceipt :receipt="sourceSnapshotResult" :title="t('edge.snapshot.receipt')" />
        <RawPayload :title="t('edge.snapshot.readPlan')" :data="sourceSnapshotReadPlan" />
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
        <DataTable v-if="connectorServiceRows.length" :rows="connectorServiceRows" :columns="['id', 'provider', 'family', 'mode']" @row-click="selectedDetail = $event" />
        <label class="field-line">
          {{ t('page.gateway.field.connectorService') }}
          <input v-model="connectorServiceId" type="text" />
        </label>
        <button class="ghost-action" type="button" :disabled="!connectorServiceId" @click="loadConnectorServiceTools">{{ t('page.gateway.page.text.63dce7d3eb') }}</button>
        <DataTable v-if="connectorServiceToolRows.length" :rows="connectorServiceToolRows" :columns="['id', 'family', 'risk', 'mode']" @row-click="selectedDetail = $event" />
        <label class="field-line">
          {{ t('page.gateway.field.serviceTool') }}
          <input v-model="connectorServiceToolId" type="text" />
        </label>
        <button class="ghost-action" type="button" :disabled="!connectorServiceId || !connectorServiceToolId" @click="executeConnectorServiceTool">{{ t('page.gateway.page.text.c0e6cf81d6') }}</button>
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.83dadbfefc')" />
        <RawPayload :title="t('page.gateway.page.title.f8bba99b1e')" :data="{ platform: state.platformDetail, connectorServices: state.connectorServices, connectorServiceTools: state.connectorServiceTools }" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.b4e80b5466') }}</h2>
          <span>{{ t('common.shownCount', { count: capabilityRows.length, unit: t('unit.capabilities') }) }}</span>
        </header>
        <DataTable v-if="capabilityRows.length" :rows="capabilityRows" :columns="['id', 'provider', 'risk', 'mode']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.e6acca3a2d')" :detail="t('page.gateway.page.detail.662c9ed56d')" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>{{ t('page.gateway.page.text.cd60e278cf') }}</h2>
          <span>{{ formatCount('servers', mcpServers.length) }}</span>
        </header>
        <RawPayload :title="t('page.gateway.page.title.c593f2c735')" :data="state.mcp || {}" />
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
        <DataTable v-if="resourceRows.length" :rows="resourceRows" :columns="['reference', 'title', 'kind', 'status']" @row-click="selectedDetail = $event" />
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
        <RawPayload :title="t('page.gateway.page.title.023d50a0fe')" :data="state.crossPlane || {}" />
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
        <DataTable v-if="identityRows.length" :rows="identityRows" :columns="['id', 'principal', 'identity', 'trust']" @row-click="selectedDetail = $event" />
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
        <DataTable v-if="grantRows.length" :rows="grantRows" :columns="['id', 'principal', 'capability', 'type']" @row-click="selectedDetail = $event" />
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
        <RawPayload :title="t('page.gateway.page.title.178eed6c71')" :data="actionResult || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>{{ t('page.gateway.page.text.0cef581c98') }}</h2>
          <span>{{ formatCount('executions', executionRows.length) }}</span>
        </header>
        <DataTable v-if="executionRows.length" :rows="executionRows" :columns="['id', 'status', 'capability', 'provider']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.gateway.page.title.746b965ff4')" :detail="t('page.gateway.page.detail.10a566c783')" />
        <EvidenceTrace :items="gatewayEvidence" :title="t('page.gateway.page.title.abd0756c8f')" />
        <DetailDrawer :title="t('page.gateway.page.title.402c21482a')" :row="selectedDetail" @close="selectedDetail = null" />
        <RequestReceipt :receipt="actionResult" :title="t('page.gateway.page.title.21964d7bc6')" />
        <RawPayload :title="t('page.gateway.page.title.18f4a5d2d9')" :data="actionResult || state.audit || {}" />
      </section>
    </section>
  </section>
</template>
