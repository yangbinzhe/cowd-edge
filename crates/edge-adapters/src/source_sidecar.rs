use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use edge_contract::SurfaceFrame;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

#[derive(Debug, Default)]
struct SourceSidecarState {
    config: Value,
    configured: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceReadPlan {
    adapter_id: String,
    resource_ref: String,
    #[serde(default)]
    table: Option<String>,
    #[serde(default)]
    fields: Vec<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceFieldSchema {
    name: String,
    data_type: String,
    nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceTableSchema {
    table_name: String,
    fields: Vec<SourceFieldSchema>,
    primary_key: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SourceBatchCursor {
    offset: usize,
    limit: usize,
    #[serde(default)]
    next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceRecordBatch {
    adapter_id: String,
    resource_ref: String,
    #[serde(default)]
    table: Option<String>,
    schema: SourceTableSchema,
    rows: Vec<Value>,
    cursor: SourceBatchCursor,
    row_count: usize,
    checksum: String,
    truncated: bool,
}

pub async fn run_stdio_source_connector(
    surface_id: &'static str,
    adapter_id: &'static str,
    default_base_url: &'static str,
) -> io::Result<()> {
    let state = Arc::new(Mutex::new(SourceSidecarState::default()));
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let response = match SurfaceFrame::decode_jsonl(&line) {
            Ok(frame) => {
                handle_frame(
                    frame,
                    surface_id,
                    adapter_id,
                    default_base_url,
                    state.clone(),
                )
                .await
            }
            Err(error) => SurfaceFrame::Error {
                id: None,
                code: "edge_source_frame_parse_failed".to_string(),
                message: error.to_string(),
            },
        };
        write_frame(&stdout, &response).await?;
    }
    Ok(())
}

async fn handle_frame(
    frame: SurfaceFrame,
    surface_id: &str,
    adapter_id: &str,
    default_base_url: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> SurfaceFrame {
    match frame {
        SurfaceFrame::Handshake {
            id,
            protocol,
            gateway_version: _,
        } if protocol == edge_contract::SURFACE_PROTOCOL => SurfaceFrame::HandshakeOk {
            id,
            surface_id: surface_id.to_string(),
            capabilities: vec![
                "source.schema_discovery".to_string(),
                "source.snapshot".to_string(),
                "source.incremental".to_string(),
                "source.health".to_string(),
            ],
        },
        SurfaceFrame::Configure { id, config, .. } => {
            let mut state = state.lock().await;
            state.config = config;
            state.configured = true;
            state.last_error = None;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": "ok",
                    "surface": surface_id,
                    "adapter_id": adapter_id,
                }),
            }
        }
        SurfaceFrame::Connect { id, .. } | SurfaceFrame::Disconnect { id, .. } => {
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": "ready",
                    "surface": surface_id,
                    "adapter_id": adapter_id,
                }),
            }
        }
        SurfaceFrame::Health { id, .. } => {
            let state = state.lock().await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": if state.configured { "ready" } else { "config_missing" },
                    "surface": surface_id,
                    "adapter_id": adapter_id,
                    "last_error": state.last_error,
                }),
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.read_batch" => {
            match read_source_batch(payload, adapter_id, default_base_url, state.clone()).await {
                Ok(batch) => SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ok",
                        "source_batch": batch,
                    }),
                },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_read_batch_failed".to_string(),
                        message: error,
                    }
                }
            }
        }
        SurfaceFrame::Action { id, action, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "source_action_unsupported".to_string(),
            message: format!("unsupported source connector action `{action}`"),
        },
        SurfaceFrame::Handshake { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "edge_source_protocol_mismatch".to_string(),
            message: format!("expected protocol `{}`", edge_contract::SURFACE_PROTOCOL),
        },
        SurfaceFrame::Send { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "source_send_unsupported".to_string(),
            message: "source connector does not handle message send frames".to_string(),
        },
        SurfaceFrame::HandshakeOk { id, .. } | SurfaceFrame::Ok { id, .. } => {
            unexpected_request_frame(id)
        }
        SurfaceFrame::Error { id, .. } => SurfaceFrame::Error {
            id,
            code: "source_unexpected_request_frame".to_string(),
            message: "source connector received error frame as request".to_string(),
        },
        SurfaceFrame::Event { .. } => SurfaceFrame::Error {
            id: None,
            code: "source_unexpected_request_frame".to_string(),
            message: "source connector received event frame as request".to_string(),
        },
    }
}

