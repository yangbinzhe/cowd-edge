import { ref } from 'vue';
import type { ApiReceipt } from '../api/client';

export function useActionReceipt<T = any>() {
  const receipt = ref<ApiReceipt<T> | Record<string, unknown> | null>(null);
  const running = ref(false);

  async function run(action: () => Promise<ApiReceipt<T> | Record<string, unknown>>) {
    running.value = true;
    try {
      receipt.value = await action();
      return receipt.value;
    } finally {
      running.value = false;
    }
  }

  function clear() {
    receipt.value = null;
  }

  return { receipt, running, run, clear };
}
