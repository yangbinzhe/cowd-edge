use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::{Duration, Instant};

use edge_contract::{
    SourceBatchCursor, SourceFieldSchema, SourceIncrementalRunRequest, SourceReadPlan,
    SourceRecordBatch, SourceTableSchema, SourceWatermark, SurfaceFrame,
};
use futures::stream;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, RwLock};

use crate::managed_server::{ManagedEdgeHandler, ManagedFrameStream, ManagedHandlerFactory};

const SOURCE_STREAM_MAX_ROWS: usize = 128;
const SOURCE_STREAM_MAX_BYTES: usize = 256 * 1024;

#[cfg(feature = "source-db")]
use crate::source_db::{self, DatabaseDialect, DatabasePoolRegistry};

struct CachedBitableToken {
    value: String,
    expires_at: Instant,
}

struct SourceBackendGeneration {
    config: Value,
    http: reqwest::Client,
    bitable_token: Mutex<Option<CachedBitableToken>>,
    #[cfg(feature = "source-db")]
    database_pools: DatabasePoolRegistry,
}

impl SourceBackendGeneration {
    fn new(config: Value) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("source http client build failed: {error}"))?;
        Ok(Self {
            config,
            http,
            bitable_token: Mutex::new(None),
            #[cfg(feature = "source-db")]
            database_pools: DatabasePoolRegistry::default(),
        })
    }
}

#[derive(Default)]
struct ResourceLaneRegistry {
    lanes: StdMutex<HashMap<String, Weak<Mutex<()>>>>,
}

impl ResourceLaneRegistry {
    fn lane(&self, resource_key: String) -> Arc<Mutex<()>> {
        let mut lanes = self.lanes.lock().unwrap_or_else(|error| error.into_inner());
        lanes.retain(|_, lane| lane.strong_count() > 0);
        if let Some(lane) = lanes.get(&resource_key).and_then(Weak::upgrade) {
            return lane;
        }
        let lane = Arc::new(Mutex::new(()));
        lanes.insert(resource_key, Arc::downgrade(&lane));
        lane
    }
}

/// Source 配置 generation、健康状态与同 resource 增量顺序的唯一 owner。
struct SourceConnectorRuntime {
    generation: RwLock<Option<Arc<SourceBackendGeneration>>>,
    configured: AtomicBool,
    last_error: RwLock<Option<String>>,
    last_run_at_ms: AtomicI64,
    lanes: ResourceLaneRegistry,
}

impl SourceConnectorRuntime {
    fn new() -> Self {
        Self {
            generation: RwLock::new(None),
            configured: AtomicBool::new(false),
            last_error: RwLock::new(None),
            last_run_at_ms: AtomicI64::new(-1),
            lanes: ResourceLaneRegistry::default(),
        }
    }

    async fn generation(&self) -> Result<Arc<SourceBackendGeneration>, String> {
        self.generation
            .read()
            .await
            .clone()
            .ok_or_else(|| "source connector is not configured".to_string())
    }

    async fn set_error(&self, error: Option<String>) {
        *self.last_error.write().await = error;
    }
}

pub struct SourceManagedHandler {
    surface_id: String,
    adapter_id: String,
    default_base_url: String,
    runtime: Arc<SourceConnectorRuntime>,
}

impl SourceManagedHandler {
    #[must_use]
    pub fn new(surface_id: &str, adapter_id: &str, default_base_url: &str) -> Self {
        Self {
            surface_id: surface_id.to_string(),
            adapter_id: adapter_id.to_string(),
            default_base_url: default_base_url.to_string(),
            runtime: Arc::new(SourceConnectorRuntime::new()),
        }
    }
}

#[async_trait::async_trait]
impl ManagedEdgeHandler for SourceManagedHandler {
    async fn handle(&self, frame: SurfaceFrame) -> Result<SurfaceFrame, String> {
        Ok(handle_frame(
            frame,
            &self.surface_id,
            &self.adapter_id,
            &self.default_base_url,
            self.runtime.clone(),
        )
        .await)
    }

    async fn handle_stream(&self, frame: SurfaceFrame) -> Result<ManagedFrameStream, String> {
        let incremental = matches!(
            &frame,
            SurfaceFrame::Action { action, .. }
                if action == "source.incremental.run" || action == "source.incremental_run"
        );
        let response = self.handle(frame).await?;
        if !incremental {
            return Ok(Box::pin(stream::once(async move { Ok(response) })));
        }
        source_incremental_frame_stream(response)
    }
}

