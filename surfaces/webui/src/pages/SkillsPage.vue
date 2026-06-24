<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { FileText, RefreshCw, Search } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import { api } from '../api/client';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';

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
const skillContext = computed(() => [
  { label: 'Skills', value: filteredItems.value.length, tone: filteredItems.value.length ? 'success' : 'warn' },
  { label: 'Selected', value: selectedSkillId.value || 'none' },
  { label: 'Files', value: fileItems.value.length },
  { label: 'Runs', value: runItems.value.length },
]);
const skillWorkflow = computed(() => [
  { id: 'catalog', label: 'Discover', status: filteredItems.value.length ? 'ready' : 'idle', count: filteredItems.value.length },
  { id: 'projection', label: 'Validate', status: detail.value?.skill ? 'ready' : 'idle', description: selectedSkillId.value || 'none' },
  { id: 'projection', label: 'Plan', status: actionResult.value ? 'active' : 'idle' },
  { id: 'runs', label: 'Run', status: runItems.value.length ? 'ready' : 'idle', count: runItems.value.length },
  { id: 'governance', label: 'Audit', status: runDetail.value?.id ? 'ready' : 'idle' },
]);
const skillActionContract = computed(() => ({
  id: 'skills.action.run',
  domain: 'skills',
  title: 'Run skill action',
  endpoint: selectedSkillId.value ? `/api/skills/${encodeURIComponent(selectedSkillId.value)}/action` : '/api/skills/:id/action',
  method: 'POST',
  summary: 'Validate and plan before running skill instructions. Live run is governed because it may invoke tools and affect runtime work.',
  current_return: 'Skill action receipt and optional run record',
  validate: 'validate action',
  plan: 'plan action',
  dry_run: 'plan action',
  live: true,
  live_policy: 'requires selected skill, action receipt, and run trace',
  receipt: true,
  audit_ref: true,
  changed_refs: false,
  approval_required: String(skill.value?.risk || '').toLowerCase().includes('high'),
  kernel_boundary: 'Gateway skill service',
  affected_refs: [selectedSkillId.value, skill.value?.path, skill.value?.source].filter(Boolean),
  fields: [
    { name: 'session_id', label: 'Session id', required: true, type: 'text' },
    { name: 'skill_id', label: 'Skill id', required: true, type: 'text' },
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
  selectedFile.value = nextFiles?.primary || fileItems.value.find((file: any) => file.kind === 'file')?.path || 'SKILL.md';
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
        <h1>Skills Console</h1>
        <p>技能全集、分类、文件、运行记录和治理状态集中管理。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh skills' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="skillContext" />
    <WorkflowStrip :steps="skillWorkflow" title="Skill lifecycle" />

    <section class="skills-console" data-section="catalog">
      <aside class="skills-catalog">
        <header class="skills-toolbar">
          <label class="search-field">
            <Search :size="15" />
            <input v-model="query" type="search" placeholder="Search skills" />
          </label>
          <div class="filter-row">
            <select v-model="scope">
              <option value="all">all scopes</option>
              <option v-for="item in facets.scopes || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="source">
              <option value="all">all sources</option>
              <option v-for="item in sourceFacet" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="domain">
              <option value="all">all domains</option>
              <option v-for="item in facets.domains || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="tag">
              <option value="all">all tags</option>
              <option v-for="item in facets.tags || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="status">
              <option value="all">all statuses</option>
              <option v-for="item in facets.statuses || []" :key="item" :value="item">{{ item }}</option>
            </select>
            <select v-model="risk">
              <option value="all">all risks</option>
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
          <small>{{ item.scope }} · {{ item.status }} · {{ item.risk }}</small>
        </button>
      </aside>

      <main class="skills-detail">
        <section class="management-panel" data-section="projection">
          <header>
            <h2>Detail</h2>
            <span>{{ skill.scope || 'unknown' }}</span>
          </header>
          <dl class="detail-list">
            <dt>Name</dt>
            <dd>{{ skill.name || '-' }}</dd>
            <dt>Source</dt>
            <dd>{{ skill.source || '-' }}</dd>
            <dt>Path</dt>
            <dd>{{ skill.path || 'virtual' }}</dd>
            <dt>Domain</dt>
            <dd>{{ skill.domain || '-' }}</dd>
            <dt>Tags</dt>
            <dd>{{ (skill.tags || []).join(', ') || '-' }}</dd>
            <dt>Tools</dt>
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
          <RequestReceipt :receipt="actionResult" title="Skill action receipt" />
        </section>

        <section class="management-panel" data-section="files">
          <header>
            <h2>Files</h2>
            <span>{{ fileItems.length }} entries</span>
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
              <small>{{ file.kind }}{{ file.primary ? ' · primary' : '' }}</small>
            </button>
          </div>
          <article class="skill-markdown">
            <header>
              <strong>{{ rawFile.path || selectedFile }}</strong>
            </header>
            <div v-if="rawFile.content" class="markdown-body" v-html="markdownHtml"></div>
            <pre v-else>{{ rawFile.content || '' }}</pre>
          </article>
        </section>

        <section class="management-panel">
          <header>
            <h2>Runs and governance</h2>
            <span>{{ runItems.length }} runs</span>
          </header>
          <EvidenceTrace :items="skillEvidence" title="Skill evidence trace" />
          <div class="run-list" data-section="runs">
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
              <span>{{ run.status || run.outcome || 'recorded' }}</span>
            </article>
          </div>
          <DetailDrawer title="Skill selected detail" :row="selectedDetail || skill" @close="selectedDetail = null" />
          <RawPayload title="Run detail" :data="runDetail || {}" />
          <RequestReceipt :receipt="actionResult || runDetail" title="Skill run receipt" />
          <RawPayload title="Action result" :data="actionResult || { projection, runs }" />
        </section>
      </main>
    </section>
  </section>
</template>
