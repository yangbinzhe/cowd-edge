# Lark Base Source Connector

Uses `cowd-edge-bitable-source` with the `lark-bitable` driver profile.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It uses the Lark Open
Platform base URL by default and keeps all remote API dependencies out of Cowd
Core.