struct SourceIncrementalChunkState {
    id: String,
    payload: Map<String, Value>,
    batch: SourceRecordBatch,
    rows: VecDeque<Value>,
    watermark_after: Value,
    chunk_index: usize,
    emitted_empty: bool,
}

fn source_incremental_frame_stream(response: SurfaceFrame) -> Result<ManagedFrameStream, String> {
    let SurfaceFrame::Ok { id, payload } = response else {
        return Ok(Box::pin(stream::once(async move { Ok(response) })));
    };
    let Value::Object(mut payload) = payload else {
        return Err("source incremental response payload must be an object".to_string());
    };
    let batch_value = payload
        .remove("batch")
        .ok_or_else(|| "source incremental response missing batch".to_string())?;
    let mut batch = serde_json::from_value::<SourceRecordBatch>(batch_value)
        .map_err(|error| format!("source incremental batch encode failed: {error}"))?;
    for row in &batch.rows {
        let row_bytes = serde_json::to_vec(row)
            .map_err(|error| format!("source row encode failed: {error}"))?
            .len();
        if row_bytes > SOURCE_STREAM_MAX_BYTES {
            return Err(format!(
                "source row exceeds stream chunk limit: {row_bytes} > {SOURCE_STREAM_MAX_BYTES}"
            ));
        }
    }
    let rows = std::mem::take(&mut batch.rows).into();
    let watermark_after = payload.remove("watermark_after").unwrap_or(Value::Null);
    let state = SourceIncrementalChunkState {
        id,
        payload,
        batch,
        rows,
        watermark_after,
        chunk_index: 0,
        emitted_empty: false,
    };
    Ok(Box::pin(stream::unfold(state, |mut state| async move {
        if state.rows.is_empty() && (state.chunk_index > 0 || state.emitted_empty) {
            return None;
        }
        let mut rows = Vec::new();
        let mut bytes = 0usize;
        while rows.len() < SOURCE_STREAM_MAX_ROWS {
            let Some(row) = state.rows.front() else {
                break;
            };
            let row_bytes =
                serde_json::to_vec(row).map_or(SOURCE_STREAM_MAX_BYTES, |row| row.len());
            if !rows.is_empty() && bytes.saturating_add(row_bytes) > SOURCE_STREAM_MAX_BYTES {
                break;
            }
            bytes = bytes.saturating_add(row_bytes);
            rows.push(state.rows.pop_front().expect("source row exists"));
        }
        if rows.is_empty() {
            state.emitted_empty = true;
        }
        let final_chunk = state.rows.is_empty();
        let mut batch = state.batch.clone();
        batch.row_count = rows.len();
        batch.checksum = checksum_rows(&rows);
        batch.rows = rows;
        let mut payload = state.payload.clone();
        payload.insert(
            "batch".to_string(),
            serde_json::to_value(batch).unwrap_or(Value::Null),
        );
        payload.insert("chunk_index".to_string(), Value::from(state.chunk_index));
        payload.insert("final_chunk".to_string(), Value::Bool(final_chunk));
        payload.insert(
            "watermark_after".to_string(),
            if final_chunk {
                state.watermark_after.clone()
            } else {
                Value::Null
            },
        );
        let frame = SurfaceFrame::Ok {
            id: state.id.clone(),
            payload: Value::Object(payload),
        };
        state.chunk_index = state.chunk_index.saturating_add(1);
        Some((Ok(frame), state))
    })))
}

#[must_use]
pub fn managed_source_factory(artifact: &'static str) -> ManagedHandlerFactory {
    Arc::new(move |bootstrap, _events| {
        let Some(profile) = crate::driver_profiles::driver_profile(&bootstrap.driver_profile)
            .filter(|profile| profile.artifact == artifact && !profile.adapter_id.is_empty())
        else {
            return Err(format!(
                "unsupported source profile `{}`",
                bootstrap.driver_profile
            ));
        };
        if bootstrap.surface_id != profile.surface_id {
            return Err(format!(
                "surface `{}` does not match profile surface `{}`",
                bootstrap.surface_id, profile.surface_id,
            ));
        }
        Ok((
            Arc::new(SourceManagedHandler::new(
                profile.surface_id,
                profile.adapter_id,
                profile.default_base_url,
            )),
            profile
                .capabilities
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
        ))
    })
}

