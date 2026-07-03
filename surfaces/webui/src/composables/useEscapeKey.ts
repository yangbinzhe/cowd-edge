import { onBeforeUnmount, onMounted } from 'vue';

export function useEscapeKey(handler: () => void, enabled: () => boolean = () => true) {
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !enabled()) return;
    handler();
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