async fn read_source_batch(
    payload: Value,
    adapter_id: &str,
    default_base_url: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> Result<SourceRecordBatch, String> {
    let plan = serde_json::from_value::<SourceReadPlan>(payload)
        .map_err(|error| format!("invalid source read plan: {error}"))?;
    if plan.adapter_id != adapter_id {
        return Err(format!(
            "adapter mismatch: request `{}` routed to `{adapter_id}`",
            plan.adapter_id
        ));
    }

    if let Some(rows) = rows_from_metadata(&plan.metadata)? {
        return Ok(record_batch_from_rows(plan, rows, false));
    }

    let config = state.lock().await.config.clone();
    read_feishu_bitable_batch(plan, config, default_base_url).await
}

fn rows_from_metadata(metadata: &Value) -> Result<Option<Vec<Value>>, String> {
    if let Some(rows) = metadata.get("rows").and_then(Value::as_array) {
        return Ok(Some(rows.clone()));
    }
    if let Some(path) = metadata.get("fixture_path").and_then(Value::as_str) {
        let rows = read_fixture_rows(PathBuf::from(path))?;
        return Ok(Some(rows));
    }
    Ok(None)
}

fn read_fixture_rows(path: PathBuf) -> Result<Vec<Value>, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("source fixture read failed at {}: {error}", path.display()))?;
    if content.trim_start().starts_with('[') {
        return serde_json::from_str::<Vec<Value>>(&content)
            .map_err(|error| format!("source fixture json array parse failed: {error}"));
    }
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<Value>(line)
                .map_err(|error| format!("source fixture jsonl parse failed: {error}"))
        })
        .collect()
}

async fn read_feishu_bitable_batch(
    plan: SourceReadPlan,
    config: Value,
    default_base_url: &str,
) -> Result<SourceRecordBatch, String> {
    let app_id = config
        .get("app_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "source connector config missing app_id".to_string())?;
    let app_secret = config
        .get("app_secret")
        .and_then(Value::as_str)
        .ok_or_else(|| "source connector config missing app_secret".to_string())?;
    let base_url = config
        .get("base_url")
        .and_then(Value::as_str)
        .unwrap_or(default_base_url)
        .trim_end_matches('/');
    let (app_token, table_id) = resolve_bitable_target(&plan)?;
    let token = tenant_access_token(base_url, app_id, app_secret).await?;
    let limit = plan.limit.unwrap_or(100).clamp(1, 500);
    let page_token = plan
        .cursor
        .as_deref()
        .or_else(|| plan.metadata.get("page_token").and_then(Value::as_str));
    let mut url = format!(
        "{base_url}/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size={limit}"
    );
    if let Some(page_token) = page_token {
        url.push_str("&page_token=");
        url.push_str(page_token);
    }
    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("bitable records request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("bitable records response read failed: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "bitable records request failed with {status}: {body}"
        ));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("bitable records response parse failed: {error}"))?;
    if value.get("code").and_then(Value::as_i64).unwrap_or(0) != 0 {
        return Err(format!("bitable records api error: {body}"));
    }
    let data = value.get("data").cloned().unwrap_or(Value::Null);
    let rows = data
        .get("items")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(record_item_to_row).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut batch = record_batch_from_rows(
        plan,
        rows,
        data.get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    if let Some(total) = data.get("total").and_then(Value::as_u64) {
        batch.row_count = total as usize;
    }
    Ok(batch)
}