pub async fn run_stdio_source_connector(
    surface_id: &'static str,
    adapter_id: &'static str,
    default_base_url: &'static str,
) -> io::Result<()> {
    let runtime = Arc::new(SourceConnectorRuntime::new());
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
                    runtime.clone(),
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
    runtime: Arc<SourceConnectorRuntime>,
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
                "source.event".to_string(),
                "source.health".to_string(),
            ],
        },
        SurfaceFrame::Configure { id, config, .. } => match SourceBackendGeneration::new(config) {
            Ok(generation) => {
                *runtime.generation.write().await = Some(Arc::new(generation));
                runtime.configured.store(true, Ordering::Release);
                runtime.set_error(None).await;
                SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ok",
                        "surface": surface_id,
                        "adapter_id": adapter_id,
                    }),
                }
            }
            Err(error) => {
                runtime.configured.store(false, Ordering::Release);
                runtime.set_error(Some(error.clone())).await;
                SurfaceFrame::Error {
                    id: Some(id),
                    code: "source_config_invalid".to_string(),
                    message: error,
                }
            }
        },
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
            let configured = runtime.configured.load(Ordering::Acquire);
            let last_error = runtime.last_error.read().await.clone();
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": if configured { "ready" } else { "config_missing" },
                    "surface": surface_id,
                    "adapter_id": adapter_id,
                    "last_error": last_error,
                }),
            }
        }
        SurfaceFrame::Action {
            id,
            action,
            payload: _,
            ..
        } if action == "source.state" => SurfaceFrame::Ok {
            id,
            payload: source_state_payload(surface_id, adapter_id, default_base_url, &runtime).await,
        },
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } if action == "source.read_batch" => {
            match read_source_batch(payload, adapter_id, default_base_url, runtime.clone()).await {
                Ok(batch) => SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ok",
                        "source_batch": batch,
                    }),
                },
                Err(error) => {
                    runtime.set_error(Some(error.clone())).await;
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
            match discover_source_schema(payload, adapter_id, default_base_url, runtime.clone())
                .await
            {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    runtime.set_error(Some(error.clone())).await;
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
            match run_incremental_source(payload, adapter_id, default_base_url, runtime.clone())
                .await
            {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    runtime.set_error(Some(error.clone())).await;
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
                    runtime.set_error(Some(error.clone())).await;
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
                    runtime.set_error(Some(error.clone())).await;
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
            match poll_source_events(payload, adapter_id, runtime.clone()).await {
                Ok(payload) => SurfaceFrame::Ok { id, payload },
                Err(error) => {
                    runtime.set_error(Some(error.clone())).await;
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
    runtime: Arc<SourceConnectorRuntime>,
) -> Result<SourceRecordBatch, String> {
    let plan = source_plan_from_payload(payload, adapter_id)?;

    #[cfg(test)]
    if let Some(delay_ms) = plan
        .metadata
        .get("fixture_delay_ms")
        .and_then(Value::as_u64)
    {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    if let Some(rows) = rows_from_metadata(&plan.metadata)? {
        return Ok(record_batch_from_rows(plan, rows, false));
    }

    let generation = runtime.generation().await?;
    #[cfg(feature = "source-db")]
    if let Some(dialect) = DatabaseDialect::from_adapter(adapter_id) {
        return source_db::read_database_batch(
            plan,
            generation.config.clone(),
            dialect,
            &generation.database_pools,
        )
        .await;
    }
    read_feishu_bitable_batch(plan, &generation, default_base_url).await
}

async fn discover_source_schema(
    payload: Value,
    adapter_id: &str,
    default_base_url: &str,
    runtime: Arc<SourceConnectorRuntime>,
) -> Result<Value, String> {
    let generation = runtime.generation().await?;
    #[cfg(feature = "source-db")]
    if DatabaseDialect::from_adapter(adapter_id).is_some() {
        return source_db::discover_database_schema(
            payload,
            adapter_id,
            generation.config.clone(),
            &generation.database_pools,
        )
        .await;
    }
    discover_bitable_schema(payload, adapter_id, &generation, default_base_url).await
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
    runtime: Arc<SourceConnectorRuntime>,
) -> Result<Value, String> {
    let mut request = incremental_request_from_payload(payload, adapter_id)?;
    if let Some(expected_revision) = request.expected_revision {
        let actual_revision = request
            .watermark
            .as_ref()
            .map_or(0, |watermark| watermark.revision);
        if expected_revision != actual_revision {
            return Err(format!(
                "source watermark revision mismatch: expected {expected_revision}, got {actual_revision}"
            ));
        }
    }
    let state_watermark = request.watermark.clone();
    let resource_key = format!(
        "{}\0{}\0{}",
        request.adapter_id,
        sanitize_resource_ref(&request.resource_ref),
        request.table.as_deref().unwrap_or("")
    );
    let lane = runtime.lanes.lane(resource_key);
    let _lane_guard = lane.lock().await;
    request.watermark = state_watermark.clone();
    let mut plan = SourceReadPlan {
        adapter_id: request.adapter_id.clone(),
        resource_ref: request.resource_ref.clone(),
        table: request.table.clone(),
        fields: Vec::new(),
        limit: request.limit,
        offset: None,
        cursor: None,
        metadata: request.metadata.clone(),
    };
    apply_incremental_watermark_to_plan(&mut plan, state_watermark.as_ref());
    let batch = read_source_batch(
        serde_json::json!({ "read_plan": plan }),
        adapter_id,
        default_base_url,
        runtime.clone(),
    )
    .await?;
    let watermark_after =
        watermark_after_batch(&batch, state_watermark.as_ref(), &request.metadata);
    runtime.last_run_at_ms.store(now_ms(), Ordering::Release);
    runtime.set_error(None).await;
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
    match watermark.strategy.as_str() {
        "updated_at_field" => {
            plan.cursor = watermark.high_watermark.clone();
            plan.offset = watermark.offset;
        }
        "cursor_field" => {
            plan.cursor = watermark.cursor.clone();
            plan.offset = watermark.offset;
        }
        "offset" => {
            plan.cursor = None;
            plan.offset = watermark.offset;
        }
        _ => {
            // 未知策略不猜测字段语义，避免把数字 offset 注入时间/字段游标。
            plan.cursor = None;
            plan.offset = None;
        }
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
    generation: &SourceBackendGeneration,
    default_base_url: &str,
) -> Result<SourceRecordBatch, String> {
    let config = &generation.config;
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
    let token = tenant_access_token(generation, base_url, app_id, app_secret).await?;
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
    let response = generation
        .http
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
    generation: &SourceBackendGeneration,
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

    let config = &generation.config;
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
    let token = tenant_access_token(generation, base_url, app_id, app_secret).await?;
    let response = generation
        .http
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
    runtime: Arc<SourceConnectorRuntime>,
) -> Result<Value, String> {
    let generation = runtime.generation().await?;
    let mut events = events_from_value(&payload)?;
    if events.is_empty() {
        events = events_from_value(&generation.config)?;
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

async fn source_state_payload(
    surface_id: &str,
    adapter_id: &str,
    default_base_url: &str,
    runtime: &SourceConnectorRuntime,
) -> Value {
    let generation = runtime.generation.read().await.clone();
    let config = generation
        .as_ref()
        .map_or(&Value::Null, |generation| &generation.config);
    let has_event_fixture = !events_from_value(config).unwrap_or_default().is_empty();
    let supports_real_events = config
        .get("event_poll_url")
        .and_then(Value::as_str)
        .is_some();
    let configured = runtime.configured.load(Ordering::Acquire);
    let last_run_at_ms = runtime.last_run_at_ms.load(Ordering::Acquire);
    let last_error = runtime.last_error.read().await.clone();
    serde_json::json!({
        "status": "ok",
        "state": {
            "adapter_id": adapter_id,
            "surface_id": surface_id,
            "status": if configured { "ready" } else { "config_missing" },
            "capabilities": [
                "source.schema_discovery",
                "source.snapshot",
                "source.incremental",
                "source.event.poll"
            ],
            "last_run_at_ms": (last_run_at_ms >= 0).then_some(last_run_at_ms),
            "last_error": last_error,
            "degraded_reason": if !supports_real_events && !has_event_fixture {
                Some("requires_external_event_source")
            } else {
                None
            },
            "watermarks": [],
            "watermark_owner": "gateway_matrix",
            "configured": configured,
            "supports_real_event_poll": supports_real_events,
            "default_base_url": default_base_url,
        }
    })
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
    let continuation_offset = batch.truncated.then(|| {
        batch
            .cursor
            .next_offset
            .unwrap_or(batch.cursor.offset.saturating_add(batch.rows.len()))
    });
    let previous_incremental_value = |watermark: &SourceWatermark| {
        if strategy == "updated_at_field" {
            watermark.high_watermark.clone()
        } else {
            watermark
                .cursor
                .clone()
                .or_else(|| watermark.high_watermark.clone())
        }
    };
    let observed_incremental_value = || match strategy {
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
    let incremental_value = if batch.truncated {
        before.and_then(previous_incremental_value)
    } else {
        observed_incremental_value().or_else(|| before.and_then(previous_incremental_value))
    };
    let (high_watermark, cursor, offset) = match strategy {
        "updated_at_field" => (incremental_value, None, continuation_offset),
        "cursor_field" => (
            incremental_value.clone(),
            incremental_value,
            continuation_offset,
        ),
        _ => (
            None,
            None,
            Some(
                batch
                    .cursor
                    .next_offset
                    .unwrap_or(batch.cursor.offset.saturating_add(batch.rows.len())),
            ),
        ),
    };
    SourceWatermark {
        adapter_id: batch.adapter_id.clone(),
        resource_ref: batch.resource_ref.clone(),
        table: batch.table.clone(),
        strategy: strategy.to_string(),
        cursor,
        offset,
        high_watermark,
        checksum: Some(batch.checksum.clone()),
        revision: before.map_or(0, |watermark| watermark.revision),
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
        revision: 0,
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
    generation: &SourceBackendGeneration,
    base_url: &str,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let mut cached = generation.bitable_token.lock().await;
    if let Some(token) = cached
        .as_ref()
        .filter(|token| token.expires_at > Instant::now() + Duration::from_secs(60))
    {
        return Ok(token.value.clone());
    }
    let response = generation
        .http
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
    let token = value
        .get("tenant_access_token")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "tenant access token response missing token".to_string())?;
    let expires_in = value
        .get("expire")
        .or_else(|| value.get("expire_in"))
        .and_then(Value::as_u64)
        .unwrap_or(7200)
        .max(120);
    *cached = Some(CachedBitableToken {
        value: token.clone(),
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });
    Ok(token)
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
    let Some((userinfo, rest)) = tail.rsplit_once('@') else {
        return resource_ref.to_string();
    };
    if userinfo.is_empty() {
        resource_ref.to_string()
    } else {
        format!("{scheme}://***:***@{rest}")
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
    use edge_contract::{EdgeBootstrapRequest, EDGE_PROTOCOL_V2};
    use futures::StreamExt;

    #[tokio::test]
    async fn feishu_and_lark_profiles_share_artifact_without_state_or_domain_cross_talk() {
        let factory = managed_source_factory("cowd-edge-bitable-source");
        let (events, _event_rx) = tokio::sync::mpsc::channel(8);
        let make = |surface: &str, profile: &str| EdgeBootstrapRequest {
            protocol: EDGE_PROTOCOL_V2.to_string(),
            gateway_version: "test".to_string(),
            surface_id: surface.to_string(),
            driver_profile: profile.to_string(),
            capabilities: crate::driver_profiles::driver_profile(profile)
                .unwrap()
                .capabilities
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        };
        let (feishu, _) = factory(&make("feishu-bitable", "feishu-bitable"), events.clone())
            .expect("Feishu profile must bootstrap");
        let (lark, _) = factory(&make("lark-bitable", "lark-bitable"), events)
            .expect("Lark profile must bootstrap");

        let feishu_state = feishu
            .handle(SurfaceFrame::Action {
                id: "f".to_string(),
                surface: "feishu-bitable".to_string(),
                action: "source.state".to_string(),
                payload: Value::Null,
            })
            .await
            .unwrap();
        let lark_state = lark
            .handle(SurfaceFrame::Action {
                id: "l".to_string(),
                surface: "lark-bitable".to_string(),
                action: "source.state".to_string(),
                payload: Value::Null,
            })
            .await
            .unwrap();
        let SurfaceFrame::Ok {
            payload: feishu_payload,
            ..
        } = feishu_state
        else {
            panic!("unexpected Feishu response")
        };
        let SurfaceFrame::Ok {
            payload: lark_payload,
            ..
        } = lark_state
        else {
            panic!("unexpected Lark response")
        };
        assert_eq!(
            feishu_payload["state"]["default_base_url"],
            "https://open.feishu.cn"
        );
        assert_eq!(
            lark_payload["state"]["default_base_url"],
            "https://open.larksuite.com"
        );
        assert_eq!(feishu_payload["state"]["adapter_id"], "feishu_bitable");
        assert_eq!(lark_payload["state"]["adapter_id"], "lark_bitable");
    }

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
        let generation = SourceBackendGeneration::new(Value::Null).unwrap();
        let schema = discover_bitable_schema(
            payload,
            "feishu_bitable",
            &generation,
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
    async fn source_incremental_run_fixture_returns_candidate_without_edge_commit() {
        let runtime = Arc::new(SourceConnectorRuntime::new());
        *runtime.generation.write().await = Some(Arc::new(
            SourceBackendGeneration::new(serde_json::json!({})).unwrap(),
        ));
        runtime.configured.store(true, Ordering::Release);
        let payload = serde_json::json!({
            "request": {
                "adapter_id": "feishu_bitable",
                "resource_ref": "bitable://app/orders",
                "table": "orders",
                "limit": 10,
                "watermark": {
                    "adapter_id": "feishu_bitable",
                    "resource_ref": "bitable://app/orders",
                    "table": "orders",
                    "strategy": "updated_at_field",
                    "high_watermark": "2026-07-08T00:00:00Z",
                    "revision": 7,
                    "updated_at_ms": 1
                },
                "metadata": {
                    "rows": [
                        {"order_id": "O-1", "updated_at": "2026-07-08T01:00:00Z"},
                        {"order_id": "O-2", "updated_at": "2026-07-08T02:00:00Z"}
                    ],
                    "updated_at_field": "updated_at"
                }
            }
        });
        let result =
            run_incremental_source(payload, "feishu_bitable", "https://open.feishu.cn", runtime)
                .await
                .unwrap();

        assert_eq!(result["status"], "ok");
        assert_eq!(result["batch"]["rows"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["watermark_after"]["high_watermark"],
            "2026-07-08T02:00:00Z"
        );
        assert_eq!(result["watermark_after"]["revision"], 7);
        assert!(result["watermark_after"]["cursor"].is_null());
        assert!(result["watermark_after"]["offset"].is_null());
    }

    #[cfg(feature = "source-db")]
    #[tokio::test]
    async fn live_postgres_schema_snapshot_and_paged_incremental_are_continuous() {
        let Some(database_url) =
            std::env::var_os("COWD_LIVE_POSTGRES_URL").and_then(|value| value.into_string().ok())
        else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("connect live PostgreSQL");
        let table = format!("cowd_connector_test_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!(
            "CREATE TABLE {table} (id BIGINT PRIMARY KEY, name TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL)"
        ))
        .execute(&pool)
        .await
        .expect("create live source table");
        sqlx::query(&format!(
            "INSERT INTO {table} (id, name, updated_at) VALUES (1, 'first', '2026-07-19T01:00:00Z'), (2, 'second', '2026-07-19T01:00:00Z'), (3, 'third', '2026-07-19T01:00:00Z')"
        ))
        .execute(&pool)
        .await
        .expect("seed live source table");

        let runtime = configured_runtime(serde_json::json!({
            "database_url": database_url
        }))
        .await;
        let schema = discover_source_schema(
            serde_json::json!({
                "adapter_id": "postgres",
                "resource_ref": database_url,
                "table": table
            }),
            "postgres",
            "",
            runtime.clone(),
        )
        .await
        .expect("discover live PostgreSQL schema");
        assert_eq!(
            schema["source_schema"]["tables"][0]["primary_key"],
            serde_json::json!(["id"])
        );

        let snapshot = read_source_batch(
            serde_json::json!({
                "read_plan": {
                    "adapter_id": "postgres",
                    "resource_ref": database_url,
                    "table": table,
                    "limit": 100,
                    "metadata": {}
                }
            }),
            "postgres",
            "",
            runtime.clone(),
        )
        .await
        .expect("read live PostgreSQL snapshot");
        assert_eq!(snapshot.row_count, 3);
        assert!(!snapshot
            .resource_ref
            .contains("cowd_connector_test:cowd_connector_test"));

        let request = |watermark: Option<SourceWatermark>| {
            serde_json::json!({
                "request": {
                    "adapter_id": "postgres",
                    "resource_ref": database_url,
                    "table": table,
                    "limit": 1,
                    "watermark": watermark,
                    "metadata": {"updated_at_field": "updated_at"}
                }
            })
        };
        let first = run_incremental_source(request(None), "postgres", "", runtime.clone())
            .await
            .expect("first live incremental run");
        assert_eq!(first["batch"]["row_count"], 1);
        assert!(first["batch"]["truncated"].as_bool().unwrap());
        assert!(first["watermark_after"]["high_watermark"].is_null());
        assert!(first["watermark_after"]["cursor"].is_null());
        assert_eq!(first["watermark_after"]["offset"], 1);
        let first_watermark =
            serde_json::from_value::<SourceWatermark>(first["watermark_after"].clone())
                .expect("decode first watermark");

        let second = run_incremental_source(
            request(Some(first_watermark)),
            "postgres",
            "",
            runtime.clone(),
        )
        .await
        .expect("second paged live incremental run");
        assert_eq!(second["batch"]["row_count"], 1);
        assert!(second["batch"]["truncated"].as_bool().unwrap());
        assert!(second["watermark_after"]["high_watermark"].is_null());
        assert_eq!(second["watermark_after"]["offset"], 2);
        let second_watermark =
            serde_json::from_value::<SourceWatermark>(second["watermark_after"].clone())
                .expect("decode second watermark");

        let third = run_incremental_source(
            request(Some(second_watermark)),
            "postgres",
            "",
            runtime.clone(),
        )
        .await
        .expect("third paged live incremental run");
        assert_eq!(third["batch"]["row_count"], 1);
        assert!(!third["batch"]["truncated"].as_bool().unwrap());
        assert_eq!(third["batch"]["rows"][0]["id"], 3);
        assert_eq!(
            third["watermark_after"]["high_watermark"],
            "2026-07-19T01:00:00+00:00"
        );
        assert!(third["watermark_after"]["offset"].is_null());
        let third_watermark =
            serde_json::from_value::<SourceWatermark>(third["watermark_after"].clone())
                .expect("decode third watermark");

        sqlx::query(&format!(
            "INSERT INTO {table} (id, name, updated_at) VALUES (4, 'fourth', '2026-07-19T02:00:00Z')"
        ))
        .execute(&pool)
        .await
        .expect("append live source row");
        let fourth =
            run_incremental_source(request(Some(third_watermark)), "postgres", "", runtime)
                .await
                .expect("fourth live incremental run");
        eprintln!(
            "first_watermark={} third_watermark={} fourth_batch={}",
            first["watermark_after"], third["watermark_after"], fourth["batch"]
        );

        sqlx::query(&format!("DROP TABLE {table}"))
            .execute(&pool)
            .await
            .expect("drop live source table");
        assert_eq!(fourth["batch"]["row_count"], 1);
        assert_eq!(fourth["batch"]["rows"][0]["id"], 4);
        assert_eq!(
            fourth["watermark_after"]["high_watermark"],
            "2026-07-19T02:00:00+00:00"
        );
        assert!(fourth["watermark_after"]["cursor"].is_null());
    }

    #[test]
    fn updated_at_watermark_pages_a_stable_window_without_coercing_offset_to_cursor() {
        let before = SourceWatermark {
            adapter_id: "postgres".to_string(),
            resource_ref: "postgres://***:***@localhost/orders".to_string(),
            table: Some("orders".to_string()),
            strategy: "updated_at_field".to_string(),
            cursor: None,
            offset: None,
            high_watermark: Some("2026-07-19T01:00:00Z".to_string()),
            checksum: None,
            revision: 4,
            updated_at_ms: 1,
        };
        let mut plan = SourceReadPlan {
            adapter_id: "postgres".to_string(),
            resource_ref: before.resource_ref.clone(),
            table: before.table.clone(),
            fields: Vec::new(),
            limit: Some(100),
            offset: None,
            cursor: None,
            metadata: serde_json::json!({"updated_at_field": "updated_at"}),
        };
        apply_incremental_watermark_to_plan(&mut plan, Some(&before));
        assert_eq!(plan.cursor.as_deref(), Some("2026-07-19T01:00:00Z"));
        assert_eq!(plan.offset, None);

        let batch = record_batch_from_rows(
            plan,
            vec![serde_json::json!({
                "id": 2,
                "updated_at": "2026-07-19T02:00:00Z"
            })],
            true,
        );
        let after = watermark_after_batch(
            &batch,
            Some(&before),
            &serde_json::json!({"updated_at_field": "updated_at"}),
        );
        assert_eq!(
            after.high_watermark.as_deref(),
            Some("2026-07-19T01:00:00Z")
        );
        assert_eq!(after.cursor, None);
        assert_eq!(after.offset, Some(1));

        let mut next_plan = SourceReadPlan {
            adapter_id: "postgres".to_string(),
            resource_ref: before.resource_ref,
            table: before.table,
            fields: Vec::new(),
            limit: Some(100),
            offset: None,
            cursor: None,
            metadata: serde_json::json!({"updated_at_field": "updated_at"}),
        };
        apply_incremental_watermark_to_plan(&mut next_plan, Some(&after));
        assert_eq!(next_plan.cursor.as_deref(), Some("2026-07-19T01:00:00Z"));
        assert_eq!(next_plan.offset, Some(1));
    }

    #[tokio::test]
    async fn incremental_runs_are_serial_per_resource_and_parallel_across_resources() {
        let runtime = configured_runtime(serde_json::json!({})).await;
        let payload = |resource: &str| {
            serde_json::json!({
                "request": {
                    "adapter_id": "feishu_bitable",
                    "resource_ref": resource,
                    "table": "orders",
                    "metadata": {
                        "rows": [{"order_id": "O-1"}],
                        "fixture_delay_ms": 30
                    }
                }
            })
        };

        let same_started = Instant::now();
        let _ = tokio::join!(
            run_incremental_source(
                payload("bitable://app/orders"),
                "feishu_bitable",
                "https://open.feishu.cn",
                runtime.clone(),
            ),
            run_incremental_source(
                payload("bitable://app/orders"),
                "feishu_bitable",
                "https://open.feishu.cn",
                runtime.clone(),
            )
        );
        let same_elapsed = same_started.elapsed();

        let cross_started = Instant::now();
        let _ = tokio::join!(
            run_incremental_source(
                payload("bitable://app/orders-a"),
                "feishu_bitable",
                "https://open.feishu.cn",
                runtime.clone(),
            ),
            run_incremental_source(
                payload("bitable://app/orders-b"),
                "feishu_bitable",
                "https://open.feishu.cn",
                runtime,
            )
        );
        let cross_elapsed = cross_started.elapsed();
        assert!(cross_elapsed < same_elapsed);
        eprintln!(
            "source_fixture same_resource_ms={} cross_resource_ms={}",
            same_elapsed.as_millis(),
            cross_elapsed.as_millis()
        );
    }

    #[tokio::test]
    async fn source_event_poll_fixture_returns_event_batch() {
        let runtime = configured_runtime(serde_json::json!({})).await;
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
            runtime,
        )
        .await
        .unwrap();

        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["event_count"], 1);
        assert_eq!(payload["watermark_after"]["strategy"], "event_count");
    }

    #[tokio::test]
    async fn source_event_poll_without_event_source_returns_degraded() {
        let runtime = configured_runtime(serde_json::json!({})).await;
        let payload = poll_source_events(Value::Null, "feishu_bitable", runtime)
            .await
            .unwrap();

        assert_eq!(payload["status"], "degraded");
        assert_eq!(payload["degraded_reason"], "requires_external_event_source");
    }

    #[tokio::test]
    async fn incremental_response_is_bounded_and_only_final_chunk_carries_watermark() {
        let rows = (0..300)
            .map(|index| serde_json::json!({"index": index, "value": "fixture"}))
            .collect::<Vec<_>>();
        let batch = SourceRecordBatch {
            adapter_id: "postgres".to_string(),
            resource_ref: "postgres://fixture/orders".to_string(),
            table: Some("orders".to_string()),
            schema: infer_schema("orders", &rows),
            checksum: checksum_rows(&rows),
            row_count: rows.len(),
            rows,
            cursor: SourceBatchCursor {
                offset: 0,
                limit: 300,
                next_offset: Some(300),
            },
            truncated: false,
        };
        let response = SurfaceFrame::Ok {
            id: "stream-test".to_string(),
            payload: serde_json::json!({
                "status": "ok",
                "batch": batch,
                "watermark_before": null,
                "watermark_after": {"revision": 0, "cursor": "300"}
            }),
        };
        let mut stream = source_incremental_frame_stream(response).unwrap();
        let mut chunks = Vec::new();
        while let Some(frame) = stream.next().await {
            let SurfaceFrame::Ok { payload, .. } = frame.unwrap() else {
                panic!("expected source stream chunk");
            };
            chunks.push(payload);
        }

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0]["chunk_index"], 0);
        assert_eq!(chunks[0]["final_chunk"], false);
        assert!(chunks[0]["watermark_after"].is_null());
        assert_eq!(chunks[2]["final_chunk"], true);
        assert_eq!(chunks[2]["watermark_after"]["cursor"], "300");
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk["batch"]["rows"].as_array().unwrap().len())
                .sum::<usize>(),
            300
        );
    }

    async fn configured_runtime(config: Value) -> Arc<SourceConnectorRuntime> {
        let runtime = Arc::new(SourceConnectorRuntime::new());
        *runtime.generation.write().await = Some(Arc::new(
            SourceBackendGeneration::new(config).expect("generation"),
        ));
        runtime.configured.store(true, Ordering::Release);
        runtime
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
