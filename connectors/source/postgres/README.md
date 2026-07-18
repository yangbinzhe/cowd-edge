# PostgreSQL Source Connector

Uses `cowd-edge-sql-source` with the `postgres` driver profile.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It reads PostgreSQL
through `database_url`, `database_url_env`, or structured host/database/user
configuration and returns `SourceRecordBatch` payloads for Gateway Matrix
SourceSnapshot ingestion.

Database drivers stay inside Cowd Edge. Gateway and Runtime only see the source
connector contract and do not link PostgreSQL dependencies.
