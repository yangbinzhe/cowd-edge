import { ref } from 'vue';

export interface EndpointState<T = any> {
  loading: boolean;
  offline: boolean;
  degraded: boolean;
  empty: boolean;
  error: string;
  data: T;
  refreshedAt: string;
}

function countPayload(data: any): number {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== 'object') return data ? 1 : 0;
  for (const key of ['items', 'rows', 'events', 'tasks', 'tools', 'skills', 'runs', 'entries', 'resources']) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  return Object.keys(data).filter((key) => !key.startsWith('__')).length;
}

export function useEndpointState<T>(loader: () => Promise<T>, fallback: T) {
  const state = ref<EndpointState<T>>({
    loading: false,
    offline: false,
    degraded: false,
    empty: true,
    error: '',
    data: fallback,
    refreshedAt: '',
  });

  async function refresh() {
    state.value.loading = true;
    state.value.error = '';
    try {
      const data: any = await loader();
      state.value.data = data;
      state.value.offline = Boolean(data?.__offline);
      state.value.degraded = Boolean(data?.degraded || data?.status === 'degraded');
      state.value.empty = countPayload(data) === 0;
      state.value.error = data?.__error || data?.error || '';
    } catch (error) {
      state.value.offline = true;
      state.value.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.value.loading = false;
      state.value.refreshedAt = new Date().toISOString();
    }
  }

  return { state, refresh };
}
