# Lark Base Source Connector

Builds to `cowd-edge-lark-bitable-source`.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It uses the Lark Open
Platform base URL by default and keeps all remote API dependencies out of Cowd
Core.
