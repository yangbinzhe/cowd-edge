<script setup lang="ts">
import { useCapabilitySection } from "../composables/useCapabilitySection";
const { activeSection, isSectionActive } = useCapabilitySection();
import { formatCount, t } from '../i18n';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Folder, Languages, PackagePlus, Plus, RefreshCw, Search, ShieldAlert, Trash2, X } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import { api } from '../api/client';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ApiStateBanner from '../components/workbench/ApiStateBanner.vue';
import { displayStatus } from '../i18n/domain/status';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const loading = ref(false);
const error = ref('');
const query = ref('');
const scope = ref('all');
const source = ref('all');
const domain = ref('all');
const tag = ref('all');
const status = ref('all');
const risk = ref('all');
const catalog = ref<any>({});
const projection = ref<any>({});
const runs = ref<any>({});
const detail = ref<any>({});
const files = ref<any>({});
const rawFile = ref<any>({});
const runDetail = ref<any>({});
const selectedSkillId = ref('');
const selectedFile = ref('SKILL.md');
const selectedRunId = ref('');
const actionResult = ref<any>(null);
const translateResult = ref<any>(null);
const translating = ref(false);
const selectedDetail = ref<Record<string, unknown> | null>(null);
const createOpen = ref(false);
const packageInput = ref<HTMLInputElement | null>(null);
const installing = ref(false);
const installOpen = ref(false);
const installSource = ref('');
const pendingPackage = ref<File | null>(null);
const pendingSource = ref('');
const installPlanReceipt = ref<any>(null);
const acceptInstallWarnings = ref(false);
const createName = ref('');
const createDescription = ref('');
const createContent = ref('');
const deleteArmedId = ref('');
const runStatusFilter = ref('all');
const runSkillFilter = ref('all');
const collapsedSkillDirs = ref(new Set<string>());
const loadedSections = new Set<string>();
let hydrationController: AbortController | null = null;
let hydrationGeneration = 0;

