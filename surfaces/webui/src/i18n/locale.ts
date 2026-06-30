import { ref, watch } from 'vue';
import { isLocale, type Locale } from './keys';

const LOCALE_KEY = 'cowd.webui.locale';

function detectBrowserLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  const stored = window.localStorage?.getItem(LOCALE_KEY);
  if (isLocale(stored)) return stored;
  return 'zh-CN';
}

export const locale = ref<Locale>(detectBrowserLocale());

export const localeStorageKey = LOCALE_KEY;

export function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale.value === 'zh-CN' ? 'zh-CN' : 'en';
  document.documentElement.dataset.locale = locale.value;
}

export function setLocale(next: Locale) {
  locale.value = next;
  if (typeof window !== 'undefined') window.localStorage?.setItem(LOCALE_KEY, next);
  applyDocumentLocale();
}

watch(locale, applyDocumentLocale);
