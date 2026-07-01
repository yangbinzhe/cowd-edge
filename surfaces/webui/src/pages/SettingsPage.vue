<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, ref } from 'vue';
import { Moon, Plus, RefreshCw, Shield, Sun, Trash2 } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { api } from '../api/client';
import { useI18n, type Locale } from '../i18n';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import { displayBoolean, displayStatus } from '../i18n/domain/status';

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
const accessModeLabels = {
  internal: 'settings.access.internal',
  offline: 'settings.access.offline',
  external: 'settings.access.external',
  sameOrigin: 'settings.access.sameOrigin',
} as const;
const accessModeCode = computed(() => {
  if (authResult.value?.valid || authResult.value?.auth_required === false) return 'internal';
  if (authResult.value?.__offline) return 'offline';
  if (authResult.value?.error || authResult.value?.__error) return 'external';
  return 'sameOrigin';
});
const accessMode = computed(() => t(accessModeLabels[accessModeCode.value]));
const providerModels = computed(() => store.providers?.models || []);
const providerRows = computed(() => store.providers?.providers || []);
const configuredModel = computed(() => store.providers?.configured_model || store.controlPlane?.configured_model || store.settings?.model || '');
const settingsContext = computed(() => [
  { label: t('script.pages.settingspage.label.44ab85a252'), value: origin.value },
  { label: t('script.pages.settingspage.label.2f81a22de0'), value: accessMode.value, tone: accessModeCode.value === 'offline' ? 'warn' : 'success' },
  { label: t('script.pages.settingspage.label.87b7c08bae'), value: providerRows.value.length },
  { label: t('script.pages.settingspage.label.68c2cc7f0c'), value: configuredModel.value || t('status.unknown') },
]);
const settingsSections = computed(() => [
  { id: 'ui', label: t('settings.nav.ui'), description: t('settings.nav.ui.desc'), status: theme.value },
  { id: 'providers', label: t('settings.nav.providers'), description: t('settings.nav.providers.desc'), status: providerRows.value.length ? formatCount('models', store.providers?.provider_model_count ?? store.controlPlane?.provider_model_count ?? 0) : t('status.missing') },
  { id: 'profile', label: t('settings.nav.profile'), description: t('settings.nav.profile.desc'), status: formatCount('profiles', store.profiles?.length || 0) },
  { id: 'policy', label: t('settings.nav.policy'), description: t('settings.nav.policy.desc'), status: store.approvalConfig ? t('status.ready') : t('status.unknown') },
  { id: 'gateway', label: t('settings.nav.gateway'), description: t('settings.nav.gateway.desc'), status: accessMode.value },
  { id: 'receipts', label: t('settings.nav.receipts'), description: t('settings.nav.receipts.desc'), status: settingsReceipt.value ? t('status.ready') : t('status.waiting') },
]);
const activeSettingsSection = computed({
  get: () => store.activeSectionByPage.settings || 'ui',
  set: (value: string) => store.selectSection('settings', value),
});
const currentSettingsSection = computed(() => settingsSections.value.find((section) => section.id === activeSettingsSection.value) || settingsSections.value[0]);
const modelConfigContract = computed(() => ({
  id: 'settings.runtime.model',
  domain: 'settings',
  title: t('script.pages.settingspage.title.c85f94d40c'),
  endpoint: '/api/config',
  method: 'PUT',
  summary: t('script.pages.settingspage.summary.35f57e71a4'),
  current_return: t('script.pages.settingspage.current_return.c6242b1e2f'),
  validate: t('script.pages.settingspage.validate.d7cfcefbe5'),
  plan: t('script.pages.settingspage.plan.c2d46a5194'),
  dry_run: t('script.pages.settingspage.dry_run.c2d46a5194'),
  live: true,
  live_policy: t('script.pages.settingspage.live_policy.aa8591c5e3'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.settingspage.kernel_boundary.4c58df8773'),
  affected_refs: [configuredModel.value || 'model'],
  fields: [
    { name: 'model', label: t('script.pages.settingspage.label.68c2cc7f0c'), required: true, type: 'text' },
  ],
}));
const approvalPolicyContract = computed(() => ({
  id: 'settings.approval.policy',
  domain: 'settings',
  title: t('script.pages.settingspage.title.2132c55bbb'),
  endpoint: '/api/approval/config',
  method: 'PUT',
  summary: t('script.pages.settingspage.summary.c2b536f6ef'),
  current_return: t('script.pages.settingspage.current_return.d04a65e416'),
  validate: t('script.pages.settingspage.validate.26ede11c60'),
  plan: t('script.pages.settingspage.plan.241f1d5242'),
  dry_run: t('script.pages.settingspage.dry_run.619a4be701'),
  live: true,
  live_policy: t('script.pages.settingspage.live_policy.d17c3160cb'),
  receipt: true,
  audit_ref: true,
  changed_refs: true,
  approval_required: false,
  kernel_boundary: t('script.pages.settingspage.kernel_boundary.154457bed6'),
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
    error: model ? undefined : t('settings.providers.modelRequired'),
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

function selectSettingsSection(id: string) {
  activeSettingsSection.value = id;
}

</script>

<template>
  <section class="settings-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.settings.page.text.f3692b8061') }}</h1>
        <p>{{ t('page.settings.page.text.95b0491db6') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="busyAction === 'providers'" @click="run('providers', store.reloadProviders)">
        <RefreshCw :size="15" />
        {{ t('template.pages.settingspage.13cb300646') }}
      </button>
    </header>

    <p v-if="settingsError" class="settings-alert">{{ settingsError }}</p>
    <PrimaryContextBar :items="settingsContext" density="compact" :max-visible="4" />

    <div class="settings-workbench">
      <aside class="settings-nav" :aria-label="t('settings.nav.aria')">
        <button
          v-for="section in settingsSections"
          :key="section.id"
          type="button"
          :class="{ active: activeSettingsSection === section.id }"
          @click="selectSettingsSection(section.id)"
        >
          <strong>{{ section.label }}</strong>
          <span>{{ section.description }}</span>
          <small>{{ displayStatus(section.status) }}</small>
        </button>
      </aside>

      <div class="settings-content" :data-active-section="activeSettingsSection">
        <header class="settings-content-head">
          <div>
            <h2>{{ currentSettingsSection.label }}</h2>
            <p>{{ currentSettingsSection.description }}</p>
          </div>
          <span class="status-badge">{{ displayStatus(currentSettingsSection.status) }}</span>
        </header>

      <section class="settings-section" data-section="ui">
        <h2>{{ t('page.settings.page.text.3dc3553554') }}</h2>
        <div class="segmented">
          <button :class="{ active: theme === 'light' }" type="button" @click="theme = 'light'"><Sun :size="15" />{{ t('page.settings.page.text.9ee97c311d') }}</button>
          <button :class="{ active: theme === 'dark' }" type="button" @click="theme = 'dark'"><Moon :size="15" />{{ t('page.settings.page.text.cb23796153') }}</button>
        </div>
        <label>
          {{ t('template.pages.settingspage.89b86ab0e6') }}
          <select v-model="uiLocale">
            <option value="zh-CN">{{ t('page.settings.page.text.4eb7bff9a1') }}</option>
            <option value="en-US">{{ t('page.settings.page.text.cfd03d062d') }}</option>
          </select>
        </label>
      </section>

      <section class="settings-section" data-section="providers">
        <h2>{{ t('page.settings.page.text.d5957c1d34') }}</h2>
        <dl class="contract-list">
          <dt>{{ t('page.settings.page.text.2ffa592e62') }}</dt>
          <dd>{{ configuredModel || t('page.settings.page.inline.3be9ccc7cd') }}</dd>
          <dt>{{ t('page.settings.page.text.a1adbaf0bc') }}</dt>
          <dd>{{ store.providers?.configured_model_resolved === false ? t('page.settings.page.inline.ac37db7f63') : (store.controlPlane?.provider_status || t('page.settings.page.inline.3be9ccc7cd')) }}</dd>
          <dt>{{ t('page.settings.page.text.f6742b5c94') }}</dt>
          <dd>{{ providerRows.map((provider) => provider.name).join(', ') || t('status.unknown') }}</dd>
          <dt>{{ t('page.settings.page.text.26ab54433f') }}</dt>
          <dd>{{ store.providers?.provider_model_count ?? store.controlPlane?.provider_model_count ?? 0 }}</dd>
        </dl>
        <label>
          {{ t('template.pages.settingspage.5fbae11ede') }}
          <select v-model="defaultModel">
            <option value="">{{ t('settings.providers.keepCurrent', { model: configuredModel || t('status.unknown') }) }}</option>
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
              <span>{{ provider.protocol || 'openai-compat' }} · {{ formatCount('models', provider.model_count) }} · {{ t('settings.providers.credential') }} {{ provider.credential_present ? t('page.settings.page.inline.aaa6a21074') : t('page.settings.page.inline.c96aea5cbb') }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="settings-section" data-section="profile">
        <h2>{{ t('page.settings.page.text.85e12584dd') }}</h2>
        <div class="profile-create-row">
          <input v-model="profileName" :placeholder="t('page.settings.page.placeholder.bcb07f475e')" @keydown.enter.prevent="addProfile" />
          <button class="ghost-action" type="button" @click="addProfile"><Plus :size="14" />{{ t('page.settings.page.text.a03a2eb536') }}</button>
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
                {{ (profile.id || profile.name) === store.selectedProfile ? t('page.settings.page.inline.74c3bea5b7') : t('page.settings.page.inline.0499f64eb6') }}
              </button>
              <button v-if="(profile.id || profile.name) !== 'default'" class="icon-action danger" type="button" :aria-label="t('settings.profile.delete')" @click="deleteProfile(profile.id || profile.name)">
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="settings-section" data-section="policy">
        <h2>{{ t('page.settings.page.text.9f388e9984') }}</h2>
        <label><input type="checkbox" :checked="!!store.approvalConfig?.solo_mode" @change="toggleSoloGoverned" />{{ t('page.settings.page.text.7c3716e92b') }}</label>
        <textarea :value="approvalJson" spellcheck="false" @change="saveApprovalFromText" />
        <GovernedActionPanel
          :contract="approvalPolicyContract"
          :payload="store.approvalConfig || {}"
          :receipt="settingsReceipt"
          @plan="previewApprovalGoverned"
          @dry-run="previewApprovalGoverned"
          @live="saveApprovalGoverned"
        />
        <p v-if="store.settingsSavedAt" class="save-state">{{ t('page.settings.approval.savedAt', { time: store.settingsSavedAt }) }}</p>
      </section>

      <section class="settings-section" data-section="gateway">
        <h2>{{ t('page.settings.page.text.5b4777815e') }}</h2>
        <p class="security-note"><Shield :size="16" />{{ t('page.settings.page.text.17c5ae3045') }}</p>
        <p class="security-note">{{ t('page.settings.security.origin', { origin }) }}</p>
        <p class="security-note">{{ t('page.settings.security.mode', { mode: accessMode }) }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="verifyAuth">{{ t('page.settings.page.text.1dad098952') }}</button>
        </div>
        <dl v-if="authResult" class="contract-list">
          <dt>{{ t('page.settings.page.text.dcfaad321b') }}</dt>
          <dd>{{ authResult.valid === true ? displayStatus('valid') : (authResult.status ? displayStatus(authResult.status) : authResult.authenticated !== undefined ? displayBoolean(authResult.authenticated) : t('page.settings.page.inline.3be9ccc7cd')) }}</dd>
          <dt>{{ t('page.settings.page.text.b5fb67dcad') }}</dt>
          <dd>{{ authResult.__error || authResult.error || '-' }}</dd>
        </dl>
      </section>

      <section class="settings-section" data-section="receipts">
        <h2>{{ t('page.settings.page.text.13785bef59') }}</h2>
        <RequestReceipt v-if="settingsReceipt" :receipt="settingsReceipt" :title="t('page.settings.page.title.39519790d9')" />
        <section v-else class="request-receipt">
          <header>
            <h2>{{ t('page.settings.page.text.13785bef59') }}</h2>
            <span class="status-badge">{{ t('page.settings.page.text.7ea5c2f871') }}</span>
          </header>
          <p class="empty-note">{{ t('page.settings.page.text.c341133f35') }}</p>
        </section>
        <DetailDrawer :title="t('page.settings.page.title.c2b419daba')" :row="selectedDetail" @close="selectedDetail = null" />
      </section>
      </div>
    </div>
  </section>
</template>
