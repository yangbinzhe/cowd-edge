<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, ref, watch } from 'vue';
import { Moon, Plus, Shield, Sun, Trash2 } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { api, invalidateApiReadCache, invalidateAuthentication } from '../api/client';
import { useI18n, type Locale } from '../i18n';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import { displayBoolean, displayStatus } from '../i18n/domain/status';
import { useRoute, useRouter } from 'vue-router';

const store = useAppStore();
const route = useRoute();
const router = useRouter();
const { locale, setLocale } = useI18n();
const profileName = ref('');
const defaultModel = ref('');
const settingsError = ref('');
const busyAction = ref('');
const authResult = ref<any>(null);
const authCredential = ref('');
const settingsReceipt = ref<any>(null);
const selectedDetail = ref<Record<string, unknown> | null>(null);
const lastSavedSection = ref('');
const lastRestoredSection = ref('');
const theme = ref(document.documentElement.dataset.theme || localStorage.getItem('cowd-theme') || 'dark');
const approvalDraft = ref('');
const origin = computed(() => location.origin);
const accessModeLabels = {
  internal: 'settings.access.internal',
  offline: 'settings.access.offline',
  external: 'settings.access.external',
  sameOrigin: 'settings.access.sameOrigin',
} as const;
const accessModeCode = computed(() => {
  if (authResult.value?.valid || authResult.value?.auth_required === false) return 'internal';
  if (authResult.value?.__state && authResult.value.__state !== 'ready') return authResult.value.__state;
  if (authResult.value?.error || authResult.value?.__error) return 'external';
  return 'sameOrigin';
});
const accessMode = computed(() => t(accessModeLabels[accessModeCode.value]));
const forceCredentialReplacement = computed(() => (
  route.query.replaceCredential === '1'
  || route.query.reason === 'forbidden'
));
const gatewayAuthenticationRequired = computed(() => (
  forceCredentialReplacement.value
  || ['required', 'invalidated'].includes(store.authorizationState)
  || String(authResult.value?.__state || '') === 'forbidden'
  || (
    authResult.value?.auth_required === true
    && authResult.value?.valid !== true
  )
));
const providerModels = computed(() => store.providers?.models || []);
const providerRows = computed(() => store.providers?.providers || []);
const providerControl = computed(() => store.controlPlane?.components?.provider || {});
const configuredModel = computed(() => store.providers?.configured_model || providerControl.value.configured_model || store.settings?.model || '');
const settingsContext = computed(() => [
  { label: t('script.pages.settingspage.label.44ab85a252'), value: origin.value },
  { label: t('script.pages.settingspage.label.2f81a22de0'), value: accessMode.value, tone: accessModeCode.value === 'offline' ? 'warn' : 'success' },
  { label: t('script.pages.settingspage.label.87b7c08bae'), value: providerRows.value.length },
  { label: t('config.reload.label'), value: store.configReloadStatus?.status || t('status.unknown'), tone: store.configReloadAttention ? 'warn' : 'success' },
]);
const settingsSections = computed(() => [
  { id: 'ui', label: t('settings.nav.ui'), description: t('settings.nav.ui.desc'), status: theme.value },
  { id: 'providers', label: t('settings.nav.providers'), description: t('settings.nav.providers.desc'), status: providerRows.value.length ? formatCount('models', store.providers?.provider_model_count ?? providerControl.value.model_count ?? 0) : t('status.missing') },
  { id: 'profile', label: t('settings.nav.profile'), description: t('settings.nav.profile.desc'), status: formatCount('profiles', store.profiles?.length || 0) },
  { id: 'policy', label: t('settings.nav.policy'), description: t('settings.nav.policy.desc'), status: approvalDraftError.value ? t('status.invalid') : store.approvalConfig ? t('status.ready') : t('status.unknown') },
  { id: 'gateway', label: t('settings.nav.gateway'), description: t('settings.nav.gateway.desc'), status: accessMode.value },
  { id: 'receipts', label: t('settings.nav.receipts'), description: t('settings.nav.receipts.desc'), status: settingsReceipt.value ? t('status.ready') : t('status.waiting') },
]);
const activeSettingsSection = computed({
  get: () => {
    const querySection = typeof route.query.section === 'string' ? route.query.section : '';
    return settingsSections.value.some((section) => section.id === querySection)
      ? querySection
      : store.activeSectionByPage.settings || 'ui';
  },
  set: (value: string) => {
    store.selectSection('settings', value);
    void router.replace({ query: { ...route.query, section: value } });
  },
});
const currentSettingsSection = computed(() => settingsSections.value.find((section) => section.id === activeSettingsSection.value) || settingsSections.value[0]);
const currentSettingsSaveLabel = computed(() => {
  if (activeSettingsSection.value === 'gateway') return t('settings.action.verifyGateway');
  if (activeSettingsSection.value === 'profile' && !profileName.value.trim()) return t('settings.action.refreshProfiles');
  return t('settings.action.saveCurrent');
});
const currentSettingsRestoreLabel = computed(() => activeSettingsSection.value === 'gateway'
  ? t('settings.action.clearVerification')
  : t('settings.action.restoreCurrent'));
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

