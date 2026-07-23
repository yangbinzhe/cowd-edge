# MySQL Source Connector

Uses `cowd-edge-sql-source` with the `mysql` driver profile.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It reads MySQL
through `database_url`, `database_url_env`, or structured host/database/user
configuration and returns `SourceRecordBatch` payloads for Gateway Matrix
SourceSnapshot ingestion.

Database drivers stay inside Cowd Edge. Gateway and Runtime only see the source
connector contract and do not link MySQL dependencies.

Paged reads fetch at most `limit + 1` rows to determine continuation without a
full-table `COUNT(*)`. For field-based incremental reads, the connector keeps
the previous high watermark while a stable window still has pages, advances
only the continuation offset, and publishes the new high watermark on the
final page. The returned watermark is a candidate; Gateway/Matrix owns commit.
