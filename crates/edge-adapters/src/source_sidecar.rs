use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use edge_contract::SurfaceFrame;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

#[cfg(feature = "source-db")]
use crate::source_db::{self, DatabaseDialect};

#[derive(Debug, Default)]
struct SourceSidecarState {
    config: Value,
    configured: bool,
    last_error: Option<String>,
    last_run_at_ms: Option<i64>,
    watermarks: BTreeMap<String, SourceWatermark>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SourceReadPlan {
    #[serde(default)]
    pub(crate) adapter_id: String,
    #[serde(default)]
    pub(crate) resource_ref: String,
    #[serde(default)]
    pub(crate) table: Option<String>,
    #[serde(default)]
    pub(crate) fields: Vec<String>,
    #[serde(default)]
    pub(crate) limit: Option<usize>,
    #[serde(default)]
    pub(crate) offset: Option<usize>,
    #[serde(default)]
    pub(crate) cursor: Option<String>,
    #[serde(default)]
    pub(crate) metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SourceFieldSchema {
    pub(crate) name: String,
    pub(crate) data_type: String,
    pub(crate) nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SourceTableSchema {
    pub(crate) table_name: String,
    pub(crate) fields: Vec<SourceFieldSchema>,
    pub(crate) primary_key: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct SourceBatchCursor {
    pub(crate) offset: usize,
    pub(crate) limit: usize,
    #[serde(default)]
    pub(crate) next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SourceRecordBatch {
    pub(crate) adapter_id: String,
    pub(crate) resource_ref: String,
    #[serde(default)]
    pub(crate) table: Option<String>,
    pub(crate) schema: SourceTableSchema,
    pub(crate) rows: Vec<Value>,
    pub(crate) cursor: SourceBatchCursor,
    pub(crate) row_count: usize,
    pub(crate) checksum: String,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct SourceWatermark {
    pub(crate) adapter_id: String,
    pub(crate) resource_ref: String,
    #[serde(default)]
    pub(crate) table: Option<String>,
    pub(crate) strategy: String,
    #[serde(default)]
    pub(crate) cursor: Option<String>,
    #[serde(default)]
    pub(crate) offset: Option<usize>,
    #[serde(default)]
    pub(crate) high_watermark: Option<String>,
    #[serde(default)]
    pub(crate) checksum: Option<String>,
    pub(crate) updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SourceIncrementalRunRequest {
    adapter_id: String,
    resource_ref: String,
    #[serde(default)]
    table: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    watermark: Option<SourceWatermark>,
    #[serde(default)]
    metadata: Value,
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
                "source.state".to_string(),
                "source.watermark".to_string(),
                "source.event".to_string(),
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
            payload: _,
            ..
        } if action == "source.state" => {
            let state = state.lock().await;
            SurfaceFrame::Ok {
                id,
                payload: source_state_payload(surface_id, adapter_id, default_base_url, &state),
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.watermark.get" => {
            let state = state.lock().await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": "ok",
                    "adapter_id": adapter_id,
                    "watermark": get_watermark_from_state(adapter_id, &payload, &state),
                }),
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.watermark.commit" => {
            match commit_watermark(payload, adapter_id, state.clone()).await {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_watermark_commit_failed".to_string(),
                        message: error,
                    }
                }
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
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.schema_discovery" || action == "source.discover_schema" => {
            match discover_source_schema(payload, adapter_id, default_base_url, state.clone()).await
            {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_schema_discovery_failed".to_string(),
                        message: error,
                    }
                }
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.incremental.run" || action == "source.incremental_run" => {
            match run_incremental_source(payload, adapter_id, default_base_url, state.clone()).await
            {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_incremental_run_failed".to_string(),
                        message: error,
                    }
                }
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.incremental_plan" || action == "source.plan_incremental" => {
            match incremental_source_plan(payload, adapter_id) {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_incremental_plan_failed".to_string(),
                        message: error,
                    }
                }
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.event.normalize" || action == "source.events.normalize" => {
            match normalize_source_events(payload, adapter_id) {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_event_normalize_failed".to_string(),
                        message: error,
                    }
                }
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.event.poll"
            || action == "source.poll_events"
            || action == "source.event_poll" =>
        {
            match poll_source_events(payload, adapter_id, state.clone()).await {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    state.lock().await.last_error = Some(error.clone());
                    SurfaceFrame::Error {
                        id: Some(id),
                        code: "source_event_poll_failed".to_string(),
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
    let plan = source_plan_from_payload(payload, adapter_id)?;

    if let Some(rows) = rows_from_metadata(&plan.metadata)? {
        return Ok(record_batch_from_rows(plan, rows, false));
    }

    let config = state.lock().await.config.clone();
    #[cfg(feature = "source-db")]
    if let Some(dialect) = DatabaseDialect::from_adapter(adapter_id) {
        return source_db::read_database_batch(plan, config, dialect).await;
    }
    read_feishu_bitable_batch(plan, config, default_base_url).await
}

async fn discover_source_schema(
    payload: Value,
    adapter_id: &str,
    default_base_url: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> Result<Value, String> {
    let config = state.lock().await.config.clone();
    #[cfg(feature = "source-db")]
    if DatabaseDialect::from_adapter(adapter_id).is_some() {
        return source_db::discover_database_schema(payload, adapter_id, config).await;
    }
    discover_bitable_schema(payload, adapter_id, config, default_base_url).await
}

fn incremental_source_plan(payload: Value, adapter_id: &str) -> Result<Value, String> {
    #[cfg(feature = "source-db")]
    if DatabaseDialect::from_adapter(adapter_id).is_some() {
        return source_db::incremental_plan(payload, adapter_id);
    }
    bitable_incremental_plan(payload, adapter_id)
}

async fn run_incremental_source(
    payload: Value,
    adapter_id: &str,
    default_base_url: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> Result<Value, String> {
    let mut request = incremental_request_from_payload(payload, adapter_id)?;
    let state_watermark = {
        let state_guard = state.lock().await;
        request.watermark.clone().or_else(|| {
            get_watermark_from_state(
                adapter_id,
                &serde_json::to_value(&request).unwrap_or_default(),
                &state_guard,
            )
        })
    };
    request.watermark = state_watermark.clone();
    let mut plan = SourceReadPlan {
        adapter_id: request.adapter_id.clone(),
        resource_ref: request.resource_ref.clone(),
        table: request.table.clone(),
        fields: Vec::new(),
        limit: request.limit,
        offset: state_watermark
            .as_ref()
            .and_then(|watermark| watermark.offset),
        cursor: state_watermark.as_ref().and_then(|watermark| {
            watermark
                .cursor
                .clone()
                .or_else(|| watermark.high_watermark.clone())
        }),
        metadata: request.metadata.clone(),
    };
    apply_incremental_watermark_to_plan(&mut plan, state_watermark.as_ref());
    let batch = read_source_batch(
        serde_json::json!({ "read_plan": plan }),
        adapter_id,
        default_base_url,
        state.clone(),
    )
    .await?;
    let watermark_after =
        watermark_after_batch(&batch, state_watermark.as_ref(), &request.metadata);
    {
        let mut state_guard = state.lock().await;
        state_guard.last_run_at_ms = Some(now_ms());
        state_guard.last_error = None;
    }
    let degraded_reason = degraded_reason_for_incremental(&request.metadata, &watermark_after);
    Ok(serde_json::json!({
        "status": if degraded_reason.is_some() { "degraded" } else { "ok" },
        "batch": batch,
        "watermark_before": state_watermark,
        "watermark_after": watermark_after,
        "degraded_reason": degraded_reason,
    }))
}

fn incremental_request_from_payload(
    payload: Value,
    adapter_id: &str,
) -> Result<SourceIncrementalRunRequest, String> {
    let value = payload
        .get("request")
        .or_else(|| payload.get("incremental_run"))
        .cloned()
        .unwrap_or(payload);
    let mut request = serde_json::from_value::<SourceIncrementalRunRequest>(value)
        .map_err(|error| format!("invalid source incremental run request: {error}"))?;
    if request.adapter_id.trim().is_empty() {
        request.adapter_id = adapter_id.to_string();
    }
    if request.adapter_id != adapter_id {
        return Err(format!(
            "adapter mismatch: request `{}` routed to `{adapter_id}`",
            request.adapter_id
        ));
    }
    Ok(request)
}

fn apply_incremental_watermark_to_plan(
    plan: &mut SourceReadPlan,
    watermark: Option<&SourceWatermark>,
) {
    let Some(watermark) = watermark else {
        return;
    };
    if plan.cursor.is_none() {
        plan.cursor = watermark
            .cursor
            .clone()
            .or_else(|| watermark.high_watermark.clone());
    }
    if plan.offset.is_none() {
        plan.offset = watermark.offset;
    }
    if !plan.metadata.is_object() {
        plan.metadata = Value::Object(Default::default());
    }
    plan.metadata["watermark_before"] = serde_json::to_value(watermark).unwrap_or(Value::Null);
}

fn source_plan_from_payload(payload: Value, adapter_id: &str) -> Result<SourceReadPlan, String> {
    let value = payload
        .get("read_plan")
        .or_else(|| payload.get("source_read_plan"))
        .cloned()
        .unwrap_or(payload);
    let mut plan = serde_json::from_value::<SourceReadPlan>(value)
        .map_err(|error| format!("invalid source read plan: {error}"))?;
    if plan.adapter_id.trim().is_empty() {
        plan.adapter_id = adapter_id.to_string();
    }
    if plan.adapter_id != adapter_id {
        return Err(format!(
            "adapter mismatch: request `{}` routed to `{adapter_id}`",
            plan.adapter_id
        ));
    }
    Ok(plan)
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

async fn discover_bitable_schema(
    payload: Value,
    adapter_id: &str,
    config: Value,
    default_base_url: &str,
) -> Result<Value, String> {
    let plan = source_plan_from_payload(payload, adapter_id)?;
    if let Some(rows) = rows_from_metadata(&plan.metadata)? {
        let table_name = plan.table.as_deref().unwrap_or("records");
        return Ok(serde_json::json!({
            "status": "ok",
            "adapter_id": adapter_id,
            "resource_ref": sanitize_resource_ref(&plan.resource_ref),
            "source_schema": {
                "tables": [infer_schema(table_name, &rows)],
            }
        }));
    }

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
    let response = reqwest::Client::new()
        .get(format!(
            "{base_url}/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100"
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("bitable fields request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("bitable fields response read failed: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "bitable fields request failed with {status}: {body}"
        ));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("bitable fields response parse failed: {error}"))?;
    if value.get("code").and_then(Value::as_i64).unwrap_or(0) != 0 {
        return Err(format!("bitable fields api error: {body}"));
    }
    let items = value
        .get("data")
        .and_then(|data| data.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let fields = items
        .iter()
        .filter_map(bitable_field_schema)
        .collect::<Vec<_>>();
    let primary_key = items
        .iter()
        .filter(|item| {
            item.get("is_primary")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|item| bitable_field_name(item).map(ToString::to_string))
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "resource_ref": sanitize_resource_ref(&plan.resource_ref),
        "source_schema": {
            "tables": [{
                "table_name": plan.table.unwrap_or(table_id),
                "fields": fields,
                "primary_key": primary_key,
            }],
        }
    }))
}

fn bitable_field_schema(item: &Value) -> Option<SourceFieldSchema> {
    let name = bitable_field_name(item)?.to_string();
    let data_type = item
        .get("ui_type")
        .or_else(|| item.get("type"))
        .map(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());
    Some(SourceFieldSchema {
        name,
        data_type,
        nullable: true,
    })
}

fn bitable_field_name(item: &Value) -> Option<&str> {
    item.get("field_name")
        .or_else(|| item.get("name"))
        .and_then(Value::as_str)
}

fn bitable_incremental_plan(payload: Value, adapter_id: &str) -> Result<Value, String> {
    let mut plan = source_plan_from_payload(payload.clone(), adapter_id)?;
    let limit = plan.limit.unwrap_or(100).clamp(1, 500);
    let next_page_token = string_at(&payload, &["next_page_token"])
        .or_else(|| string_at(&payload, &["source_batch", "next_page_token"]))
        .or_else(|| string_at(&payload, &["source_batch", "cursor", "next_page_token"]))
        .or_else(|| string_at(&payload, &["cursor", "next_page_token"]))
        .map(ToString::to_string);
    if let Some(next_page_token) = next_page_token.clone() {
        plan.cursor = Some(next_page_token.clone());
        if !plan.metadata.is_object() {
            plan.metadata = Value::Object(Default::default());
        }
        plan.metadata["page_token"] = Value::String(next_page_token);
    } else {
        let offset = plan.offset.unwrap_or(0);
        plan.offset = Some(offset.saturating_add(limit));
    }
    Ok(serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "incremental_plan": {
            "mode": if next_page_token.is_some() { "page_token" } else { "offset_hint" },
            "next_read_plan": plan,
            "notes": [
                "Bitable incremental reads use page tokens when provided by upstream data",
                "webhook callbacks can be normalized through source.event.normalize"
            ]
        }
    }))
}

async fn poll_source_events(
    payload: Value,
    adapter_id: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> Result<Value, String> {
    let config = state.lock().await.config.clone();
    let mut events = events_from_value(&payload)?;
    if events.is_empty() {
        events = events_from_value(&config)?;
    }
    if events.is_empty() {
        return Ok(serde_json::json!({
            "status": "degraded",
            "adapter_id": adapter_id,
            "event_count": 0,
            "events": [],
            "source_events": [],
            "degraded_reason": "requires_external_event_source",
        }));
    }
    let mut payload = normalized_events_payload(adapter_id, events);
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "watermark_after".to_string(),
            serde_json::to_value(event_watermark(adapter_id, object)).unwrap_or(Value::Null),
        );
    }
    Ok(payload)
}

fn normalize_source_events(payload: Value, adapter_id: &str) -> Result<Value, String> {
    let mut events = events_from_value(&payload)?;
    if events.is_empty() {
        events.push(payload);
    }
    Ok(normalized_events_payload(adapter_id, events))
}

fn events_from_value(value: &Value) -> Result<Vec<Value>, String> {
    if let Some(path) = value
        .get("event_fixture_path")
        .or_else(|| value.get("events_fixture_path"))
        .and_then(Value::as_str)
    {
        return read_fixture_rows(PathBuf::from(path));
    }
    if let Some(events) = value.get("events").and_then(Value::as_array) {
        return Ok(events.clone());
    }
    if let Some(events) = value
        .get("metadata")
        .and_then(|metadata| metadata.get("events"))
        .and_then(Value::as_array)
    {
        return Ok(events.clone());
    }
    if let Some(events) = value
        .get("data")
        .and_then(|data| data.get("events"))
        .and_then(Value::as_array)
    {
        return Ok(events.clone());
    }
    if value.is_array() {
        return Ok(value.as_array().cloned().unwrap_or_default());
    }
    Ok(Vec::new())
}

fn normalized_events_payload(adapter_id: &str, events: Vec<Value>) -> Value {
    let normalized = events
        .iter()
        .map(|event| normalize_source_event(adapter_id, event))
        .collect::<Vec<_>>();
    serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "event_count": normalized.len(),
        "events": normalized,
        "source_events": normalized,
    })
}

fn source_state_payload(
    surface_id: &str,
    adapter_id: &str,
    default_base_url: &str,
    state: &SourceSidecarState,
) -> Value {
    let has_event_fixture = !events_from_value(&state.config)
        .unwrap_or_default()
        .is_empty();
    let supports_real_events = state
        .config
        .get("event_poll_url")
        .and_then(Value::as_str)
        .is_some();
    serde_json::json!({
        "status": "ok",
        "state": {
            "adapter_id": adapter_id,
            "surface_id": surface_id,
            "status": if state.configured { "ready" } else { "config_missing" },
            "capabilities": [
                "source.schema_discovery",
                "source.snapshot",
                "source.incremental",
                "source.watermark",
                "source.event.poll"
            ],
            "last_run_at_ms": state.last_run_at_ms,
            "last_error": state.last_error,
            "degraded_reason": if !supports_real_events && !has_event_fixture {
                Some("requires_external_event_source")
            } else {
                None
            },
            "watermarks": state.watermarks.values().cloned().collect::<Vec<_>>(),
            "configured": state.configured,
            "supports_real_event_poll": supports_real_events,
            "default_base_url": default_base_url,
        }
    })
}

fn get_watermark_from_state(
    adapter_id: &str,
    payload: &Value,
    state: &SourceSidecarState,
) -> Option<SourceWatermark> {
    payload
        .get("watermark")
        .cloned()
        .and_then(|value| serde_json::from_value::<SourceWatermark>(value).ok())
        .or_else(|| {
            let resource_ref = payload
                .get("resource_ref")
                .and_then(Value::as_str)
                .or_else(|| {
                    payload
                        .get("request")
                        .and_then(|request| request.get("resource_ref"))
                        .and_then(Value::as_str)
                })
                .unwrap_or("");
            let table = payload.get("table").and_then(Value::as_str).or_else(|| {
                payload
                    .get("request")
                    .and_then(|request| request.get("table"))
                    .and_then(Value::as_str)
            });
            let probe = SourceWatermark {
                adapter_id: adapter_id.to_string(),
                resource_ref: sanitize_resource_ref(resource_ref),
                table: table.map(ToString::to_string),
                strategy: "offset".to_string(),
                cursor: None,
                offset: Some(0),
                high_watermark: None,
                checksum: None,
                updated_at_ms: now_ms(),
            };
            state.watermarks.get(&watermark_key(&probe)).cloned()
        })
}

async fn commit_watermark(
    payload: Value,
    adapter_id: &str,
    state: Arc<Mutex<SourceSidecarState>>,
) -> Result<Value, String> {
    let mut watermark = payload
        .get("watermark")
        .cloned()
        .or_else(|| payload.get("watermark_after").cloned())
        .ok_or_else(|| "source.watermark.commit requires watermark".to_string())
        .and_then(|value| {
            serde_json::from_value::<SourceWatermark>(value)
                .map_err(|error| format!("invalid source watermark: {error}"))
        })?;
    if watermark.adapter_id.trim().is_empty() {
        watermark.adapter_id = adapter_id.to_string();
    }
    if watermark.adapter_id != adapter_id {
        return Err(format!(
            "adapter mismatch: watermark `{}` routed to `{adapter_id}`",
            watermark.adapter_id
        ));
    }
    watermark.updated_at_ms = now_ms();
    let mut state = state.lock().await;
    state
        .watermarks
        .insert(watermark_key(&watermark), watermark.clone());
    Ok(serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "watermark": watermark,
    }))
}