const uiLocale = computed({
  get: () => locale.value,
  set: (value: Locale) => {
    setLocale(value);
  },
});

const savedApprovalJson = computed(() => JSON.stringify(store.approvalConfig || {}, null, 2));
const approvalDraftError = computed(() => {
  try {
    JSON.parse(approvalDraft.value || '{}');
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});
const approvalDraftParsed = computed(() => {
  try {
    return JSON.parse(approvalDraft.value || '{}');
  } catch {
    return {};
  }
});
const settingsSectionDirty = computed(() => {
  const section = activeSettingsSection.value;
  if (section === 'ui') return theme.value !== (document.documentElement.dataset.theme || 'dark');
  if (section === 'providers') return !!defaultModel.value && defaultModel.value !== configuredModel.value;
  if (section === 'profile') return !!profileName.value.trim();
  if (section === 'policy') return approvalDraft.value.trim() !== savedApprovalJson.value.trim();
  if (section === 'gateway') return !!authResult.value;
  return false;
});
const settingsSectionState = computed(() => {
  if (settingsSectionDirty.value) return t('settings.state.unsaved');
  if (lastSavedSection.value === activeSettingsSection.value) return t('settings.state.clean');
  if (lastRestoredSection.value === activeSettingsSection.value) return t('settings.state.clean');
  return t('settings.state.clean');
});

function contextWindowOf(model: any) {
  return model?.context_window || model?.contextWindow || model?.max_context_tokens || model?.max_context || model?.context_length || model?.max_tokens || null;
}

function modelOptionContext(model: any) {
  const window = contextWindowOf(model);
  if (!window) return t('settings.providers.contextUnknown');
  const value = Number(window);
  const tokens = Number.isFinite(value) ? value.toLocaleString() : String(window);
  return t('settings.providers.contextWindow', { tokens });
}

function providerProtocolLabel(item: any) {
  return item?.effective_protocol || item?.protocol || t('status.unknown');
}

function providerProtocolSource(item: any) {
  return item?.protocol_configured ? t('settings.providers.protocolExplicit') : t('settings.providers.protocolAuto');
}

function providerProtocolSummary(item: any) {
  return `${providerProtocolLabel(item)} · ${providerProtocolSource(item)}`;
}

function modelOptionLabel(model: any) {
  const id = model.id || model.name;
  const provider = model.provider || t('status.unknown');
  return `${id} · ${provider} · ${providerProtocolSummary(model)} · ${modelOptionContext(model)}`;
}

function markSettingsSaved(section = activeSettingsSection.value) {
  lastSavedSection.value = section;
  lastRestoredSection.value = '';
  store.settingsSavedAt = new Date().toLocaleTimeString();
}

function markSettingsRestored(section = activeSettingsSection.value) {
  lastRestoredSection.value = section;
  lastSavedSection.value = '';
}

watch(
  () => store.approvalConfig,
  (value) => {
    approvalDraft.value = JSON.stringify(value || {}, null, 2);
  },
  { deep: true, immediate: true },
);

watch(() => store.authorizationViewGeneration, () => {
  // Settings remains mounted as the authentication recovery surface, so clear
  // every server-derived local projection without discarding the typed credential.
  settingsError.value = '';
  authResult.value = null;
  settingsReceipt.value = null;
  selectedDetail.value = null;
  defaultModel.value = '';
  profileName.value = '';
  lastSavedSection.value = '';
  lastRestoredSection.value = '';
});

watch([activeSettingsSection, () => store.authorizationState], ([section, authorizationState]) => {
  if (
    section === 'gateway'
    && authorizationState === 'ready'
    && !forceCredentialReplacement.value
    && !authResult.value
  ) void verifyAuth();
}, { immediate: true });

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
    settingsReceipt.value = await api.createProfile(name);
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
    settingsReceipt.value = await api.updateRuntimeConfig({ model });
    defaultModel.value = model;
    await store.refreshRuntimeConfigProjection();
  });
}