async fn tenant_access_token(
    base_url: &str,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{base_url}/open-apis/auth/v3/tenant_access_token/internal"
        ))
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret,
        }))
        .send()
        .await
        .map_err(|error| format!("tenant access token request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("tenant access token response read failed: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "tenant access token request failed with {status}: {body}"
        ));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("tenant access token response parse failed: {error}"))?;
    if value.get("code").and_then(Value::as_i64).unwrap_or(0) != 0 {
        return Err(format!("tenant access token api error: {body}"));
    }
    value
        .get("tenant_access_token")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "tenant access token response missing token".to_string())
}

fn resolve_bitable_target(plan: &SourceReadPlan) -> Result<(String, String), String> {
    let app_token = plan
        .metadata
        .get("app_token")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let table_id = plan
        .metadata
        .get("table_id")
        .and_then(Value::as_str)
        .or(plan.table.as_deref())
        .map(ToString::to_string);
    if let (Some(app_token), Some(table_id)) = (app_token, table_id) {
        return Ok((app_token, table_id));
    }
    let (_, tail) = plan
        .resource_ref
        .split_once("://")
        .ok_or_else(|| "bitable resource_ref must be scheme://app_token/table_id".to_string())?;
    let mut parts = tail.split('/').filter(|part| !part.trim().is_empty());
    let app_token = parts
        .next()
        .ok_or_else(|| "bitable resource_ref missing app_token".to_string())?;
    let table_id = parts
        .next()
        .ok_or_else(|| "bitable resource_ref missing table_id".to_string())?;
    Ok((app_token.to_string(), table_id.to_string()))
}

fn record_item_to_row(item: &Value) -> Value {
    let mut row = item
        .get("fields")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(record_id) = item.get("record_id").and_then(Value::as_str) {
        row.insert(
            "_record_id".to_string(),
            Value::String(record_id.to_string()),
        );
    }
    Value::Object(row)
}

fn record_batch_from_rows(
    plan: SourceReadPlan,
    rows: Vec<Value>,
    truncated: bool,
) -> SourceRecordBatch {
    let limit = plan.limit.unwrap_or(100).clamp(1, 1000);
    let offset = plan.offset.unwrap_or(0);
    let schema = infer_schema(plan.table.as_deref().unwrap_or("records"), &rows);
    let checksum = checksum_rows(&rows);
    let row_count = rows.len();
    SourceRecordBatch {
        adapter_id: plan.adapter_id,
        resource_ref: plan.resource_ref,
        table: plan.table,
        schema,
        rows,
        cursor: SourceBatchCursor {
            offset,
            limit,
            next_offset: truncated.then_some(offset + row_count),
        },
        row_count,
        checksum,
        truncated,
    }
}

fn infer_schema(table_name: &str, rows: &[Value]) -> SourceTableSchema {
    let mut fields = BTreeMap::new();
    for row in rows {
        let Some(object) = row.as_object() else {
            continue;
        };
        for (key, value) in object {
            fields
                .entry(key.clone())
                .or_insert_with(|| SourceFieldSchema {
                    name: key.clone(),
                    data_type: value_type(value).to_string(),
                    nullable: false,
                });
        }
    }
    SourceTableSchema {
        table_name: table_name.to_string(),
        fields: fields.into_values().collect(),
        primary_key: Vec::new(),
    }
}

fn value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn checksum_rows(rows: &[Value]) -> String {
    let mut hasher = Sha256::new();
    for row in rows {
        hasher.update(serde_json::to_vec(row).unwrap_or_default());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

fn unexpected_request_frame(id: String) -> SurfaceFrame {
    SurfaceFrame::Error {
        id: Some(id),
        code: "source_unexpected_request_frame".to_string(),
        message: "source connector received response frame as request".to_string(),
    }
}

async fn write_frame(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    frame: &SurfaceFrame,
) -> io::Result<()> {
    let encoded = frame
        .encode_jsonl()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut stdout = stdout.lock().await;
    stdout.write_all(encoded.as_bytes()).await?;
    stdout.flush().await
}
