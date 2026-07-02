# Feishu Bitable Source Connector

Builds to `cowd-edge-feishu-bitable-source`.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It can read from
explicit fixture rows for tests, fixture files for local validation, or Feishu
Bitable records when app credentials and app/table identifiers are configured.
