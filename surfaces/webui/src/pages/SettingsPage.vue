<script setup lang="ts">
import { computed, ref } from 'vue';
import { Moon, Plus, RefreshCw, Shield, Sun, Trash2 } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { api } from '../api/client';
import { useI18n, type Locale } from '../i18n';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';

const store = useAppStore();
const { locale, setLocale } = useI18n();
const profileName = ref('');
const defaultModel = ref('');
const settingsError = ref('');
const busyAction = ref('');
const authResult = ref<any>(null);
const settingsReceipt = ref<any>(null);
const selectedDetail = ref<Record<string, unknown> | null>(null);
const origin = computed(() => location.origin);
const accessMode = computed(() => {
  if (authResult.value?.valid || authResult.value?.auth_required === false) return 'internal webui access ready';
  if (authResult.value?.__offline) return 'gateway offline';
  if (authResult.value?.error || authResult.value?.__error) return 'external auth required';
  return 'same-origin gateway surface';
});
const providerModels = computed(() => store.providers?.models || []);
const providerRows = computed(() => store.providers?.providers || []);
const configuredModel = computed(() => store.providers?.configured_model || store.controlPlane?.configured_model || store.settings?.model || '');
const settingsContext = computed(() => [
  { label: 'Origin', value: origin.value },
  { label: 'Access', value: accessMode.value, tone: accessMode.value.includes('offline') ? 'warn' : 'success' },
  { label: 'Providers', value: providerRows.value.length },
  { label: 'Model', value: configuredModel.value || 'unresolved' },
]);
const settingsWorkflow = computed(() => [
  { id: 'profile', label: 'Profile', status: store.profiles?.length ? 'ready' : 'idle', count: store.profiles?.length || 0 },
  { id: 'gateway', label: 'Gateway', status: accessMode.value.includes('offline') ? 'blocked' : 'ready', description: accessMode.value },
  { id: 'providers', label: 'Providers', status: providerRows.value.length ? 'ready' : 'degraded', count: providerRows.value.length },
  { id: 'policy', label: 'Policy', status: store.approvalConfig ? 'ready' : 'idle' },
  { id: 'ui', label: 'UI', status: 'ready', description: theme.value },
]);
const modelConfigContract = computed(() => ({
  id: 'settings.runtime.model',
  domain: 'settings',
  title: 'Save runtime model config',
  endpoint: '/api/config',
  method: 'PUT',
  summary: 'Update the default runtime model through Gateway config. Reload provider projection after the write receipt returns.',
  current_return: 'Config receipt and refreshed provider projection',
  validate: 'provider model exists in current provider projection when available',
  plan: 'preview selected model',
  dry_run: 'preview selected model',
  live: true,
  live_policy: 'writes Gateway config model field',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway config service',
  affected_refs: [configuredModel.value || 'model'],
  fields: [
    { name: 'model', label: 'Model', required: true, type: 'text' },
  ],
}));
const approvalPolicyContract = computed(() => ({
  id: 'settings.approval.policy',
  domain: 'settings',
  title: 'Update approval policy',
  endpoint: '/api/approval/config',
  method: 'PUT',
  summary: 'Update approval policy with an explicit receipt. Invalid JSON is rejected before sending.',
  current_return: 'Approval policy receipt and refreshed approval config',
  validate: 'JSON parse and approval schema accepted by Gateway',
  plan: 'preview approval JSON',
  dry_run: 'parse approval JSON',
  live: true,
  live_policy: 'writes approval gate configuration',
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: 'Gateway approval service',
  affected_refs: ['approval.config'],
}));

const theme = computed({
  get: () => document.documentElement.dataset.theme || 'dark',
  set: (value: string) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem('cowd-theme', value);
  },
});

const uiLocale = computed({
  get: () => locale.value,
  set: (value: Locale) => setLocale(value),
});

const approvalJson = computed({
  get: () => JSON.stringify(store.approvalConfig || {}, null, 2),
  set: () => undefined,
});

async function run(label: string, action: () => Promise<unknown>) {
  settingsError.value = '';
  busyAction.value = label;
  try {
    await action();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    busyAction.value = '';
  }
}

