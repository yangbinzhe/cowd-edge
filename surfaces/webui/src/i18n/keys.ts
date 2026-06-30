export type Locale = 'zh-CN' | 'en-US';

export type MessageParams = Record<string, string | number | boolean | null | undefined>;

export type MessageCatalog = Record<string, string>;

export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'en-US'];

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en-US';
}
