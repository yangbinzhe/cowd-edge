# Feishu Surface

Builds to `cowd-surface-feishu`. It is installed next to its `surface.json`
manifest and is discovered by Gateway as a managed JSONL sidecar.

The surface owns Feishu SDK/API credentials, callbacks, inbound events, and
outbound message delivery. Document operations are intentionally outside this
surface boundary and should be provided by separately installed skills.