async function addProfile() {
  const name = profileName.value.trim();
  if (!name) return;
  await run('profile-create', async () => {
    settingsReceipt.value = await api.writeReceipt('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await store.refreshProfiles();
    profileName.value = '';
  });
}

async function saveDefaultModel() {
  const model = defaultModel.value || configuredModel.value;
  if (!model) return;
  await saveDefaultModelGoverned({ model });
}

async function previewDefaultModelGoverned(payload: Record<string, unknown> = {}) {
  const model = String(payload.model || defaultModel.value || configuredModel.value || '').trim();
  settingsReceipt.value = {
    ok: !!model,
    endpoint: '/api/config',
    method: 'PUT',
    status: model ? 'preview' : 'invalid',
    payload_summary: JSON.stringify({ model }),
    error: model ? undefined : 'model is required',
    retryable: false,
  };
}

async function saveDefaultModelGoverned(payload: Record<string, unknown> = {}) {
  const model = String(payload.model || defaultModel.value || configuredModel.value || '').trim();
  if (!model) return;
  await run('model-save', async () => {
    settingsReceipt.value = await api.writeReceipt('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ model }),
    });
    defaultModel.value = model;
    await store.reloadProviders();
  });
}

async function saveApprovalFromText(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  await saveApprovalGoverned(JSON.parse(value));
}

