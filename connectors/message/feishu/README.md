# Feishu Message Connector

Builds to `cowd-edge-feishu-message`. It is installed next to its `surface.json`
manifest and is discovered by Gateway as a managed JSONL sidecar.

The connector owns Feishu SDK/API credentials, callbacks, inbound events, and
outbound message delivery. Document operations are intentionally outside this
message connector boundary and should be provided by separately installed skills.