const items = computed(() => Array.isArray(catalog.value?.items) ? catalog.value.items : []);
const filteredItems = computed(() => items.value.filter((skill: any) => {
  const text = `${skill.id} ${skill.name} ${skill.description || ''} ${(skill.tags || []).join(' ')}`.toLowerCase();
  if (query.value && !text.includes(query.value.toLowerCase())) return false;
  if (scope.value !== 'all' && skill.scope !== scope.value) return false;
  if (source.value !== 'all' && String(skill.source || '') !== source.value) return false;
  if (domain.value !== 'all' && String(skill.domain || '') !== domain.value) return false;
  if (tag.value !== 'all' && !(skill.tags || []).includes(tag.value)) return false;
  if (status.value !== 'all' && skill.status !== status.value) return false;
  if (risk.value !== 'all' && skill.risk !== risk.value) return false;
  return true;
}));
const facets = computed(() => {
  if (projection.value?.facets) return projection.value.facets;
  const values = (field: string) => Array.from(new Set(
    items.value.map((item: any) => item?.[field]).filter(Boolean),
  ));
  return {
    scopes: values('scope'),
    domains: values('domain'),
    statuses: values('status'),
    risks: values('risk'),
    tags: Array.from(new Set(items.value.flatMap((item: any) => item.tags || []))),
  };
});
const sourceFacet = computed(() => Array.from(new Set(items.value.map((skill: any) => skill.source).filter(Boolean))));
const skill = computed(() => detail.value?.skill || filteredItems.value.find((item: any) => item.id === selectedSkillId.value) || {});
const skillManagement = computed(() => detail.value?.management || {});
const fileItems = computed(() => Array.isArray(files.value?.files) ? files.value.files : []);
const runItems = computed(() => Array.isArray(runs.value?.items) ? runs.value.items : []);
const projectedItems = computed(() => Array.isArray(projection.value?.items) ? projection.value.items : []);
const projectionDiagnostics = computed<string[]>(() => {
  const diagnostics = projection.value?.diagnostics;
  if (Array.isArray(diagnostics)) return diagnostics.map(String);
  if (typeof diagnostics === 'string' && diagnostics.trim()) return [diagnostics];
  return [];
});
const filteredRunItems = computed(() => runItems.value.filter((run: any) => {
  const runStatus = String(run.status || run.outcome || 'unknown');
  const runSkill = String(run.skill_id || run.skill_name || '');
  return (runStatusFilter.value === 'all' || runStatus === runStatusFilter.value)
    && (runSkillFilter.value === 'all' || runSkill === runSkillFilter.value);
}));
const runStatuses = computed(() => Array.from(new Set(
  runItems.value.map((run: any) => String(run.status || run.outcome || 'unknown')),
)));
const runSkills = computed(() => Array.from(new Set(
  runItems.value.map((run: any) => String(run.skill_id || run.skill_name || '')).filter(Boolean),
)));
const skillFileTree = computed(() => {
  const rows = new Map<string, { path: string; name: string; kind: 'dir' | 'file'; depth: number; primary?: boolean }>();
  for (const file of fileItems.value) {
    const path = String(file.path || '').replace(/^\/+|\/+$/g, '');
    if (!path) continue;
    const parts = path.split('/');
    for (let index = 0; index < parts.length - 1; index += 1) {
      const dirPath = parts.slice(0, index + 1).join('/');
      rows.set(dirPath, {
        path: dirPath,
        name: parts[index],
        kind: 'dir',
        depth: index,
      });
    }
    rows.set(path, {
      path,
      name: parts.at(-1) || path,
      kind: 'file',
      depth: parts.length - 1,
      primary: Boolean(file.primary),
    });
  }
  return [...rows.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .filter((row) => {
      const parents = row.path.split('/').slice(0, -1);
      return !parents.some((_, index) => (
        collapsedSkillDirs.value.has(parents.slice(0, index + 1).join('/'))
      ));
    });
});
const markdownHtml = computed(() => markdown.render(rawFile.value?.content || ''));
const translatedMarkdown = computed(() => {
  const data = translateResult.value?.data || translateResult.value || {};
  return data.translated_markdown || data.response || data.text || data.content || '';
});
const cacheHealth = computed(() => projection.value?.cache || {});
const installPlan = computed(() => installPlanReceipt.value?.data?.plan || null);
const installWarnings = computed<string[]>(() => Array.isArray(installPlan.value?.warnings)
  ? installPlan.value.warnings.map(String)
  : []);
const installBlockers = computed<string[]>(() => Array.isArray(installPlan.value?.blockers)
  ? installPlan.value.blockers.map(String)
  : []);
const canCommitInstall = computed(() => Boolean(
  (pendingPackage.value || pendingSource.value)
  && installPlan.value?.installable
  && installPlan.value?.package_digest
  && (!installWarnings.value.length || acceptInstallWarnings.value),
));
const cacheMetrics = computed(() => [
  { label: t('page.skills.cache.resident'), value: formatBytes(cacheHealth.value.resident_bytes) },
  { label: t('page.skills.cache.entries'), value: Number(cacheHealth.value.resident_entries || 0) },
  { label: t('page.skills.cache.hits'), value: Number(cacheHealth.value.hits || 0) },
  { label: t('page.skills.cache.misses'), value: Number(cacheHealth.value.misses || 0) },
  { label: t('page.skills.cache.loads'), value: Number(cacheHealth.value.loads || 0) },
  { label: t('page.skills.cache.failures'), value: Number(cacheHealth.value.failures || 0) },
  { label: t('page.skills.cache.evictions'), value: Number(cacheHealth.value.evictions || 0) },
  { label: t('page.skills.cache.persisted'), value: Number(cacheHealth.value.usage_persisted || 0) },
  { label: t('page.skills.cache.persistenceFailures'), value: Number(cacheHealth.value.usage_persistence_failures || 0) },
]);

function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

function currentSection() {
  return activeSection.value || 'catalog';
}

function sectionKey(section: string, skillId = '') {
  return `${section}:${skillId}`;
}
const skillContext = computed(() => [
  { label: t('page.skills.context.skills'), value: filteredItems.value.length, tone: filteredItems.value.length ? 'success' : 'warn' },
  { label: t('page.skills.context.selected'), value: selectedSkillId.value || t('status.none') },
  { label: t('page.skills.context.files'), value: fileItems.value.length },
  { label: t('page.skills.context.runs'), value: runItems.value.length },
]);
const skillWorkflow = computed(() => [
  { id: 'catalog', label: t('page.skills.workflow.discover'), status: filteredItems.value.length ? 'ready' : 'idle', count: filteredItems.value.length },
  { id: 'projection', label: t('page.skills.workflow.validate'), status: detail.value?.skill ? 'ready' : 'idle', description: selectedSkillId.value || t('status.none') },
  { id: 'projection', label: t('page.skills.workflow.plan'), status: actionResult.value ? 'active' : 'idle' },
  { id: 'runs', label: t('page.skills.workflow.run'), status: runItems.value.length ? 'ready' : 'idle', count: runItems.value.length },
  { id: 'governance', label: t('page.skills.workflow.audit'), status: runDetail.value?.id ? 'ready' : 'idle' },
]);
const skillActionContract = computed(() => ({
  id: 'skills.action.run',
  domain: 'skills',
  title: t('page.skills.contract.runTitle'),
  endpoint: selectedSkillId.value ? `/api/skills/${encodeURIComponent(selectedSkillId.value)}/action` : '/api/skills/:id/action',
  method: 'POST',
  summary: t('page.skills.contract.summary'),
  current_return: t('page.skills.contract.return'),
  validate: t('page.skills.contract.validate'),
  plan: t('page.skills.contract.plan'),
  dry_run: t('page.skills.contract.plan'),
  live: true,
  live_policy: t('page.skills.contract.livePolicy'),
  receipt: true,
  audit_ref: true,
  changed_refs: false,
  approval_required: String(skill.value?.risk || '').toLowerCase().includes('high'),
  kernel_boundary: t('page.skills.contract.boundary'),
  affected_refs: [selectedSkillId.value, skill.value?.path, skill.value?.source].filter(Boolean),
  fields: [
    { name: 'session_id', label: t('page.skills.field.sessionId'), required: true, type: 'text' },
    { name: 'skill_id', label: t('page.skills.field.skillId'), required: true, type: 'text' },
  ],
}));
const skillEvidence = computed(() => [
  {
    id: selectedSkillId.value,
    kind: 'skill',
    status: skill.value?.status || 'selected',
    summary: skill.value?.description || skill.value?.name || selectedSkillId.value || 'no selected skill',
    source: skill.value?.source || 'gateway.skills',
  },
  ...runItems.value.slice(0, 3).map((run: any) => ({
    id: run.run_id || run.skill_run_id || run.id,
    kind: 'skill run',
    status: run.status || run.outcome || 'recorded',
    summary: run.skill_id || run.skill_name || selectedSkillId.value,
    source: 'gateway.skills.runs',
  })),
].filter((item) => item.id || item.summary));

async function refreshCatalog() {
  catalog.value = await api.skillCatalog();
  if (selectedSkillId.value && !items.value.some((item: any) => item.id === selectedSkillId.value)) {
    selectedSkillId.value = '';
  }
  if (!selectedSkillId.value) selectedSkillId.value = String(items.value[0]?.id || '');
}

async function hydrateSection(section = currentSection(), force = false) {
  if (section === 'catalog') return;
  const skillId = selectedSkillId.value;
  const globalKey = sectionKey(section);
  if (section === 'runs' && !force && loadedSections.has(globalKey)) return;

  hydrationController?.abort();
  const controller = new AbortController();
  hydrationController = controller;
  const generation = ++hydrationGeneration;
  const current = () => (
    hydrationController === controller
    && hydrationGeneration === generation
    && !controller.signal.aborted
    && selectedSkillId.value === skillId
    && currentSection() === section
  );

  try {
    if (section === 'runs') {
      const nextRuns = await api.skillRuns(controller.signal);
      if (!current()) return;
      runs.value = nextRuns;
      loadedSections.add(globalKey);
    } else if (section === 'projection' || section === 'governance') {
      const needsProjection = force || !loadedSections.has(sectionKey('projection'));
      const [nextProjection, nextDetail] = await Promise.all([
        needsProjection
          ? api.skillProjection(controller.signal)
          : Promise.resolve(projection.value),
        skillId
          ? api.skillDetail(skillId, controller.signal)
          : Promise.resolve({}),
      ]);
      if (!current()) return;
      projection.value = nextProjection;
      detail.value = nextDetail;
      if (needsProjection) loadedSections.add(sectionKey('projection'));
    } else if (section === 'files' && skillId) {
      await loadSelectedSkillFiles(skillId, controller, generation);
    }
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
    throw err;
  } finally {
    if (hydrationController === controller) hydrationController = null;
  }
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    loadedSections.clear();
    await refreshCatalog();
    await hydrateSection(currentSection(), true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadSelectedSkillFiles(
  skillId = selectedSkillId.value,
  controller = new AbortController(),
  generation = ++hydrationGeneration,
) {
  if (!skillId) return;
  const ownsController = hydrationController !== controller;
  if (ownsController) {
    hydrationController?.abort();
    hydrationController = controller;
  }
  const current = () => (
    hydrationController === controller
    && hydrationGeneration === generation
    && !controller.signal.aborted
    && selectedSkillId.value === skillId
  );
  const [nextDetail, nextFiles] = await Promise.all([
    api.skillDetail(skillId, controller.signal),
    api.skillFiles(skillId, controller.signal),
  ]);
  if (!current()) return;
  detail.value = nextDetail;
  files.value = nextFiles;
  selectedFile.value = fileItems.value.find((file: any) => file.path === 'SKILL.md')?.path
    || nextFiles?.primary
    || fileItems.value.find((file: any) => file.kind === 'file')?.path
    || 'SKILL.md';
  const nextRaw = await api.skillFileRaw(skillId, selectedFile.value, controller.signal);
  if (!current()) return;
  rawFile.value = nextRaw;
}

async function loadRawFile(path = selectedFile.value) {
  if (!selectedSkillId.value || !path) return;
  hydrationController?.abort();
  const controller = new AbortController();
  hydrationController = controller;
  const generation = ++hydrationGeneration;
  const skillId = selectedSkillId.value;
  selectedFile.value = path;
  try {
    const nextRaw = await api.skillFileRaw(skillId, path, controller.signal);
    if (
      hydrationController === controller
      && hydrationGeneration === generation
      && selectedSkillId.value === skillId
      && selectedFile.value === path
    ) rawFile.value = nextRaw;
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
    throw err;
  } finally {
    if (hydrationController === controller) hydrationController = null;
  }
}

async function runAction(action: 'validate' | 'plan' | 'run') {
  if (!selectedSkillId.value) return;
  actionResult.value = await api.skillAction(selectedSkillId.value, action, { session_id: 'webui-skills' });
  loadedSections.delete(sectionKey('runs'));
  if (currentSection() === 'runs') await hydrateSection('runs', true);
}

async function translateSkill() {
  if (!selectedSkillId.value || !rawFile.value?.content) return;
  translating.value = true;
  try {
    translateResult.value = await api.skillTranslate(
      selectedSkillId.value,
      String(rawFile.value.content),
      rawFile.value.path || selectedFile.value || 'SKILL.md',
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    translating.value = false;
  }
}

async function planSkillPackage(files: FileList | null) {
  const file = files?.[0];
  if (!file) return;
  installing.value = true;
  error.value = '';
  installPlanReceipt.value = null;
  acceptInstallWarnings.value = false;
  installOpen.value = true;
  pendingSource.value = '';
  pendingPackage.value = file;
  try {
    const receipt = await api.planSkillUpload(file);
    actionResult.value = receipt;
    installPlanReceipt.value = receipt;
    if (!receipt?.ok) {
      error.value = receipt?.error || t('page.skills.install.planFailed');
      pendingPackage.value = null;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    pendingPackage.value = null;
  } finally {
    installing.value = false;
    if (packageInput.value) packageInput.value.value = '';
  }
}

async function planSkillSource() {
  const source = installSource.value.trim();
  if (!source) {
    error.value = t('page.skills.install.sourceRequired');
    return;
  }
  installing.value = true;
  error.value = '';
  installPlanReceipt.value = null;
  acceptInstallWarnings.value = false;
  pendingPackage.value = null;
  pendingSource.value = source;
  try {
    const receipt = await api.planSkillInstall(source);
    actionResult.value = receipt;
    installPlanReceipt.value = receipt;
    if (!receipt?.ok) {
      error.value = receipt?.error || t('page.skills.install.planFailed');
      pendingSource.value = '';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    pendingSource.value = '';
  } finally {
    installing.value = false;
  }
}

async function commitSkillPackage() {
  if ((!pendingPackage.value && !pendingSource.value) || !installPlan.value?.package_digest || !canCommitInstall.value) return;
  installing.value = true;
  error.value = '';
  try {
    const receipt = pendingPackage.value
      ? await api.commitSkillUpload(
        pendingPackage.value,
        String(installPlan.value.package_digest),
        acceptInstallWarnings.value,
      )
      : await api.commitSkillInstall(
        pendingSource.value,
        String(installPlan.value.package_digest),
        acceptInstallWarnings.value,
      );
    actionResult.value = receipt;
    if (!receipt?.ok) {
      error.value = receipt?.error || t('page.skills.install.commitFailed');
      return;
    }
    const installedSkillId = String(receipt?.data?.receipt?.skill_id || '');
    discardInstallPlan();
    loadedSections.clear();
    await refreshCatalog();
    if (installedSkillId) selectedSkillId.value = installedSkillId;
    await hydrateSection(currentSection(), true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    installing.value = false;
  }
}

function discardInstallPlan() {
  installOpen.value = false;
  installSource.value = '';
  pendingPackage.value = null;
  pendingSource.value = '';
  installPlanReceipt.value = null;
  acceptInstallWarnings.value = false;
  if (packageInput.value) packageInput.value.value = '';
}

function toggleSkillDir(path: string) {
  const next = new Set(collapsedSkillDirs.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedSkillDirs.value = next;
}

async function createSkill() {
  const name = createName.value.trim();
  const description = createDescription.value.trim();
  if (!name || !description) {
    error.value = t('page.skills.management.required');
    return;
  }
  actionResult.value = await api.createSkill({
    name,
    description,
    content: createContent.value.trim() || undefined,
  });
  createOpen.value = false;
  createName.value = '';
  createDescription.value = '';
  createContent.value = '';
  selectedSkillId.value = `local:${name}`;
  loadedSections.clear();
  await refreshCatalog();
  await hydrateSection(currentSection(), true);
}

async function deleteSelectedSkill() {
  if (!selectedSkillId.value || !skillManagement.value.can_delete) return;
  if (deleteArmedId.value !== selectedSkillId.value) {
    deleteArmedId.value = selectedSkillId.value;
    return;
  }
  actionResult.value = await api.deleteSkill(selectedSkillId.value);
  deleteArmedId.value = '';
  selectedSkillId.value = '';
  detail.value = {};
  files.value = {};
  rawFile.value = {};
  loadedSections.clear();
  await refreshCatalog();
  await hydrateSection(currentSection(), true);
}

async function loadRunDetail(run: any) {
  const id = run.run_id || run.skill_run_id || run.id;
  if (!id) return;
  selectedRunId.value = id;
  runDetail.value = await api.skillRunDetail(id);
  selectedDetail.value = runDetail.value?.run || run;
}

watch(activeSection, (section) => {
  hydrationController?.abort();
  hydrateSection(section || 'catalog').catch((err) => {
    error.value = err instanceof Error ? err.message : String(err);
  });
});
watch(selectedSkillId, () => {
  detail.value = {};
  files.value = {};
  rawFile.value = {};
  translateResult.value = null;
  // Initial catalog hydration already owns the section request. Starting a
  // second watcher request here can abort both chains under real network
  // latency and leave a deep-linked section empty.
  if (loading.value) return;
  hydrateSection(currentSection(), false).catch((err) => {
    error.value = err instanceof Error ? err.message : String(err);
  });
});
onMounted(refresh);
onUnmounted(() => hydrationController?.abort());
</script>

<template>
  <section class="capability-page skills-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.skills.page.text.a7401cf98e') }}</h1>
        <p>{{ t('page.skills.page.text.06edbf7515') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.skills.page.inline.14ddbdb750') : t('page.skills.page.inline.c9ba107238') }}
      </button>
    </header>

    <ApiStateBanner v-if="error" status="degraded" :title="t('skills.state.errorTitle')" :detail="error" endpoint="/api/skills" />
    <ApiStateBanner v-else-if="loading && !items.length" status="loading" :title="t('skills.state.loadingTitle')" :detail="t('skills.state.loadingDetail')" />

    <section class="skills-console">
      <aside
        class="skills-catalog"
        data-section="catalog"
        data-section-visibility="persistent"
      >
        <header class="skills-toolbar">
          <div class="skills-toolbar-head">
            <label class="search-field">
              <Search :size="15" />
              <input v-model="query" type="search" :placeholder="t('page.skills.page.placeholder.1cb5c73cbd')" />
            </label>
            <button class="icon-action" type="button" :title="t('page.skills.management.create')" :aria-label="t('page.skills.management.create')" @click="createOpen = !createOpen">
              <X v-if="createOpen" :size="15" />
              <Plus v-else :size="15" />
            </button>
            <button class="icon-action" type="button" :disabled="installing" :title="t('page.skills.management.install')" :aria-label="t('page.skills.management.install')" @click="installOpen = !installOpen">
              <RefreshCw v-if="installing" :size="15" class="spinning" />
              <PackagePlus v-else :size="15" />
            </button>
            <input ref="packageInput" class="visually-hidden" type="file" accept=".tar,application/x-tar" @change="planSkillPackage(($event.target as HTMLInputElement).files)" />
          </div>
          <div class="filter-row">
            <select v-model="scope">
              <option value="all">{{ t('page.skills.page.text.36f7b52cfe') }}</option>
              <option v-for="item in facets.scopes || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="source">
              <option value="all">{{ t('page.skills.page.text.4191d3d258') }}</option>
              <option v-for="item in sourceFacet" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="domain">
              <option value="all">{{ t('page.skills.page.text.f104bdb5fa') }}</option>
              <option v-for="item in facets.domains || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="tag">
              <option value="all">{{ t('page.skills.page.text.c131e2ab10') }}</option>
              <option v-for="item in facets.tags || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="status">
              <option value="all">{{ t('page.skills.page.text.371c169ca3') }}</option>
              <option v-for="item in facets.statuses || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="risk">
              <option value="all">{{ t('page.skills.page.text.943ec87bc7') }}</option>
              <option v-for="item in facets.risks || []" :key="item" :value="item">{{ item }}</option>
            </select>
          </div>
        </header>

        <section v-if="createOpen" class="management-panel skill-create-panel">
          <header>
            <h2>{{ t('page.skills.management.create') }}</h2>
          </header>
          <label class="field-line">
            {{ t('page.skills.management.name') }}
            <input v-model="createName" type="text" maxlength="64" :placeholder="t('page.skills.management.namePlaceholder')" />
          </label>
          <label class="field-line">
            {{ t('page.skills.management.description') }}
            <input v-model="createDescription" type="text" :placeholder="t('page.skills.management.descriptionPlaceholder')" />
          </label>
          <label class="field-line">
            {{ t('page.skills.management.content') }}
            <textarea v-model="createContent" rows="6" :placeholder="t('page.skills.management.contentPlaceholder')" />
          </label>
          <div class="button-row">
            <button class="primary-action" type="button" @click="createSkill">
              <Plus :size="15" />
              {{ t('page.skills.management.create') }}
            </button>
          </div>
        </section>

        <section v-if="installOpen && !installPlan" class="management-panel skill-install-source">
          <header>
            <div>
              <h2>{{ t('page.skills.management.install') }}</h2>
              <p>{{ t('page.skills.install.sourceHint') }}</p>
            </div>
            <button class="icon-action" type="button" :aria-label="t('page.skills.install.cancel')" @click="discardInstallPlan">
              <X :size="15" />
            </button>
          </header>
          <label class="field-line">
            {{ t('page.skills.install.source') }}
            <input v-model="installSource" type="text" :placeholder="t('page.skills.install.sourcePlaceholder')" @keydown.enter.prevent="planSkillSource" />
          </label>
          <div class="button-row">
            <button class="ghost-action" type="button" :disabled="installing" @click="packageInput?.click()">
              <PackagePlus :size="15" />
              {{ t('page.skills.install.chooseFile') }}
            </button>
            <button class="primary-action" data-action="plan-skill-source" type="button" :disabled="installing || !installSource.trim()" @click="planSkillSource">
              <RefreshCw v-if="installing" :size="15" class="spinning" />
              <ShieldAlert v-else :size="15" />
              {{ t('page.skills.install.reviewSource') }}
            </button>
          </div>
        </section>

        <section v-if="installPlan" class="management-panel skill-install-review" aria-live="polite">
          <header>
            <div>
              <h2>{{ t('page.skills.install.reviewTitle') }}</h2>
              <p>{{ pendingPackage?.name || pendingSource }}</p>
            </div>
            <button class="icon-action" type="button" :aria-label="t('page.skills.install.cancel')" @click="discardInstallPlan">
              <X :size="15" />
            </button>
          </header>
          <dl class="detail-list compact">
            <dt>{{ t('page.skills.install.skill') }}</dt>
            <dd>{{ installPlan.name }} <small>{{ installPlan.skill_id }}</small></dd>
            <dt>{{ t('page.skills.install.class') }}</dt>
            <dd>{{ installPlan.package_class }}</dd>
            <dt>{{ t('page.skills.install.contents') }}</dt>
            <dd>{{ formatCount('files', installPlan.files?.length || 0) }} · {{ formatBytes(installPlan.total_bytes) }}</dd>
            <dt>{{ t('page.skills.install.digest') }}</dt>
            <dd class="install-digest">{{ installPlan.package_digest }}</dd>
          </dl>
          <ApiStateBanner
            v-if="installBlockers.length"
            status="degraded"
            :title="t('page.skills.install.blocked')"
            :detail="installBlockers.join(' · ')"
          />
          <div v-else-if="installWarnings.length" class="install-review-warning">
            <ShieldAlert :size="16" />
            <div>
              <strong>{{ t('page.skills.install.warningTitle') }}</strong>
              <ul>
                <li v-for="warning in installWarnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>
          </div>
          <div v-else class="install-review-safe">
            <CheckCircle2 :size="16" />
            <span>{{ t('page.skills.install.safe') }}</span>
          </div>
          <label v-if="installWarnings.length && !installBlockers.length" class="install-warning-consent">
            <input v-model="acceptInstallWarnings" type="checkbox" />
            <span>{{ t('page.skills.install.acceptWarnings') }}</span>
          </label>
          <div class="button-row">
            <button class="ghost-action" type="button" :disabled="installing" @click="discardInstallPlan">
              {{ t('page.skills.install.cancel') }}
            </button>
            <button class="primary-action" data-action="commit-skill-install" type="button" :disabled="installing || !canCommitInstall" @click="commitSkillPackage">
              <RefreshCw v-if="installing" :size="15" class="spinning" />
              <PackagePlus v-else :size="15" />
              {{ installing ? t('page.skills.install.installing') : t('page.skills.install.commit') }}
            </button>
          </div>
        </section>

        <button
          v-for="item in filteredItems"
          :key="item.id"
          class="skill-row"
          :class="{ active: selectedSkillId === item.id }"
          type="button"
          @click="selectedSkillId = item.id"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.description || item.source }}</span>
          <small>{{ item.scope }} · {{ displayStatus(item.status) }} · {{ displayStatus(item.risk) }}</small>
        </button>
        <EmptyState
          v-if="!loading && !filteredItems.length"
          :title="items.length ? t('page.skills.empty.filteredTitle') : t('page.skills.empty.catalogTitle')"
          :detail="items.length ? t('page.skills.empty.filteredDetail') : t('page.skills.empty.catalogDetail')"
        />
      </aside>

      <main class="skills-detail">
        <section
          class="management-panel"
          v-show="isSectionActive('catalog')"
        >
          <header>
            <h2>{{ t('page.skills.page.text.e8ec22f1d0') }}</h2>
            <div class="button-row">
              <span>{{ skill.scope || t('page.skills.page.inline.12c70558ba') }}</span>
              <button
                v-if="skillManagement.can_delete"
                class="danger-action"
                type="button"
                :title="t('page.skills.management.delete')"
                @click="deleteSelectedSkill"
              >
                <Trash2 :size="14" />
                {{ deleteArmedId === selectedSkillId ? t('page.skills.management.confirmDelete') : t('page.skills.management.delete') }}
              </button>
            </div>
          </header>
          <dl class="detail-list">
            <dt>{{ t('page.skills.page.text.6ec338f842') }}</dt>
            <dd>{{ skill.name || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.179e35f2fe') }}</dt>
            <dd>{{ skill.source || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.a7caf808cc') }}</dt>
            <dd>{{ skill.path || 'virtual' }}</dd>
            <dt>{{ t('page.skills.page.text.0b401db7fc') }}</dt>
            <dd>{{ skill.domain || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.a88ae0bc11') }}</dt>
            <dd>{{ (skill.tags || []).join(', ') || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.64714a76ce') }}</dt>
            <dd>{{ (skill.tools || []).join(', ') || '-' }}</dd>
          </dl>
          <GovernedActionPanel
            :contract="skillActionContract"
            :payload="{ session_id: 'webui-skills', skill_id: selectedSkillId }"
            :receipt="actionResult"
            @plan="runAction('validate')"
            @dry-run="runAction('plan')"
            @live="runAction('run')"
          />
          <RequestReceipt :receipt="actionResult" :title="t('page.skills.page.title.09895e511f')" />
        </section>

        <section class="management-panel" v-show="isSectionActive('projection')" data-section="projection">
          <header>
            <div>
              <h2>{{ t('page.skills.projection.title') }}</h2>
              <p>{{ t('page.skills.projection.description') }}</p>
            </div>
            <span>{{ formatCount('skills', projectedItems.length) }}</span>
          </header>
          <div class="metric-row compact">
            <article class="metric-card">
              <small>{{ t('page.skills.projection.catalogCount') }}</small>
              <strong>{{ Number(projection.catalog_count || items.length) }}</strong>
            </article>
            <article class="metric-card">
              <small>{{ t('page.skills.projection.visibleCount') }}</small>
              <strong>{{ projectedItems.length }}</strong>
            </article>
            <article class="metric-card">
              <small>{{ t('page.skills.projection.surface') }}</small>
              <strong>{{ projection.surface || 'webui' }}</strong>
            </article>
          </div>
          <div class="skill-projection-list">
            <article v-for="item in projectedItems" :key="item.id">
              <div>
                <strong>{{ item.name }}</strong>
                <p>{{ item.description || item.source }}</p>
              </div>
              <StatusPill :status="item.status || 'ready'" />
              <small>{{ item.scope }} · {{ item.source }}</small>
            </article>
          </div>
          <ApiStateBanner
            v-if="projectionDiagnostics.length"
            status="degraded"
            :title="t('page.skills.projection.diagnostics')"
            :detail="projectionDiagnostics.join(' · ')"
          />
          <ObjectInspectorDrawer :title="t('page.skills.projection.activation')" :data="projection.activation || {}" />
        </section>

        <section class="management-panel" v-show="isSectionActive('files')" data-section="files">
          <header>
            <h2>{{ t('page.skills.page.text.44a674dcd4') }}</h2>
            <div class="button-row">
              <span>{{ formatCount('entries', fileItems.length) }}</span>
              <button class="icon-action" type="button" :disabled="!rawFile.content || translating" :aria-label="t('page.skills.translate.action')" @click="translateSkill"><Languages :size="14" /></button>
            </div>
          </header>
          <div class="skill-file-tree" role="tree" :aria-label="t('page.skills.files.tree')">
            <button
              v-for="file in skillFileTree"
              :key="file.path"
              class="skill-file-tree-row"
              :class="{ active: selectedFile === file.path }"
              :style="{ '--skill-file-depth': file.depth }"
              type="button"
              @click="file.kind === 'dir' ? toggleSkillDir(file.path) : loadRawFile(file.path)"
            >
              <ChevronRight v-if="file.kind === 'dir' && collapsedSkillDirs.has(file.path)" :size="13" />
              <ChevronDown v-else-if="file.kind === 'dir'" :size="13" />
              <span v-else class="skill-file-tree-spacer"></span>
              <Folder v-if="file.kind === 'dir'" :size="14" />
              <FileText v-else :size="14" />
              <span>{{ file.name }}</span>
              <small>{{ file.primary ? t('page.skills.page.inline.fbb83de3b7') : '' }}</small>
            </button>
          </div>
          <article class="skill-markdown">
            <header>
              <strong>{{ rawFile.path || selectedFile }}</strong>
            </header>
            <div v-if="rawFile.content" class="markdown-body" v-html="markdownHtml"></div>
            <pre v-else>{{ rawFile.content || '' }}</pre>
          </article>
          <article v-if="translateResult" class="skill-markdown">
            <header>
              <strong>{{ t('page.skills.translate.result') }}</strong>
            </header>
            <div v-if="translatedMarkdown" class="markdown-body" v-html="markdown.render(translatedMarkdown)"></div>
            <ObjectInspectorDrawer :title="t('page.skills.translate.receipt')" :data="translateResult" />
          </article>
        </section>

        <section class="management-panel" v-show="isSectionActive('runs')" data-section="runs">
          <header>
            <h2>{{ t('page.skills.page.text.2ddf474cdf') }}</h2>
            <span>{{ formatCount('runs', runItems.length) }}</span>
          </header>
          <div class="filter-row skill-run-filters">
            <label>
              <span>{{ t('page.skills.runs.status') }}</span>
              <select v-model="runStatusFilter">
                <option value="all">{{ t('common.all') }}</option>
                <option v-for="item in runStatuses" :key="item" :value="item">{{ displayStatus(item) }}</option>
              </select>
            </label>
            <label>
              <span>{{ t('page.skills.runs.skill') }}</span>
              <select v-model="runSkillFilter">
                <option value="all">{{ t('common.all') }}</option>
                <option v-for="item in runSkills" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
          </div>
          <EvidenceTrace :items="skillEvidence" :title="t('page.skills.page.title.9c2c16a5fe')" />
          <div class="run-list">
            <article
              v-for="run in filteredRunItems.slice(0, 50)"
              :key="run.run_id || run.skill_run_id || run.id"
              :class="{ active: selectedRunId === (run.run_id || run.skill_run_id || run.id) }"
              role="button"
              tabindex="0"
              @click="loadRunDetail(run)"
              @keydown.enter.prevent="loadRunDetail(run)"
            >
              <strong>{{ run.skill_id || run.skill_name || run.id }}</strong>
              <span>{{ run.status || run.outcome ? displayStatus(run.status || run.outcome) : t('page.skills.page.inline.34f5cf4d66') }}</span>
            </article>
          </div>
          <DetailDrawer :title="t('page.skills.page.title.14b2c03b91')" :row="selectedDetail || skill" @close="selectedDetail = null" />
          <ObjectInspectorDrawer :title="t('page.skills.page.title.e903040881')" :data="runDetail || {}" />
          <RequestReceipt :receipt="actionResult || runDetail" :title="t('page.skills.page.title.dbff7b9cc4')" />
          <ObjectInspectorDrawer :title="t('page.skills.page.title.cd28167d21')" :data="actionResult || { projection, runs }" />
        </section>

        <section class="management-panel" v-show="isSectionActive('governance')" data-section="governance">
          <header>
            <h2>{{ t('script.data.capabilities.label.823619e079') }}</h2>
            <StatusPill :status="skill.risk || skill.status || 'policy'" />
          </header>
          <dl class="detail-list">
            <dt>{{ t('page.skills.page.text.6ec338f842') }}</dt>
            <dd>{{ skill.name || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.64714a76ce') }}</dt>
            <dd>{{ (skill.tools || []).join(', ') || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.0b401db7fc') }}</dt>
            <dd>{{ skill.domain || '-' }}</dd>
            <dt>{{ t('page.skills.page.text.943ec87bc7') }}</dt>
            <dd>{{ displayStatus(skill.risk || 'policy') }}</dd>
          </dl>
          <EvidenceTrace :items="skillEvidence" :title="t('page.skills.page.title.9c2c16a5fe')" />
          <div class="button-row">
            <button class="ghost-action" type="button" :disabled="!selectedSkillId" @click="runAction('validate')">
              {{ t('page.skills.governance.validate') }}
            </button>
            <button class="ghost-action" type="button" :disabled="!selectedSkillId" @click="runAction('plan')">
              {{ t('page.skills.governance.plan') }}
            </button>
          </div>
          <section :aria-label="t('page.skills.cache.title')">
            <h3>{{ t('page.skills.cache.title') }}</h3>
            <dl class="detail-list">
              <template v-for="metric in cacheMetrics" :key="metric.label">
                <dt>{{ metric.label }}</dt>
                <dd>{{ metric.value }}</dd>
              </template>
            </dl>
          </section>
          <RequestReceipt :receipt="actionResult || runDetail" :title="t('page.skills.page.title.dbff7b9cc4')" />
          <ObjectInspectorDrawer :title="t('page.skills.page.title.cd28167d21')" :data="{ projection, skill, actionResult }" />
        </section>
      </main>
    </section>
  </section>
</template>