fn watermark_after_batch(
    batch: &SourceRecordBatch,
    before: Option<&SourceWatermark>,
    metadata: &Value,
) -> SourceWatermark {
    let strategy = metadata
        .get("updated_at_field")
        .and_then(Value::as_str)
        .map(|_| "updated_at_field")
        .or_else(|| {
            metadata
                .get("cursor_field")
                .and_then(Value::as_str)
                .map(|_| "cursor_field")
        })
        .unwrap_or("offset");
    let high_watermark = match strategy {
        "updated_at_field" => metadata
            .get("updated_at_field")
            .and_then(Value::as_str)
            .and_then(|field| max_string_field(&batch.rows, field)),
        "cursor_field" => metadata
            .get("cursor_field")
            .and_then(Value::as_str)
            .and_then(|field| max_string_field(&batch.rows, field)),
        _ => None,
    };
    let cursor = match strategy {
        "cursor_field" => high_watermark.clone(),
        _ => batch
            .cursor
            .next_offset
            .map(|offset| offset.to_string())
            .or_else(|| before.and_then(|watermark| watermark.cursor.clone())),
    };
    SourceWatermark {
        adapter_id: batch.adapter_id.clone(),
        resource_ref: batch.resource_ref.clone(),
        table: batch.table.clone(),
        strategy: strategy.to_string(),
        cursor,
        offset: Some(
            batch
                .cursor
                .next_offset
                .unwrap_or(batch.cursor.offset.saturating_add(batch.rows.len())),
        ),
        high_watermark,
        checksum: Some(batch.checksum.clone()),
        updated_at_ms: now_ms(),
    }
}

