# MariaDB Source Connector

Uses `cowd-edge-sql-source` with the `mariadb` driver profile.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It reads MariaDB
through `database_url`, `database_url_env`, or structured host/database/user
configuration and returns `SourceRecordBatch` payloads for Gateway Matrix
SourceSnapshot ingestion.

MariaDB uses the MySQL wire protocol internally, but remains a separate Edge
source connector so Gateway can present it as a first-class data source.

Paged reads fetch at most `limit + 1` rows to determine continuation without a
full-table `COUNT(*)`. For field-based incremental reads, the connector keeps
the previous high watermark while a stable window still has pages, advances
only the continuation offset, and publishes the new high watermark on the
final page. The returned watermark is a candidate; Gateway/Matrix owns commit.
