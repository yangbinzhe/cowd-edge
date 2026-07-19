import { t } from '../i18n';

const localPathPattern = /(?:[A-Za-z]:\\|\/)(?:[^\s:]+[\\/])+[^\s:]+/g;

export function publicErrorSummary(error: unknown): string {
  const raw = String(error ?? '').trim();
  if (!raw) return '';
  if (/must have mode 0?600/i.test(raw)) return t('error.secureFileMode0600');
  if (/\b(?:401|unauthorized|authentication required)\b/i.test(raw)) return t('error.authenticationRequired');
  if (/\b(?:403|forbidden)\b/i.test(raw)) return t('error.permissionRequired');
  return raw.replace(localPathPattern, t('error.localResource')).slice(0, 320);
}