fn event_watermark(adapter_id: &str, object: &Map<String, Value>) -> SourceWatermark {
    SourceWatermark {
        adapter_id: adapter_id.to_string(),
        resource_ref: object
            .get("events")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|event| event.get("resource_ref"))
            .and_then(Value::as_str)
            .unwrap_or("event://source")
            .to_string(),
        table: object
            .get("events")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|event| event.get("table"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        strategy: "event_count".to_string(),
        cursor: object
            .get("event_count")
            .and_then(Value::as_u64)
            .map(|value| value.to_string()),
        offset: object
            .get("event_count")
            .and_then(Value::as_u64)
            .map(|value| value as usize),
        high_watermark: None,
        checksum: Some(checksum_rows(
            object
                .get("events")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        )),
        updated_at_ms: now_ms(),
    }
}

fn degraded_reason_for_incremental(
    metadata: &Value,
    watermark: &SourceWatermark,
) -> Option<String> {
    if watermark.strategy == "offset"
        && metadata.get("updated_at_field").is_none()
        && metadata.get("cursor_field").is_none()
    {
        Some("degraded_incremental_offset_only".to_string())
    } else {
        None
    }
}

fn max_string_field(rows: &[Value], field: &str) -> Option<String> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter_map(|object| object.get(field))
        .filter_map(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
                .or_else(|| value.as_u64().map(|number| number.to_string()))
        })
        .max()
}