async function previewApprovalGoverned(payload: Record<string, unknown> = {}) {
  try {
    const nextConfig = Object.keys(payload).length ? payload : JSON.parse(approvalJson.value);
    settingsReceipt.value = {
      ok: true,
      endpoint: '/api/approval/config',
      method: 'PUT',
      status: 'preview',
      payload_summary: JSON.stringify(nextConfig).slice(0, 280),
      retryable: false,
    };
  } catch (error) {
    settingsReceipt.value = {
      ok: false,
      endpoint: '/api/approval/config',
      method: 'PUT',
      status: 'invalid',
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
}

async function saveApprovalGoverned(payload: Record<string, unknown> = {}) {
  await run('approval-save', async () => {
    const nextConfig = Object.keys(payload).length ? payload : JSON.parse(approvalJson.value);
    settingsReceipt.value = await api.writeReceipt('/api/approval/config', {
      method: 'PUT',
      body: JSON.stringify(nextConfig),
    });
    store.approvalConfig = settingsReceipt.value?.data || nextConfig;
  });
}

async function toggleSoloGoverned() {
  await run('solo', async () => {
    settingsReceipt.value = await api.writeReceipt('/api/approval/solo', { method: 'POST' });
    store.approvalConfig = settingsReceipt.value?.data || store.approvalConfig || {};
    store.settingsSavedAt = new Date().toLocaleTimeString();
  });
}

async function switchProfile(profile: string) {
  await run(`profile-${profile}`, async () => {
    settingsReceipt.value = await api.writeReceipt('/api/profiles/switch', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    });
    await store.refreshProfiles();
  });
}

async function deleteProfile(id: string) {
  await run(`delete-${id}`, async () => {
    settingsReceipt.value = await api.writeReceipt(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await store.refreshProfiles();
  });
}

async function verifyAuth() {
  await run('auth-verify', async () => {
    authResult.value = await store.verifyAuth();
  });
}

</script>

<template>
  <section class="settings-page">
    <header class="page-header">
      <div>
        <h1>Settings</h1>
        <p>模型、provider、profile、approval 和安全状态均接后端真实接口，失败会显示后端错误。</p>
      </div>
      <button class="primary-action" type="button" :disabled="busyAction === 'providers'" @click="run('providers', store.reloadProviders)">
        <RefreshCw :size="15" />
        Reload providers
      </button>
    </header>

    <p v-if="settingsError" class="settings-alert">{{ settingsError }}</p>
    <PrimaryContextBar :items="settingsContext" />
    <WorkflowStrip :steps="settingsWorkflow" title="Configuration flow" />

    <div class="settings-grid">
      <section class="settings-section" data-section="ui">
        <h2>Appearance</h2>
        <div class="segmented">
          <button :class="{ active: theme === 'light' }" type="button" @click="theme = 'light'"><Sun :size="15" /> Light</button>
          <button :class="{ active: theme === 'dark' }" type="button" @click="theme = 'dark'"><Moon :size="15" /> Dark</button>
        </div>
        <label>
          Language
          <select v-model="uiLocale">
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
      </section>

      <section class="settings-section" data-section="providers">
        <h2>Runtime model source</h2>
        <dl class="contract-list">
          <dt>Configured model</dt>
          <dd>{{ configuredModel || 'unknown' }}</dd>
          <dt>Provider status</dt>
          <dd>{{ store.providers?.configured_model_resolved === false ? 'degraded' : (store.controlPlane?.provider_status || 'unknown') }}</dd>
          <dt>Providers</dt>
          <dd>{{ providerRows.map((provider) => provider.name).join(', ') || 'none reported' }}</dd>
          <dt>Model count</dt>
          <dd>{{ store.providers?.provider_model_count ?? store.controlPlane?.provider_model_count ?? 0 }}</dd>
        </dl>
        <label>
          Default model
          <select v-model="defaultModel">
            <option value="">Keep {{ configuredModel || 'current' }}</option>
            <option v-for="model in providerModels" :key="model.id || model.name" :value="model.id || model.name">
              {{ model.id || model.name }} · {{ model.provider }}
            </option>
          </select>
        </label>
        <GovernedActionPanel
          :contract="modelConfigContract"
          :payload="{ model: defaultModel || configuredModel }"
          :receipt="settingsReceipt"
          @plan="previewDefaultModelGoverned"
          @dry-run="previewDefaultModelGoverned"
          @live="saveDefaultModelGoverned"
        />
        <div class="profile-list">
          <article v-for="provider in providerRows" :key="provider.name" class="profile-row" role="button" tabindex="0" @click="selectedDetail = provider" @keydown.enter.prevent="selectedDetail = provider">
            <div>
              <strong>{{ provider.name }}</strong>
              <span>{{ provider.protocol || 'openai-compat' }} · {{ provider.model_count }} models · credential {{ provider.credential_present ? 'present' : 'missing' }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="settings-section" data-section="profile">
        <h2>Profiles</h2>
        <div class="profile-create-row">
          <input v-model="profileName" placeholder="New profile name" @keydown.enter.prevent="addProfile" />
          <button class="ghost-action" type="button" @click="addProfile"><Plus :size="14" /> Create</button>
        </div>
        <div class="profile-list">
          <article v-for="profile in store.profiles" :key="profile.id || profile.name" class="profile-row" role="button" tabindex="0" @click="selectedDetail = profile" @keydown.enter.prevent="selectedDetail = profile">
            <div>
              <strong>{{ profile.name || profile.id }}</strong>
              <span>{{ profile.id }}</span>
            </div>
            <div>
              <button
                class="ghost-action"
                type="button"
                :disabled="(profile.id || profile.name) === store.selectedProfile"
                @click="switchProfile(profile.id || profile.name)"
              >
                {{ (profile.id || profile.name) === store.selectedProfile ? 'Active' : 'Switch' }}
              </button>
              <button v-if="(profile.id || profile.name) !== 'default'" class="icon-action danger" type="button" @click="deleteProfile(profile.id || profile.name)">
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="settings-section" data-section="policy">
        <h2>Approval policy</h2>
        <label><input type="checkbox" :checked="!!store.approvalConfig?.solo_mode" @change="toggleSoloGoverned" /> Solo mode</label>
        <textarea :value="approvalJson" spellcheck="false" @change="saveApprovalFromText" />
        <GovernedActionPanel
          :contract="approvalPolicyContract"
          :payload="store.approvalConfig || {}"
          :receipt="settingsReceipt"
          @plan="previewApprovalGoverned"
          @dry-run="previewApprovalGoverned"
          @live="saveApprovalGoverned"
        />
        <p v-if="store.settingsSavedAt" class="save-state">Approval saved at {{ store.settingsSavedAt }}</p>
      </section>

      <section class="settings-section" data-section="gateway">
        <h2>Gateway access</h2>
        <p class="security-note"><Shield :size="16" /> WebUI uses same-origin internal access. Bearer auth remains the external API boundary.</p>
        <p class="security-note">Origin: {{ origin }}</p>
        <p class="security-note">Mode: {{ accessMode }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="verifyAuth">Verify gateway access</button>
        </div>
        <dl v-if="authResult" class="contract-list">
          <dt>Status</dt>
          <dd>{{ authResult.valid === true ? 'valid' : (authResult.status || authResult.authenticated || 'unknown') }}</dd>
          <dt>Error</dt>
          <dd>{{ authResult.__error || authResult.error || '-' }}</dd>
        </dl>
        <RequestReceipt v-if="settingsReceipt" :receipt="settingsReceipt" title="Settings write receipt" />
        <section v-else class="request-receipt">
          <header>
            <h2>Settings write receipt</h2>
            <span class="status-badge">idle</span>
          </header>
          <p class="empty-note">Save model config, update approval policy, or change profile state to capture a Gateway receipt.</p>
        </section>
        <DetailDrawer title="Settings selected detail" :row="selectedDetail" @close="selectedDetail = null" />
      </section>
    </div>
  </section>
</template>
