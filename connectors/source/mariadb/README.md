# MariaDB Source Connector

Builds to `cowd-edge-mariadb-source`.

The connector implements `source.read_batch`, `source.schema_discovery`,
`source.incremental_plan`, and source event normalization. It reads MariaDB
through `database_url`, `database_url_env`, or structured host/database/user
configuration and returns `SourceRecordBatch` payloads for Gateway Matrix
SourceSnapshot ingestion.

MariaDB uses the MySQL wire protocol internally, but remains a separate Edge
source connector so Gateway can present it as a first-class data source.
