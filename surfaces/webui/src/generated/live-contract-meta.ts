// Generated from Gateway OpenAPI. Do not edit manually.
export const LIVE_CONTRACT_SCHEMA_VERSION = 1 as const;
export const LIVE_ENVELOPE_SCHEMA_HASH = "53ccc1bb8fb6896f1e648035dad6985aba8754b2e5d88e47b7687ddc492a346c" as const;
export const LIVE_ENVELOPE_CANONICAL_FIXTURE = {
  "agent_id": "agent-contract",
  "delivery_class": "durable",
  "detail_scope": "full",
  "end_bytes": 256,
  "event": "TerminalCommitted",
  "execution_id": "execution-contract",
  "mission_id": "mission-contract",
  "payload": {
    "content": "canonical contract fixture",
    "type": "TerminalCommitted"
  },
  "schema_version": 1,
  "session_id": "session-contract",
  "source_cursor": 42,
  "source_health": "live",
  "source_id": "session-contract",
  "source_kind": "session",
  "start_bytes": 128,
  "stream_revision": 3,
  "subscription_id": "subscription-contract",
  "subscription_revision": 7
} as const;
