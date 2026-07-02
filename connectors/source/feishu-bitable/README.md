# Feishu Bitable Source Connector

Builds to `cowd-edge-feishu-bitable-source`.

The connector implements `source.read_batch` and returns a `SourceRecordBatch`
compatible payload for Gateway Matrix SourceSnapshot ingestion. It can read
from explicit fixture rows for tests, fixture files for local validation, or
Feishu Bitable records when app credentials and app/table identifiers are
configured.

