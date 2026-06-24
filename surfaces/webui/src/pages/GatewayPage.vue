<script setup lang="ts">
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
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';

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
const mockDocsTool = ref('search');
const selectedDetail = ref<Record<string, unknown> | null>(null);

const accounts = computed(() => Array.isArray(state.value.accounts?.accounts) ? state.value.accounts.accounts : []);
const capabilities = computed(() => Array.isArray(state.value.capabilities?.capabilities) ? state.value.capabilities.capabilities : []);
const resources = computed(() => Array.isArray(state.value.resources?.resources) ? state.value.resources.resources : Array.isArray(state.value.resources?.items) ? state.value.resources.items : []);
const mcpServers = computed(() => Array.isArray(state.value.mcp?.servers) ? state.value.mcp.servers : []);
const surfaces = computed(() => Array.isArray(state.value.surfaces?.registry?.surfaces) ? state.value.surfaces.registry.surfaces : []);
const surfaceHost = computed(() => state.value.surfaceHealth?.host || state.value.surfaceHealth || {});
const executions = computed(() => Array.isArray(state.value.executions?.executions) ? state.value.executions.executions : []);
const identities = computed(() => Array.isArray(state.value.identities?.identities) ? state.value.identities.identities : []);
const grants = computed(() => Array.isArray(state.value.grants?.grants) ? state.value.grants.grants : []);
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
  id: item.id,
  name: item.name || item.id || '-',
  kind: item.kind || '-',
  lifecycle: item.lifecycle || '-',
  routes: Array.isArray(item.routes) ? item.routes.length : Number(item.routes || 0),
  resources: Array.isArray(item.resources) ? item.resources.length : Number(item.resources || 0),
})));
const mockDocsRows = computed(() => {
  const tools = state.value.mockDocs?.tools || state.value.mockDocs?.items || [];
  return Array.isArray(tools) ? tools.slice(0, 10).map((item: any) => ({
    name: item.name || item.id || item.tool || '-',
    description: item.description || item.summary || '-',
    risk: item.risk || '-',
  })) : [];
});
const gatewayContext = computed(() => [
  { label: 'Surface host', value: `${surfaces.value.length} surfaces`, tone: surfaces.value.length ? 'success' : 'warn' },
  { label: 'Connectors', value: accounts.value.length, tone: accounts.value.length ? 'success' : 'warn' },
  { label: 'Identities', value: identities.value.length },
  { label: 'Executions', value: executions.value.length },
]);
const gatewayWorkflow = computed(() => [
  { id: 'surfaces', label: 'Surface summary', status: surfaces.value.length ? 'ready' : 'idle', count: surfaces.value.length },
  { id: 'connectors', label: 'Connectors', status: accounts.value.length ? 'ready' : 'degraded', count: accounts.value.length },
  { id: 'resources', label: 'Resources', status: resourceRows.value.length ? 'ready' : 'idle', count: resourceRows.value.length },
  { id: 'identities', label: 'Identity', status: identityRows.value.length ? 'ready' : 'blocked', count: identityRows.value.length },
  { id: 'identities', label: 'Grant', status: grantRows.value.length ? 'ready' : 'blocked', count: grantRows.value.length },
  { id: 'executions', label: 'Execute', status: actionResult.value ? 'active' : 'idle', description: executeMode.value },
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
  title: 'Promote connector resource to memory',
  endpoint: '/api/connectors/resources/promote-memory',
  method: 'POST',
  summary: 'Validate connector resource metadata before promoting it into memory. Promotion records a receipt and preserves source refs.',
  current_return: 'RequestReceipt with memory promotion metadata',
  validate: '/api/connectors/resources/revalidate',
  plan: '/api/connectors/resources/revalidate',
  dry_run: '/api/connectors/resources/revalidate',
  live: true,
  live_policy: 'requires resource_ref and connector metadata',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway connector service -> Memory engine',
  affected_refs: resourceRef.value ? [resourceRef.value] : [],
}));
const crossPlaneExecuteContract = computed(() => ({
  id: 'gateway.cross-plane.execute',
  domain: 'gateway',
  title: 'Execute cross-plane action',
  endpoint: '/api/cross-plane/action/execute',
  method: 'POST',
  summary: 'Run policy simulation and preflight before executing cross-plane actions. Commit mode can dispatch to external surfaces.',
  current_return: 'Execution receipt with dispatch target and policy decision',
  validate: '/api/cross-plane/policy/simulate',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: 'commit requires grant, identity, idempotency, and adapter readiness',
  receipt: true,
  audit_ref: true,
  changed_refs: false,
  approval_required: true,
  kernel_boundary: 'Gateway cross-plane service',
  affected_refs: [resourceRef.value, capability.value, identityRef.value].filter(Boolean),
}));
const identityGovernanceContract = computed(() => ({
  id: 'gateway.cross-plane.identity',
  domain: 'gateway',
  title: 'Manage cross-plane identity',
  endpoint: '/api/cross-plane/identities',
  method: 'POST',
  summary: 'Resolve identity before creating a trusted binding. Revocation stays explicit in the identity list.',
  current_return: 'Identity binding receipt',
  validate: '/api/cross-plane/identity/resolve',
  plan: '/api/cross-plane/identity/resolve',
  dry_run: '/api/cross-plane/identity/resolve',
  live: true,
  live_policy: 'creates a verified identity binding for the actor',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway cross-plane identity registry',
  affected_refs: [identityRef.value, actor.value].filter(Boolean),
}));
const grantGovernanceContract = computed(() => ({
  id: 'gateway.cross-plane.grant',
  domain: 'gateway',
  title: 'Create cross-plane grant',
  endpoint: '/api/cross-plane/grants',
  method: 'POST',
  summary: 'Preflight policy before creating a grant that enables governed cross-plane actions.',
  current_return: 'Grant receipt with capability and scope',
  validate: '/api/cross-plane/action/preflight',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: 'creates a persistent grant for the selected actor and capability',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway cross-plane grant registry',
  affected_refs: [capability.value, resourceRef.value, actor.value].filter(Boolean),
}));
const identityRevokeContract = computed(() => ({
  id: 'gateway.cross-plane.identity.revoke',
  domain: 'gateway',
  title: 'Revoke cross-plane identity',
  endpoint: '/api/cross-plane/identities/:id',
  method: 'DELETE',
  summary: 'Revoke an identity binding after resolving the selected identity ref. Revocation changes cross-plane authorization behavior.',
  current_return: 'Identity revocation receipt',
  validate: '/api/cross-plane/identity/resolve',
  plan: '/api/cross-plane/identity/resolve',
  dry_run: '/api/cross-plane/identity/resolve',
  live: true,
  live_policy: 'requires selected identity binding id',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway cross-plane identity registry',
  affected_refs: [identityId.value, identityRef.value].filter(Boolean),
}));
const grantRevokeContract = computed(() => ({
  id: 'gateway.cross-plane.grant.revoke',
  domain: 'gateway',
  title: 'Revoke cross-plane grant',
  endpoint: '/api/cross-plane/grants/:id',
  method: 'DELETE',
  summary: 'Revoke an active grant and force later cross-plane actions back through policy and approval gates.',
  current_return: 'Grant revocation receipt',
  validate: '/api/cross-plane/action/preflight',
  plan: '/api/cross-plane/action/preflight',
  dry_run: '/api/cross-plane/policy/simulate',
  live: true,
  live_policy: 'requires selected grant id',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway cross-plane grant registry',
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

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [platforms, platformDetail, summary, nextAccounts, nextCapabilities, nextResources, mcp, mockDocs, surfacesData, surfaceHealth, crossPlane, identitiesData, grantsData, audit, adapters, nextExecutions] = await Promise.all([
      api.platforms(),
      api.platform(platformName.value),
      api.connectorsSummary(),
      api.connectorAccounts(),
      api.connectorCapabilities(),
      api.connectorResources(),
      api.connectorMcpServers(),
      api.mockDocsTools(),
      api.surfaceRegistry(),
      api.surfaceHostHealth(),
      api.crossPlaneSummary(),
      api.crossPlaneIdentities(),
      api.crossPlaneGrants(),
      api.crossPlaneAudit(),
      api.crossPlaneAdapters(),
      api.crossPlaneExecutions(),
    ]);
    state.value = { platforms, platformDetail, summary, accounts: nextAccounts, capabilities: nextCapabilities, resources: nextResources, mcp, mockDocs, surfaces: surfacesData, surfaceHealth, crossPlane, identities: identitiesData, grants: grantsData, audit, adapters, executions: nextExecutions };
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

async function executeMockDocsTool() {
  actionResult.value = await api.mockDocsExecute(mockDocsTool.value, { query: resourceRef.value || 'cowd gateway' });
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
        <h1>Gateway and Cross-plane</h1>
        <p>连接器账号、服务能力、资源治理、MCP 状态和跨平面执行门禁集中管理。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh gateway' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="gatewayContext" />
    <WorkflowStrip :steps="gatewayWorkflow" title="Gateway access flow" />

    <section class="metric-row">
      <article class="metric-card">
        <span>Accounts</span>
        <strong>{{ accounts.length }}</strong>
        <small>{{ state.summary?.status || 'connector registry' }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Capabilities</span>
        <strong>{{ capabilities.length }}</strong>
        <small>{{ resources.length }} resources</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>Cross-plane</span>
        <strong>{{ executions.length }}</strong>
        <small>executions recorded</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Surfaces</span>
        <strong>{{ surfaces.length }}</strong>
        <small>{{ surfaceHost.status || state.surfaceHealth?.status || 'host' }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Identity/Grants</span>
        <strong>{{ identities.length }}/{{ grants.length }}</strong>
        <small>control-plane bindings</small>
      </article>
    </section>

      <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="surfaces">
        <header>
          <h2>Surface host</h2>
          <StatusPill :status="state.surfaceHealth?.__offline ? 'offline' : (surfaceHost.status || state.surfaceHealth?.status || 'ready')" />
        </header>
        <p>Gateway owns external ingress, static forwarding, callback routing, and result delivery across WebUI, TUI, and external message surfaces.</p>
        <DataTable v-if="surfaceRows.length" :rows="surfaceRows" :columns="['id', 'name', 'kind', 'lifecycle', 'routes', 'resources']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No surfaces" detail="SurfaceHost 未返回可用 surface，或 Gateway 尚未启动。" />
        <RawPayload title="Surface host health" :data="state.surfaceHealth || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>Platforms and connectors</h2>
          <StatusPill :status="state.summary?.__offline ? 'offline' : 'ready'" />
        </header>
        <DataTable v-if="accountRows.length" :rows="accountRows" :columns="['provider', 'account', 'status', 'scopes']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No connector accounts" detail="配置平台账号后会在这里展示。" />
        <RawPayload title="Platforms" :data="state.platforms || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="connectors">
        <header>
          <h2>Channel and connector diagnostics</h2>
          <span>{{ platformName }}</span>
        </header>
        <div class="memory-form-row">
          <label class="field-line">
            Platform
            <input v-model="platformName" type="text" />
          </label>
          <label class="field-line">
            WeChat bot type
            <input v-model="wechatBotType" type="text" />
          </label>
        </div>
        <label class="field-line">
          WeChat QR code
          <input v-model="wechatQrCode" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="loadPlatform">Load platform</button>
          <button class="ghost-action" type="button" @click="startWechatQr">Start QR</button>
          <button class="ghost-action" type="button" :disabled="!wechatQrCode" @click="pollWechatQr">Poll QR</button>
        </div>
        <DataTable v-if="mockDocsRows.length" :rows="mockDocsRows" :columns="['name', 'description', 'risk']" @row-click="selectedDetail = $event" />
        <label class="field-line">
          Mock docs tool
          <input v-model="mockDocsTool" type="text" />
        </label>
        <button class="ghost-action" type="button" @click="executeMockDocsTool">Execute mock docs tool</button>
        <RequestReceipt :receipt="actionResult" title="Channel diagnostic receipt" />
        <RawPayload title="Channel diagnostic detail" :data="{ platform: state.platformDetail, mockDocs: state.mockDocs }" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>Connector capabilities</h2>
          <span>{{ capabilityRows.length }} shown</span>
        </header>
        <DataTable v-if="capabilityRows.length" :rows="capabilityRows" :columns="['id', 'provider', 'risk', 'mode']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No connector capabilities" detail="连接器能力清单为空或后端离线。" />
      </section>

      <section class="management-panel gateway-panel" data-section="connectors">
        <header>
          <h2>MCP servers</h2>
          <span>{{ mcpServers.length }} servers</span>
        </header>
        <RawPayload title="MCP server registry" :data="state.mcp || {}" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="resources">
        <header>
          <h2>Resources and memory promotion</h2>
          <span>{{ resources.length }} resources</span>
        </header>
        <label class="field-line">
          Resource ref
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
        <RequestReceipt :receipt="actionResult" title="Resource receipt" />
        <DataTable v-if="resourceRows.length" :rows="resourceRows" :columns="['reference', 'title', 'kind', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No connector resources" detail="资源桥接和记忆提升需要连接器返回资源。" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>Cross-plane governance</h2>
          <span>{{ state.crossPlane?.status || 'preflight' }}</span>
        </header>
        <label class="field-line">
          Actor
          <input v-model="actor" type="text" />
        </label>
        <label class="field-line">
          Capability
          <input v-model="capability" type="text" />
        </label>
        <label class="field-line">
          Identity ref
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
        <RequestReceipt :receipt="actionResult" title="Cross-plane readiness receipt" />
        <RawPayload title="Cross-plane summary" :data="state.crossPlane || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="identities">
        <header>
          <h2>Identities and grants</h2>
          <span>{{ identities.length }} identities</span>
        </header>
        <label class="field-line">
          Identity binding id
          <input v-model="identityId" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="resolveIdentity">Resolve identity</button>
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
        <RequestReceipt :receipt="actionResult" title="Identity receipt" />
        <DataTable v-if="identityRows.length" :rows="identityRows" :columns="['id', 'principal', 'identity', 'trust']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No identities" detail="创建身份绑定后，跨平面动作会使用可信主体判定。" />
        <label class="field-line">
          Grant id
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
        <RequestReceipt :receipt="actionResult" title="Grant receipt" />
        <DataTable v-if="grantRows.length" :rows="grantRows" :columns="['id', 'principal', 'capability', 'type']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No grants" detail="授权为空时，高风险动作会被策略门禁拦截或要求审批。" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>Action execution</h2>
          <span>{{ executeMode }}</span>
        </header>
        <label class="field-line">
          Mode
          <select v-model="executeMode">
            <option value="dry_run">dry_run</option>
            <option value="commit">commit</option>
          </select>
        </label>
        <label class="field-line">
          Idempotency key
          <input v-model="idempotencyKey" type="text" placeholder="optional" />
        </label>
        <RequestReceipt :receipt="actionResult" title="Execution receipt" />
        <RawPayload title="Action readiness or receipt" :data="actionResult || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="executions">
        <header>
          <h2>Audit and executions</h2>
          <span>{{ executionRows.length }} executions</span>
        </header>
        <DataTable v-if="executionRows.length" :rows="executionRows" :columns="['id', 'status', 'capability', 'provider']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No executions" detail="跨平面动作执行后会在这里展示。" />
        <EvidenceTrace :items="gatewayEvidence" title="Gateway evidence trace" />
        <DetailDrawer title="Gateway selected detail" :row="selectedDetail" @close="selectedDetail = null" />
        <RequestReceipt :receipt="actionResult" title="Gateway action receipt" />
        <RawPayload title="Gateway action result" :data="actionResult || state.audit || {}" />
      </section>
    </section>
  </section>
</template>
