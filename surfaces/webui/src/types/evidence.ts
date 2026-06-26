export type EvidenceObject = {
  ref?: string;
  kind?: string;
  source?: string;
  status?: string;
  summary?: string;
  session_id?: string;
  turn_id?: string;
  memory_id?: string;
  matrix_ref?: string;
  audit_ref?: string;
  route?: string;
  raw?: Record<string, unknown> | null;
};
