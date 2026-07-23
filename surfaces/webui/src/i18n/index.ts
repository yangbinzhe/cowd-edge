import { computed } from 'vue';
import { applyDocumentLocale, locale, setLocale } from './locale';
import { enUS } from './messages/en-US';
import { zhCN } from './messages/zh-CN';
import type { Locale, MessageCatalog, MessageParams } from './keys';

export type { Locale, MessageParams } from './keys';
export { applyDocumentLocale, locale, setLocale };
export { formatCount, formatDateTime } from './domain/units';

const catalogs: Record<Locale, MessageCatalog> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export const isChinese = computed(() => locale.value === 'zh-CN');

/** 构建期装配 APP 的翻译仅在内存合并，不能覆盖宿主既有词条。 */
export function registerMessages(messages: Partial<Record<Locale, MessageCatalog>>) {
  for (const localeName of Object.keys(messages) as Locale[]) {
    const incoming = messages[localeName];
    if (!incoming) continue;
    for (const [key, value] of Object.entries(incoming)) {
      if (catalogs[localeName][key] && catalogs[localeName][key] !== value) {
        throw new Error(`APP i18n key collision: ${key}`);
      }
      catalogs[localeName][key] = value;
    }
  }
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function hasMessage(key: string): boolean {
  return Boolean(catalogs['zh-CN'][key] && catalogs['en-US'][key]);
}

export function t(key: string, params?: MessageParams): string {
  const catalog = catalogs[locale.value] || catalogs['zh-CN'];
  const fallback = catalogs['zh-CN'][key] || catalogs['en-US'][key] || key;
  return interpolate(catalog[key] || fallback, params);
}

export function tc(key: string, count: number | string, params?: MessageParams): string {
  return t(key, { ...params, count });
}

export function useI18n() {
  return {
    locale,
    isChinese,
    setLocale,
    t,
    tc,
  };
}