async function previewApprovalGoverned(payload: Record<string, unknown> = {}) {
  try {
    const nextConfig = Object.keys(payload).length ? payload : JSON.parse(approvalDraft.value || '{}');
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
    const nextConfig = Object.keys(payload).length ? payload : JSON.parse(approvalDraft.value || '{}');
    settingsReceipt.value = await api.updateApprovalConfig(nextConfig);
    store.approvalConfig = settingsReceipt.value?.data || nextConfig;
    approvalDraft.value = JSON.stringify(store.approvalConfig || nextConfig, null, 2);
  });
}

function updateSoloDraft(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const nextConfig = { ...approvalDraftParsed.value, solo_mode: checked };
  approvalDraft.value = JSON.stringify(nextConfig, null, 2);
}

async function switchProfile(profile: string) {
  await run(`profile-${profile}`, async () => {
    settingsReceipt.value = await api.switchProfile(profile);
    await store.refreshProfiles();
  });
}

async function deleteProfile(id: string) {
  await run(`delete-${id}`, async () => {
    settingsReceipt.value = await api.deleteProfile(id);
    await store.refreshProfiles();
  });
}

async function verifyAuth() {
  if (busyAction.value === 'auth-verify') return;
  await run('auth-verify', async () => {
    authResult.value = await store.verifyAuth();
  });
}

async function loginGateway() {
  await run('auth-login', async () => {
    await store.login(authCredential.value);
    authCredential.value = '';
    authResult.value = await store.verifyAuth();
    if (forceCredentialReplacement.value) {
      const query = { ...route.query };
      delete query.replaceCredential;
      delete query.reason;
      await router.replace({ query });
    }
  });
}

async function logoutGateway() {
  await run('auth-logout', async () => {
    invalidateAuthentication('operator signed out of the Gateway');
    await api.authLogout();
    invalidateApiReadCache();
    authCredential.value = '';
    authResult.value = await store.verifyAuth();
  });
}

async function saveCurrentSettingsSection() {
  const section = activeSettingsSection.value;
  if (section === 'ui') {
    document.documentElement.dataset.theme = theme.value;
    localStorage.setItem('cowd-theme', theme.value);
    setLocale(uiLocale.value);
    settingsReceipt.value = {
      ok: true,
      endpoint: 'localStorage:webui.ui',
      method: 'PUT',
      status: 'saved',
      payload_summary: JSON.stringify({ theme: theme.value, locale: locale.value }),
      retryable: false,
    };
    markSettingsSaved(section);
    return;
  }
  if (section === 'providers') {
    await saveDefaultModel();
    markSettingsSaved(section);
    return;
  }
  if (section === 'profile') {
    if (profileName.value.trim()) await addProfile();
    else await store.refreshProfiles();
    markSettingsSaved(section);
    return;
  }
  if (section === 'policy') {
    if (approvalDraftError.value) {
      settingsError.value = approvalDraftError.value;
      settingsReceipt.value = {
        ok: false,
        endpoint: '/api/approval/config',
        method: 'PUT',
        status: 'invalid',
        error: approvalDraftError.value,
        retryable: false,
      };
      return;
    }
    await saveApprovalGoverned();
    markSettingsSaved(section);
    return;
  }
  if (section === 'gateway') {
    await verifyAuth();
    markSettingsSaved(section);
    return;
  }
  settingsReceipt.value = null;
}

