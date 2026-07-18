# Feishu Message Connector

Uses the shared `cowd-edge-open-platform-message` artifact with the
`feishu-message` driver profile. Gateway discovers the logical manifest and starts
an isolated managed UDS/H2 process.

The connector owns Feishu SDK/API credentials, callbacks, inbound events, and
outbound message delivery. Document operations are intentionally outside this
message connector boundary and should be provided by separately installed skills.