fn watermark_key(watermark: &SourceWatermark) -> String {
    format!(
        "{}|{}|{}",
        watermark.adapter_id,
        watermark.resource_ref,
        watermark.table.as_deref().unwrap_or("")
    )
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn normalize_source_event(adapter_id: &str, event: &Value) -> Value {
    let table = string_at(event, &["table"])
        .or_else(|| string_at(event, &["table_id"]))
        .or_else(|| string_at(event, &["event", "table_id"]))
        .or_else(|| string_at(event, &["event", "table", "table_id"]));
    let app_token =
        string_at(event, &["app_token"]).or_else(|| string_at(event, &["event", "app_token"]));
    let resource_ref = string_at(event, &["resource_ref"])
        .map(ToString::to_string)
        .or_else(|| match (app_token, table) {
            (Some(app_token), Some(table)) if adapter_id.contains("bitable") => {
                Some(format!("bitable://{app_token}/{table}"))
            }
            _ => None,
        });
    serde_json::json!({
        "adapter_id": adapter_id,
        "event_id": string_at(event, &["event_id"])
            .or_else(|| string_at(event, &["uuid"]))
            .or_else(|| string_at(event, &["header", "event_id"]))
            .unwrap_or(""),
        "event_type": string_at(event, &["event_type"])
            .or_else(|| string_at(event, &["type"]))
            .or_else(|| string_at(event, &["header", "event_type"]))
            .or_else(|| string_at(event, &["event", "type"]))
            .unwrap_or("unknown"),
        "operation": string_at(event, &["operation"])
            .or_else(|| string_at(event, &["action"]))
            .or_else(|| string_at(event, &["event", "operation"]))
            .or_else(|| string_at(event, &["event", "action"]))
            .unwrap_or("unknown"),
        "resource_ref": resource_ref,
        "table": table,
        "record_ids": record_ids_from_event(event),
        "rows": rows_from_event(event),
        "occurred_at": string_at(event, &["occurred_at"])
            .or_else(|| string_at(event, &["timestamp"]))
            .or_else(|| string_at(event, &["header", "create_time"])),
        "raw": event,
    })
}

fn rows_from_event(event: &Value) -> Vec<Value> {
    event
        .get("rows")
        .or_else(|| event.get("records"))
        .or_else(|| event.get("items"))
        .or_else(|| event.get("event").and_then(|event| event.get("records")))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn record_ids_from_event(event: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for path in [
        &["record_id"][..],
        &["event", "record_id"][..],
        &["data", "record_id"][..],
    ] {
        if let Some(value) = string_at(event, path) {
            ids.push(value.to_string());
        }
    }
    for path in [
        &["record_ids"][..],
        &["event", "record_ids"][..],
        &["data", "record_ids"][..],
    ] {
        if let Some(values) = array_strings_at(event, path) {
            ids.extend(values);
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

fn string_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str()
}

fn array_strings_at(value: &Value, path: &[&str]) -> Option<Vec<String>> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_array().map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect()
    })
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
        resource_ref: sanitize_resource_ref(&plan.resource_ref),
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

fn sanitize_resource_ref(resource_ref: &str) -> String {
    let Some((scheme, tail)) = resource_ref.split_once("://") else {
        return resource_ref.to_string();
    };
    let Some((userinfo, rest)) = tail.split_once('@') else {
        return resource_ref.to_string();
    };
    if userinfo.contains(':') {
        format!("{scheme}://***:***@{rest}")
    } else {
        resource_ref.to_string()
    }
}

pub(crate) fn checksum_rows(rows: &[Value]) -> String {
    let mut hasher = Sha256::new();
    for row in rows {
        hasher.update(serde_json::to_vec(row).unwrap_or_default());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_wrapped_read_plan_payload() {
        let plan = source_plan_from_payload(
            serde_json::json!({
                "read_plan": {
                    "adapter_id": "feishu_bitable",
                    "resource_ref": "bitable://app/table",
                    "table": "table",
                    "metadata": {"rows": [{"name": "alpha"}]}
                }
            }),
            "feishu_bitable",
        )
        .unwrap();

        assert_eq!(plan.adapter_id, "feishu_bitable");
        assert_eq!(plan.table.as_deref(), Some("table"));
    }

    #[tokio::test]
    async fn discovers_fixture_schema_without_remote_credentials() {
        let payload = serde_json::json!({
            "adapter_id": "feishu_bitable",
            "resource_ref": "bitable://app/table",
            "table": "orders",
            "metadata": {
                "rows": [
                    {"sku": "A1", "qty": 3, "ready": true}
                ]
            }
        });
        let schema = discover_bitable_schema(
            payload,
            "feishu_bitable",
            Value::Null,
            "https://open.feishu.cn",
        )
        .await
        .unwrap();
        let fields = schema
            .pointer("/source_schema/tables/0/fields")
            .and_then(Value::as_array)
            .unwrap();

        assert!(fields.iter().any(|field| field["name"] == "sku"));
        assert!(fields.iter().any(|field| field["name"] == "qty"));
    }

    #[test]
    fn normalizes_source_events_from_remote_payload() {
        let payload = serde_json::json!({
            "events": [{
                "event_id": "evt-1",
                "event_type": "record.changed",
                "operation": "update",
                "app_token": "app",
                "table_id": "tbl",
                "record_ids": ["rec-1", "rec-1", "rec-2"]
            }]
        });
        let normalized = normalize_source_events(payload, "feishu_bitable").unwrap();

        assert_eq!(normalized["event_count"], 1);
        assert_eq!(
            normalized["source_events"][0]["resource_ref"],
            "bitable://app/tbl"
        );
        assert_eq!(
            normalized["source_events"][0]["record_ids"],
            serde_json::json!(["rec-1", "rec-2"])
        );
    }

    #[test]
    fn fixture_batch_masks_resource_credentials() {
        let batch = record_batch_from_rows(
            SourceReadPlan {
                adapter_id: "postgres".to_string(),
                resource_ref: "postgres://user:secret@localhost/db".to_string(),
                table: Some("orders".to_string()),
                fields: Vec::new(),
                limit: None,
                offset: None,
                cursor: None,
                metadata: Value::Null,
            },
            vec![serde_json::json!({"sku": "A1"})],
            false,
        );

        assert_eq!(batch.resource_ref, "postgres://***:***@localhost/db");
    }

    #[tokio::test]
    async fn source_incremental_run_fixture_updates_watermark_without_committing() {
        let state = Arc::new(Mutex::new(SourceSidecarState {
            configured: true,
            ..SourceSidecarState::default()
        }));
        let payload = serde_json::json!({
            "request": {
                "adapter_id": "feishu_bitable",
                "resource_ref": "bitable://app/orders",
                "table": "orders",
                "limit": 10,
                "metadata": {
                    "rows": [
                        {"order_id": "O-1", "updated_at": "2026-07-08T01:00:00Z"},
                        {"order_id": "O-2", "updated_at": "2026-07-08T02:00:00Z"}
                    ],
                    "updated_at_field": "updated_at"
                }
            }
        });
        let result = run_incremental_source(
            payload,
            "feishu_bitable",
            "https://open.feishu.cn",
            state.clone(),
        )
        .await
        .unwrap();

        assert_eq!(result["status"], "ok");
        assert_eq!(result["batch"]["rows"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["watermark_after"]["high_watermark"],
            "2026-07-08T02:00:00Z"
        );
        assert!(state.lock().await.watermarks.is_empty());
        commit_watermark(
            serde_json::json!({"watermark": result["watermark_after"].clone()}),
            "feishu_bitable",
            state.clone(),
        )
        .await
        .unwrap();
        assert_eq!(state.lock().await.watermarks.len(), 1);
    }

    #[tokio::test]
    async fn source_event_poll_fixture_returns_event_batch() {
        let state = Arc::new(Mutex::new(SourceSidecarState::default()));
        let payload = poll_source_events(
            serde_json::json!({
                "events": [{
                    "event_id": "evt-1",
                    "event_type": "record.changed",
                    "operation": "upsert",
                    "resource_ref": "bitable://app/orders",
                    "table": "orders"
                }]
            }),
            "feishu_bitable",
            state,
        )
        .await
        .unwrap();

        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["event_count"], 1);
        assert_eq!(payload["watermark_after"]["strategy"], "event_count");
    }

    #[tokio::test]
    async fn source_event_poll_without_event_source_returns_degraded() {
        let state = Arc::new(Mutex::new(SourceSidecarState::default()));
        let payload = poll_source_events(Value::Null, "feishu_bitable", state)
            .await
            .unwrap();

        assert_eq!(payload["status"], "degraded");
        assert_eq!(payload["degraded_reason"], "requires_external_event_source");
    }
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