async function restoreCurrentSettingsSection() {
  const section = activeSettingsSection.value;
  if (section === 'ui') {
    theme.value = document.documentElement.dataset.theme || localStorage.getItem('cowd-theme') || 'dark';
    markSettingsRestored(section);
    return;
  }
  if (section === 'providers') {
    await store.refreshRuntimeConfigProjection();
    defaultModel.value = '';
    markSettingsRestored(section);
    return;
  }
  if (section === 'profile') {
    profileName.value = '';
    await store.refreshProfiles();
    markSettingsRestored(section);
    return;
  }
  if (section === 'policy') {
    store.approvalConfig = await api.approvalConfig();
    approvalDraft.value = JSON.stringify(store.approvalConfig || {}, null, 2);
    markSettingsRestored(section);
    return;
  }
  if (section === 'gateway') {
    authResult.value = null;
    markSettingsRestored(section);
    return;
  }
  settingsReceipt.value = null;
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
    </header>

    <p v-if="settingsError" class="settings-alert">{{ settingsError }}</p>

    <div class="settings-workbench">
      <label class="settings-mobile-nav">
        <span>{{ t('settings.nav.aria') }}</span>
        <select v-model="activeSettingsSection">
          <option v-for="section in settingsSections" :key="section.id" :value="section.id">
            {{ section.label }} · {{ section.status }}
          </option>
        </select>
      </label>
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
          <small>{{ section.status }}</small>
        </button>
      </aside>

      <div class="settings-content" :data-active-section="activeSettingsSection">
        <header class="settings-content-head">
          <div>
            <h2>{{ currentSettingsSection.label }}</h2>
            <p>{{ currentSettingsSection.description }}</p>
          </div>
          <span class="status-badge">{{ currentSettingsSection.status }}</span>
        </header>
        <div v-if="activeSettingsSection !== 'receipts'" class="settings-action-rail" :data-dirty="settingsSectionDirty">
          <span class="settings-dirty-state">{{ settingsSectionState }}</span>
          <button class="primary-action" type="button" :disabled="!!busyAction" @click="saveCurrentSettingsSection">
            {{ currentSettingsSaveLabel }}
          </button>
          <button class="ghost-action" type="button" :disabled="!!busyAction" @click="restoreCurrentSettingsSection">
            {{ currentSettingsRestoreLabel }}
          </button>
        </div>

      <section v-if="activeSettingsSection === 'ui'" class="settings-section" data-section="ui">
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

      <section v-else-if="activeSettingsSection === 'providers'" class="settings-section" data-section="providers">
        <h2>{{ t('page.settings.page.text.d5957c1d34') }}</h2>
        <dl class="contract-list">
          <dt>{{ t('page.settings.page.text.2ffa592e62') }}</dt>
          <dd>{{ configuredModel || t('page.settings.page.inline.3be9ccc7cd') }}</dd>
          <dt>{{ t('page.settings.page.text.a1adbaf0bc') }}</dt>
          <dd>{{ store.providers?.configured_model_resolved === false ? t('page.settings.page.inline.ac37db7f63') : (providerControl.status || t('page.settings.page.inline.3be9ccc7cd')) }}</dd>
          <dt>{{ t('page.settings.page.text.f6742b5c94') }}</dt>
          <dd>{{ providerRows.map((provider) => provider.name).join(', ') || t('status.unknown') }}</dd>
          <dt>{{ t('page.settings.page.text.26ab54433f') }}</dt>
          <dd>{{ store.providers?.provider_model_count ?? providerControl.model_count ?? 0 }}</dd>
          <dt>{{ t('config.reload.label') }}</dt>
          <dd>{{ store.configReloadStatus?.status || '-' }} / {{ store.configReloadStatus?.trigger || 'auto' }}</dd>
          <dt>{{ t('config.reload.restartRequired') }}</dt>
          <dd>{{ store.configReloadStatus?.restart_required?.required ? (store.configReloadStatus?.restart_required?.fields || []).join(', ') : t('config.reload.no') }}</dd>
        </dl>
        <label>
          {{ t('template.pages.settingspage.5fbae11ede') }}
          <select v-model="defaultModel">
            <option value="">{{ t('settings.providers.keepCurrent', { model: configuredModel || t('status.unknown') }) }}</option>
            <option v-for="model in providerModels" :key="model.id || model.name" :value="model.id || model.name">
              {{ modelOptionLabel(model) }}
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
              <span>{{ providerProtocolSummary(provider) }} · {{ formatCount('models', provider.model_count) }} · {{ t('settings.providers.credential') }} {{ provider.credential_present ? t('page.settings.page.inline.aaa6a21074') : t('page.settings.page.inline.c96aea5cbb') }}</span>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="activeSettingsSection === 'profile'" class="settings-section" data-section="profile">
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

      <section v-else-if="activeSettingsSection === 'policy'" class="settings-section" data-section="policy">
        <h2>{{ t('page.settings.page.text.9f388e9984') }}</h2>
        <label><input type="checkbox" :checked="!!approvalDraftParsed.solo_mode" @change="updateSoloDraft" />{{ t('page.settings.page.text.7c3716e92b') }}</label>
        <p class="panel-note">{{ t('settings.policy.draftHelp') }}</p>
        <textarea v-model="approvalDraft" spellcheck="false" :aria-invalid="!!approvalDraftError" />
        <p v-if="approvalDraftError" class="field-error">{{ t('settings.policy.invalidJson', { error: approvalDraftError }) }}</p>
        <GovernedActionPanel
          :contract="approvalPolicyContract"
          :payload="approvalDraftParsed"
          :receipt="settingsReceipt"
          @plan="previewApprovalGoverned"
          @dry-run="previewApprovalGoverned"
          @live="saveApprovalGoverned"
        />
        <p v-if="store.settingsSavedAt" class="save-state">{{ t('page.settings.approval.savedAt', { time: store.settingsSavedAt }) }}</p>
      </section>

      <section v-else-if="activeSettingsSection === 'gateway'" class="settings-section" data-section="gateway">
        <h2>{{ t('page.settings.page.text.5b4777815e') }}</h2>
        <p class="security-note"><Shield :size="16" />{{ t('page.settings.page.text.17c5ae3045') }}</p>
        <p class="security-note">{{ t('page.settings.security.origin', { origin }) }}</p>
        <p class="security-note">{{ t('page.settings.security.mode', { mode: accessMode }) }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!!busyAction" @click="verifyAuth">{{ t('page.settings.page.text.1dad098952') }}</button>
          <button v-if="authResult?.valid" class="ghost-action" type="button" @click="logoutGateway">{{ t('settings.gateway.logout') }}</button>
        </div>
        <p v-if="route.query.reason === 'forbidden'" class="security-note" data-gateway-forbidden-recovery>
          {{ t('settings.gateway.capabilityDenied') }}
        </p>
        <form v-if="gatewayAuthenticationRequired" class="gateway-auth-form" @submit.prevent="loginGateway">
          <label>
            <span>{{ t('settings.gateway.credential') }}</span>
            <input v-model="authCredential" type="password" autocomplete="current-password" :placeholder="t('settings.gateway.credentialPlaceholder')" required />
          </label>
          <button class="primary-action" type="submit" :disabled="!authCredential.trim() || busyAction === 'auth-login'">{{ forceCredentialReplacement ? t('settings.gateway.replaceCredential') : t('settings.gateway.login') }}</button>
        </form>
        <p v-if="gatewayAuthenticationRequired" class="panel-note">{{ t('settings.gateway.sessionNotice') }}</p>
        <dl v-if="authResult" class="contract-list">
          <dt>{{ t('page.settings.page.text.dcfaad321b') }}</dt>
          <dd>{{ authResult.valid === true ? displayStatus('valid') : (authResult.status ? displayStatus(authResult.status) : authResult.authenticated !== undefined ? displayBoolean(authResult.authenticated) : t('page.settings.page.inline.3be9ccc7cd')) }}</dd>
          <dt>{{ t('page.settings.page.text.b5fb67dcad') }}</dt>
          <dd>{{ authResult.__error || authResult.error || '-' }}</dd>
        </dl>
      </section>

      <section v-else class="settings-section" data-section="receipts">
        <h2>{{ t('page.settings.page.text.13785bef59') }}</h2>
        <button v-if="settingsReceipt" class="ghost-action" type="button" @click="settingsReceipt = null">{{ t('settings.action.clearReceipt') }}</button>
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
