import type { GraphViewModel } from '../../types/graph';

export function adaptMfgDecisionTrace(trace: Record<string, any> | null, title = ''): GraphViewModel {
  const rows = Array.isArray(trace?.rows) ? trace.rows : [];
  return {
    id: String(trace?.refs?.incident_id || trace?.refs?.report_id || 'mfg-decision-trace'),
    title,
    revision: rows.length,
    status: String(trace?.status || (rows.length ? 'ready' : 'idle')),
    nodes: rows.map((row: any, index: number) => ({
      id: `${String(row.stage || 'stage')}:${String(row.ref || index)}`,
      type: String(row.stage || 'decision'),
      label: String(row.stage || row.ref || index),
      status: String(row.signal || 'pending').includes('pending') ? 'pending' : 'ready',
      group: String(row.domain || 'MFG'),
      summary: `${String(row.ref || '')}\n${String(row.signal || '')}\n${String(row.next || '')}`,
      badges: [row.domain, row.signal].filter(Boolean).map(String),
      correlationRefs: [row.ref, row.endpoint].filter(Boolean).map(String),
      raw: row,
    })),
    edges: rows.slice(1).map((row: any, index: number) => ({
      id: `decision:${index}:${index + 1}`,
      source: `${String(rows[index]?.stage || 'stage')}:${String(rows[index]?.ref || index)}`,
      target: `${String(row.stage || 'stage')}:${String(row.ref || index + 1)}`,
      type: 'decision_flow',
      label: String(rows[index]?.next || ''),
      status: 'recorded',
      raw: { from: rows[index], to: row },
    })),
  };
}
