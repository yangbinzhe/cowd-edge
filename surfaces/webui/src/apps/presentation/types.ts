// Generated from cowd.presentation.result-shape.v1.
// schema-sha256: bb0ff5ebc437f61eeea368ecb74eb88aa75cd7de587ccfe83448c69cb1d5bd64
export const COWD_PRESENTATION_SCHEMA_ID = 'cowd.presentation.result-shape.v1' as const;
export const COWD_PRESENTATION_SCHEMA_VERSION = 1 as const;
export const COWD_PRESENTATION_SCHEMA_SHA256 = 'bb0ff5ebc437f61eeea368ecb74eb88aa75cd7de587ccfe83448c69cb1d5bd64' as const;
export type CowdPresentationValue = null | boolean | number | string;
export interface CowdPresentationTableColumn { key: string; label: string; value_kind: 'text' | 'number' | 'boolean' | 'timestamp' | 'status' }
export type CowdPresentationResultShape =
  | { kind: 'scalar'; content: { value: CowdPresentationValue; label?: string | null; unit?: string | null; change?: number | null } }
  | { kind: 'series'; content: { points: Array<{ x: string; y: number; series?: string | null; source_ref?: string | null }>; x_label?: string | null; y_label?: string | null; unit?: string | null } }
  | { kind: 'table'; content: { columns: CowdPresentationTableColumn[]; rows: Array<{ id: string; cells: Record<string, CowdPresentationValue>; source_ref?: string | null }> } }
  | { kind: 'matrix'; content: { x_labels: string[]; y_labels: string[]; cells: Array<{ x: string; y: string; value: number; label?: string | null; source_ref?: string | null }> } }
  | { kind: 'graph'; content: { nodes: Array<{ id: string; label: string; category?: string | null; source_ref?: string | null }>; edges: Array<{ source: string; target: string; label?: string | null }> } }
  | { kind: 'timeline'; content: { items: Array<{ id: string; at: string; title: string; detail?: string | null; status?: string | null; source_ref?: string | null }> } };
export type CowdPresentationRendererId = 'kpi' | 'line' | 'risk_matrix' | 'attention' | 'incident' | 'workflow' | 'graph' | 'quality' | 'actions' | 'delivery' | 'freshness' | 'focus';
