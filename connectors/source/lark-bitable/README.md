# Lark Base Source Connector

Builds to `cowd-edge-lark-bitable-source`.

The connector implements `source.read_batch` and returns a `SourceRecordBatch`
compatible payload for Gateway Matrix SourceSnapshot ingestion. It uses the
Lark Open Platform base URL by default and keeps all remote API dependencies out
of Cowd Core.

