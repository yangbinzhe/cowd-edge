import { ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';

function stringQuery(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberQuery(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function useGraphQueryState(defaults: { depth?: number; cursor?: number } = {}) {
  const route = useRoute();
  const router = useRouter();
  const focus = ref(stringQuery(route.query.focus));
  const filter = ref(stringQuery(route.query.filter));
  const depth = ref(numberQuery(route.query.depth, defaults.depth ?? 2, 1, 12));
  const cursor = ref(numberQuery(route.query.cursor, defaults.cursor ?? 0, 0, Number.MAX_SAFE_INTEGER));
  const from = ref(stringQuery(route.query.from));
  const to = ref(stringQuery(route.query.to));

  watch(() => route.query, (query) => {
    focus.value = stringQuery(query.focus);
    filter.value = stringQuery(query.filter);
    depth.value = numberQuery(query.depth, defaults.depth ?? 2, 1, 12);
    cursor.value = numberQuery(query.cursor, defaults.cursor ?? 0, 0, Number.MAX_SAFE_INTEGER);
    from.value = stringQuery(query.from);
    to.value = stringQuery(query.to);
  });

  async function sync(extra: LocationQueryRaw = {}) {
    await router.replace({
      query: {
        ...route.query,
        ...extra,
        focus: focus.value || undefined,
        filter: filter.value || undefined,
        depth: depth.value !== (defaults.depth ?? 2) ? String(depth.value) : undefined,
        cursor: cursor.value ? String(cursor.value) : undefined,
        from: from.value || undefined,
        to: to.value || undefined,
      },
    });
  }

  return { focus, filter, depth, cursor, from, to, sync };
}
