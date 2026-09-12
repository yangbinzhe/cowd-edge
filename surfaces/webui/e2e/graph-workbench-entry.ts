import { createApp, defineComponent, h, ref } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import GraphSurface from '../src/components/graph/GraphSurface.vue';
import type { GraphViewModel, GraphNodeView } from '../src/types/graph';
import { setLocale } from '../src/i18n/locale';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
const query = new URLSearchParams(location.search);
const count = Math.max(12, Math.min(10000, Number(query.get('count') || 100)));
setLocale(query.get('locale') === 'en' ? 'en-US' : 'zh-CN');
document.documentElement.dataset.theme = query.get('theme') || 'dark';
const nodes: GraphNodeView[] = [{ id: 'goal', type: 'goal', label: '研究目标', status: 'running' }];
const edges: GraphViewModel['edges'] = [];
for (let index = 1; index < count; index++) {
  const team = index <= 10;
  const id = team ? `team-${index}` : `task-${index}`;
  nodes.push({ id, type: team ? 'team' : 'task', label: team ? `团队 ${index}` : `Task ${index} 中文证据`, status: index % 97 === 0 ? 'blocked' : 'running' });
  edges.push({ id: `owns-${id}`, source: team ? 'goal' : `team-${index % 10 + 1}`, target: id, type: 'owns' });
}
const model = ref<GraphViewModel>({ id: `browser-fixture:${count}`, title: '浏览器交互夹具 · 研究工作台', nodes, edges });
const selected = ref('');
const app = createApp(defineComponent({ setup: () => () => h('main', { style: 'padding:16px;max-width:1600px;margin:auto' }, [
  h('p', { style: 'margin:0 0 12px' }, '测试夹具：没有业务网关或模型调用'),
  h('button', { id: 'update-status', onClick: () => { model.value = { ...model.value, nodes: model.value.nodes.map(node => node.id === `task-${count - 1}` ? { ...node, status: node.status === 'blocked' ? 'running' : 'blocked' } : node) }; } }, '更新节点状态'),
  h('output', { id: 'selection', 'aria-live': 'polite' }, selected.value),
  h(GraphSurface, { model: model.value, selectedNodeId: selected.value, embeddedInspector: false, onSelectNode: (node: GraphNodeView) => { selected.value = node.id; } }),
]) }));
app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }));
app.mount('#fixture');
