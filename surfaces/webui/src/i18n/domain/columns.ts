import { hasMessage, t } from '../index';

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displayColumn(value: unknown): string {
  const raw = String(value ?? '');
  const key = `column.${raw.replace(/[^a-zA-Z0-9]+/g, '.')}`;
  return hasMessage(key) ? t(key) : humanize(raw);
}
