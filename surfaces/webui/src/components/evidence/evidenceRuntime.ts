export type EvidenceDisplayState = 'resolved' | 'redacted' | 'missing' | 'expired' | 'invalid' | 'unknown';

export interface EvidenceBacklink {
  kind: string;
  label: string;
  route?: string;
}

export function evidenceDisplayState(item: any, now = Date.now()): EvidenceDisplayState {
  const evidence = item?.evidence || {};
  const status = String(item?.status || evidence.status || '').toLowerCase();
  const reason = String(item?.error || evidence.reason || '').toLowerCase();
  const expiresAt = Date.parse(String(evidence.expires_at || evidence.expiry || ''));
  if (status === 'expired' || (Number.isFinite(expiresAt) && expiresAt <= now)) return 'expired';
  if (
    status === 'forbidden'
    || evidence.redacted === true
    || evidence.body_policy === 'metadata_only'
    || reason.includes('redact')
    || reason.includes('permission')
    || reason.includes('access scope')
  ) return 'redacted';
  if (evidence.verified === false) return 'invalid';
  if (
    evidence.available === false
    || status === 'unavailable'
    || reason.includes('not found')
    || reason.includes('unavailable')
    || reason.includes('no canonical')
  ) return 'missing';
  if (status === 'resolved' || evidence.available === true || evidence.verified === true) return 'resolved';
  return 'unknown';
}

export function evidenceSourceRoute(item: any) {
  const reference = String(item?.ref || item?.evidence?.ref || '');
  const evidence = item?.evidence || {};
  if (reference.startsWith('session://')) {
    const sessionId = reference.slice('session://'.length).split('/')[0];
    return `/chat?session_id=${encodeURIComponent(sessionId)}`;
  }
  if (reference.startsWith('tool://')) {
    const query = new URLSearchParams({ section: 'timeline' });
    if (evidence.session_id) query.set('session_id', String(evidence.session_id));
    const toolId = evidence.event?.metadata?.tool_call_id || evidence.projection?.evidence_ref?.id || reference.slice('tool://'.length).split('/')[0];
    if (toolId) query.set('tool_call_id', String(toolId));
    return `/runtime?${query.toString()}`;
  }
  if (reference.startsWith('knowledge://')) return `/memory?section=knowledge-governance&focus=${encodeURIComponent(reference.slice('knowledge://'.length))}`;
  if (reference.startsWith('workspace://')) return `/chat?resource_ref=${encodeURIComponent(reference)}`;
  if (reference.startsWith('service://') || reference.startsWith('mcp://')) return `/surfaces?section=resources&ref=${encodeURIComponent(reference)}`;
  if (reference.startsWith('agent://')) return `/agents?section=managed-agents&agent_id=${encodeURIComponent(reference.slice('agent://'.length).split('/')[0])}`;
  return '';
}

export function evidenceBacklinks(item: any): EvidenceBacklink[] {
  const evidence = item?.evidence || {};
  const links: EvidenceBacklink[] = [];
  const sourceRoute = evidenceSourceRoute(item);
  if (sourceRoute) links.push({ kind: 'source', label: String(item?.ref || evidence.ref || sourceRoute), route: sourceRoute });
  if (evidence.session_id) links.push({ kind: 'session', label: String(evidence.session_id), route: `/chat?session_id=${encodeURIComponent(String(evidence.session_id))}` });
  if (evidence.event?.sequence != null) {
    const query = new URLSearchParams({ section: 'timeline', sequence: String(evidence.event.sequence) });
    if (evidence.session_id) query.set('session_id', String(evidence.session_id));
    links.push({ kind: 'timeline', label: `event ${evidence.event.sequence}`, route: `/runtime?${query.toString()}` });
  }
  const selector = evidence.projection?.access?.retrieval_selector;
  if (selector) links.push({ kind: 'retrieval', label: String(selector) });
  if (evidence.projection_api) links.push({ kind: 'projection', label: String(evidence.projection_api), route: evidence.projection_api === '/api/memory/knowledge' ? '/memory?section=knowledge-governance' : undefined });
  return links.filter((link, index) => links.findIndex((candidate) => candidate.kind === link.kind && candidate.label === link.label) === index);
}

export function evidenceComparison(items: any[]) {
  const fields = ['state', 'kind', 'source', 'available', 'verified', 'reason', 'visibility', 'retrieval'];
  return fields.map((field) => ({
    field,
    values: items.map((item) => {
      const evidence = item?.evidence || {};
      if (field === 'state') return evidenceDisplayState(item);
      if (field === 'visibility') return evidence.projection?.access?.visibility_scope ?? '-';
      if (field === 'retrieval') return evidence.projection?.access?.retrieval_selector ?? evidence.retrieval_capability ?? '-';
      return evidence[field] ?? item?.[field] ?? '-';
    }),
  }));
}
