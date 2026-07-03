<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref, watch } from 'vue';
import { FileText, Languages, RefreshCw, Search } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import { api } from '../api/client';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
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
const facets = computed(() => projection.value?.facets || {});
const sourceFacet = computed(() => Array.from(new Set(items.value.map((skill: any) => skill.source).filter(Boolean))));
const skill = computed(() => detail.value?.skill || filteredItems.value.find((item: any) => item.id === selectedSkillId.value) || {});
const fileItems = computed(() => Array.isArray(files.value?.files) ? files.value.files : []);
const runItems = computed(() => Array.isArray(runs.value?.items) ? runs.value.items : []);
const markdownHtml = computed(() => markdown.render(rawFile.value?.content || ''));
const translatedMarkdown = computed(() => {
  const data = translateResult.value?.data || translateResult.value || {};
  return data.translated_markdown || data.response || data.text || data.content || '';
});
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

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextCatalog, nextProjection, nextRuns] = await Promise.all([
      api.skillCatalog(),
      api.skillProjection(),
      api.skillRuns(),
    ]);
    catalog.value = nextCatalog;
    projection.value = nextProjection;
    runs.value = nextRuns;
    if (!selectedSkillId.value) {
      selectedSkillId.value = nextCatalog?.items?.[0]?.id || '';
    }
    await loadSelectedSkill();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadSelectedSkill() {
  if (!selectedSkillId.value) return;
  const [nextDetail, nextFiles] = await Promise.all([
    api.skillDetail(selectedSkillId.value),
    api.skillFiles(selectedSkillId.value),
  ]);
  detail.value = nextDetail;
  files.value = nextFiles;
  selectedFile.value = fileItems.value.find((file: any) => file.path === 'SKILL.md')?.path
    || nextFiles?.primary
    || fileItems.value.find((file: any) => file.kind === 'file')?.path
    || 'SKILL.md';
  await loadRawFile();
}

async function loadRawFile(path = selectedFile.value) {
  if (!selectedSkillId.value || !path) return;
  selectedFile.value = path;
  rawFile.value = await api.skillFileRaw(selectedSkillId.value, path);
}

async function runAction(action: 'validate' | 'plan' | 'run') {
  if (!selectedSkillId.value) return;
  actionResult.value = await api.skillAction(selectedSkillId.value, action, { session_id: 'webui-skills' });
  await refresh();
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
  } finally {
    translating.value = false;
  }
}

async function loadRunDetail(run: any) {
  const id = run.run_id || run.skill_run_id || run.id;
  if (!id) return;
  selectedRunId.value = id;
  runDetail.value = await api.skillRunDetail(id);
  selectedDetail.value = runDetail.value?.run || run;
}

watch(selectedSkillId, loadSelectedSkill);
onMounted(refresh);
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

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="skillContext" density="compact" :max-visible="4" />
    <WorkflowStrip :steps="skillWorkflow" :title="t('page.skills.page.title.f6cccf3371')" density="compact" />

    <section class="skills-console">
      <aside class="skills-catalog" data-section="catalog">
        <header class="skills-toolbar">
          <label class="search-field">
            <Search :size="15" />
            <input v-model="query" type="search" :placeholder="t('page.skills.page.placeholder.1cb5c73cbd')" />
          </label>
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
      </aside>

      <main class="skills-detail">
        <section class="management-panel" data-section="projection">
          <header>
            <h2>{{ t('page.skills.page.text.e8ec22f1d0') }}</h2>
            <span>{{ skill.scope || t('page.skills.page.inline.12c70558ba') }}</span>
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

        <section class="management-panel" data-section="files">
          <header>
            <h2>{{ t('page.skills.page.text.44a674dcd4') }}</h2>
            <div class="button-row">
              <span>{{ formatCount('entries', fileItems.length) }}</span>
              <button class="icon-action" type="button" :disabled="!rawFile.content || translating" :aria-label="t('page.skills.translate.action')" @click="translateSkill"><Languages :size="14" /></button>
            </div>
          </header>
          <div class="skill-files">
            <button
              v-for="file in fileItems"
              :key="file.path"
              class="file-row compact"
              type="button"
              :disabled="file.kind !== 'file'"
              @click="loadRawFile(file.path)"
            >
              <span><FileText :size="14" /> {{ file.path }}</span>
              <small>{{ file.kind }}{{ file.primary ? t('page.skills.page.inline.fbb83de3b7') : '' }}</small>
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
            <RawPayload :title="t('page.skills.translate.receipt')" :data="translateResult" />
          </article>
        </section>

        <section class="management-panel" data-section="runs">
          <header>
            <h2>{{ t('page.skills.page.text.2ddf474cdf') }}</h2>
            <span>{{ formatCount('runs', runItems.length) }}</span>
          </header>
          <EvidenceTrace :items="skillEvidence" :title="t('page.skills.page.title.9c2c16a5fe')" />
          <div class="run-list">
            <article
              v-for="run in runItems.slice(0, 20)"
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
          <RawPayload :title="t('page.skills.page.title.e903040881')" :data="runDetail || {}" />
          <RequestReceipt :receipt="actionResult || runDetail" :title="t('page.skills.page.title.dbff7b9cc4')" />
          <RawPayload :title="t('page.skills.page.title.cd28167d21')" :data="actionResult || { projection, runs }" />
        </section>

        <section class="management-panel" data-section="governance">
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
          <RequestReceipt :receipt="actionResult || runDetail" :title="t('page.skills.page.title.dbff7b9cc4')" />
          <RawPayload :title="t('page.skills.page.title.cd28167d21')" :data="{ projection, skill, actionResult }" />
        </section>
      </main>
    </section>
  </section>
</template>
