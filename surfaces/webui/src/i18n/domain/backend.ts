import { displayColumn } from './columns';
import { displayBoolean, displayStatus } from './status';

export function translateBackendValue(kind: 'boolean' | 'column' | 'status', value: unknown): string {
  if (kind === 'boolean') return displayBoolean(value);
  if (kind === 'status') return displayStatus(value);
  return displayColumn(value);
}
