use std::io;
use std::sync::Arc;

use chrono::Utc;
use edge_contract::{
    message::{MessageActionKind, MessageConnectorDescriptor},
    SurfaceFrame,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

use crate::managed_server::{ManagedEdgeHandler, ManagedHandlerFactory};
use crate::platform::{
    InboundMessage, OutboundMessage, Platform, PlatformAdapter, PlatformError, PlatformEvent,
    PlatformResult, SessionKey,
};

pub type AdapterFactory = fn(&serde_json::Value) -> PlatformResult<Box<dyn PlatformAdapter>>;

#[derive(Default)]
struct MessageSidecarState {
    adapter: Option<Arc<Mutex<Box<dyn PlatformAdapter>>>>,
    configured: bool,
    connected: bool,
    receive_loop_running: bool,
    last_error: Option<String>,
}

pub struct MessageManagedHandler {
    surface_id: &'static str,
    capabilities: &'static [&'static str],
    factory: AdapterFactory,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
}

impl MessageManagedHandler {
    #[must_use]
    pub fn new(
        surface_id: &'static str,
        capabilities: &'static [&'static str],
        factory: AdapterFactory,
        events: mpsc::Sender<SurfaceFrame>,
    ) -> Self {
        Self {
            surface_id,
            capabilities,
            factory,
            state: Arc::new(Mutex::new(MessageSidecarState::default())),
            events,
        }
    }
}

#[async_trait::async_trait]
impl ManagedEdgeHandler for MessageManagedHandler {
    async fn handle(&self, frame: SurfaceFrame) -> Result<SurfaceFrame, String> {
        Ok(handle_frame(
            self.surface_id,
            self.capabilities,
            self.factory,
            frame,
            self.state.clone(),
            self.events.clone(),
        )
        .await)
    }
}

#[must_use]
pub fn managed_message_factory(
    expected_profile: &'static str,
    factory: AdapterFactory,
) -> ManagedHandlerFactory {
    Arc::new(move |bootstrap, events| {
        let profile = crate::driver_profiles::driver_profile(expected_profile)
            .filter(|profile| profile.adapter_id.is_empty())
            .ok_or_else(|| format!("unknown message profile `{expected_profile}`"))?;
        if bootstrap.driver_profile != expected_profile {
            return Err(format!(
                "profile `{}` is not supported by `{expected_profile}`",
                bootstrap.driver_profile
            ));
        }
        if bootstrap.surface_id != profile.surface_id {
            return Err(format!(
                "surface `{}` does not match profile surface `{}`",
                bootstrap.surface_id, profile.surface_id
            ));
        }
        Ok((
            Arc::new(MessageManagedHandler::new(
                profile.surface_id,
                profile.capabilities,
                factory,
                events,
            )),
            profile
                .capabilities
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
        ))
    })
}

pub async fn run_stdio_platform_message_connector(
    surface_id: &'static str,
    capabilities: &'static [&'static str],
    factory: AdapterFactory,
) -> io::Result<()> {
    let state = Arc::new(Mutex::new(MessageSidecarState::default()));
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let (events, mut event_rx) = mpsc::channel::<SurfaceFrame>(4096);
    let event_stdout = stdout.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if write_frame(&event_stdout, &event).await.is_err() {
                break;
            }
        }
    });
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let response = match SurfaceFrame::decode_jsonl(&line) {
            Ok(frame) => {
                handle_frame(
                    surface_id,
                    capabilities,
                    factory,
                    frame,
                    state.clone(),
                    events.clone(),
                )
                .await
            }
            Err(error) => SurfaceFrame::Error {
                id: None,
                code: "surface_frame_parse_failed".to_string(),
                message: error.to_string(),
            },
        };
        write_frame(&stdout, &response).await?;
    }

    Ok(())
}

async fn handle_frame(
    surface_id: &'static str,
    capabilities: &'static [&'static str],
    factory: AdapterFactory,
    frame: SurfaceFrame,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
) -> SurfaceFrame {
    match frame {
        SurfaceFrame::Handshake {
            id,
            protocol,
            gateway_version: _,
        } if protocol == edge_contract::SURFACE_PROTOCOL => SurfaceFrame::HandshakeOk {
            id,
            surface_id: surface_id.to_string(),
            capabilities: capabilities
                .iter()
                .map(|item| (*item).to_string())
                .collect(),
        },
        SurfaceFrame::Configure {
            id,
            surface: _,
            config,
        } => configure_adapter(surface_id, id, config, factory, state, events).await,
        SurfaceFrame::Connect { id, .. } => connect_adapter(surface_id, id, state, events).await,
        SurfaceFrame::Disconnect { id, .. } => disconnect_adapter(surface_id, id, state).await,
        SurfaceFrame::Health { id, .. } => health_frame(surface_id, id, state).await,
        SurfaceFrame::Send {
            id,
            recipient,
            thread,
            text,
            metadata,
            ..
        } => send_text_frame(surface_id, id, recipient, thread, text, metadata, state).await,
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } => action_frame(surface_id, id, action, payload, state, events).await,
        SurfaceFrame::Handshake { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "surface_protocol_mismatch".to_string(),
            message: format!("expected protocol `{}`", edge_contract::SURFACE_PROTOCOL),
        },
        SurfaceFrame::HandshakeOk { id, .. } | SurfaceFrame::Ok { id, .. } => unexpected_frame(id),
        SurfaceFrame::Error { id, .. } => SurfaceFrame::Error {
            id,
            code: "surface_unexpected_request_frame".to_string(),
            message: "sidecar received error frame as request".to_string(),
        },
        SurfaceFrame::Event { .. } => SurfaceFrame::Error {
            id: None,
            code: "surface_unexpected_request_frame".to_string(),
            message: "sidecar received event frame as request".to_string(),
        },
    }
}

async fn configure_adapter(
    surface_id: &'static str,
    id: String,
    config: serde_json::Value,
    factory: AdapterFactory,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
) -> SurfaceFrame {
    match factory(&config) {
        Ok(mut adapter) => match adapter.connect().await {
            Ok(()) => {
                let adapter = Arc::new(Mutex::new(adapter));
                {
                    let mut state = state.lock().await;
                    state.adapter = Some(adapter.clone());
                    state.configured = true;
                    state.connected = true;
                    state.receive_loop_running = false;
                    state.last_error = None;
                }
                spawn_receive_loop(surface_id, adapter, state, events).await;
                SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ready",
                        "surface": surface_id,
                        "transport": "edge-message-sidecar",
                        "descriptor": message_descriptor_payload(surface_id, "ready", None, false),
                    }),
                }
            }
            Err(error) => {
                let message = error.to_string();
                let mut state = state.lock().await;
                state.adapter = None;
                state.configured = true;
                state.connected = false;
                state.receive_loop_running = false;
                state.last_error = Some(message.clone());
                SurfaceFrame::Error {
                    id: Some(id),
                    code: format!("{surface_id}_connect_failed"),
                    message,
                }
            }
        },
        Err(error) => {
            let message = error.to_string();
            let mut state = state.lock().await;
            state.adapter = None;
            state.configured = false;
            state.connected = false;
            state.receive_loop_running = false;
            state.last_error = Some(message.clone());
            SurfaceFrame::Error {
                id: Some(id),
                code: format!("{surface_id}_config_invalid"),
                message,
            }
        }
    }
}

async fn connect_adapter(
    surface_id: &'static str,
    id: String,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
) -> SurfaceFrame {
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_not_configured"),
            message: format!("configure {surface_id} before connect"),
        };
    };
    let connect_result = adapter.lock().await.connect().await;
    match connect_result {
        Ok(()) => {
            {
                let mut state = state.lock().await;
                state.connected = true;
                state.receive_loop_running = false;
                state.last_error = None;
            }
            spawn_receive_loop(surface_id, adapter, state, events).await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({
                    "status": "ready",
                    "surface": surface_id,
                    "descriptor": message_descriptor_payload(surface_id, "ready", None, false),
                }),
            }
        }
        Err(error) => {
            let message = error.to_string();
            let mut state = state.lock().await;
            state.connected = false;
            state.receive_loop_running = false;
            state.last_error = Some(message.clone());
            SurfaceFrame::Error {
                id: Some(id),
                code: format!("{surface_id}_connect_failed"),
                message,
            }
        }
    }
}

async fn disconnect_adapter(
    surface_id: &'static str,
    id: String,
    state: Arc<Mutex<MessageSidecarState>>,
) -> SurfaceFrame {
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    if let Some(adapter) = adapter {
        let _ = adapter.lock().await.disconnect().await;
    }
    let mut state = state.lock().await;
    state.connected = false;
    state.receive_loop_running = false;
    SurfaceFrame::Ok {
        id,
        payload: serde_json::json!({"status": "disconnected", "surface": surface_id}),
    }
}

async fn health_frame(
    surface_id: &'static str,
    id: String,
    state: Arc<Mutex<MessageSidecarState>>,
) -> SurfaceFrame {
    let state = state.lock().await;
    let status = if state.connected {
        "ready"
    } else if state.configured {
        "degraded"
    } else {
        "config_missing"
    };
    SurfaceFrame::Ok {
        id,
        payload: serde_json::json!({
            "status": status,
            "surface": surface_id,
            "configured": state.configured,
            "connected": state.connected,
            "transport": "edge-message-sidecar",
            "last_error": state.last_error,
            "descriptor": message_descriptor_payload(surface_id, status, state.last_error.as_deref(), false),
        }),
    }
}

fn message_descriptor_payload(
    surface_id: &str,
    status: &str,
    last_error: Option<&str>,
    reload_required: bool,
) -> serde_json::Value {
    let connector = surface_id.strip_prefix("message:").unwrap_or(surface_id);
    let mut descriptor = MessageConnectorDescriptor::for_connector(connector, status)
        .with_reload_required(reload_required);
    if let Some(last_error) = last_error.filter(|value| !value.trim().is_empty()) {
        descriptor.degraded_reasons.push(last_error.to_string());
        descriptor.degraded_reasons.sort();
        descriptor.degraded_reasons.dedup();
    }
    serde_json::to_value(descriptor).unwrap_or_else(|_| serde_json::json!({}))
}

async fn send_text_frame(
    surface_id: &'static str,
    id: String,
    recipient: String,
    thread: Option<String>,
    text: String,
    metadata: serde_json::Value,
    state: Arc<Mutex<MessageSidecarState>>,
) -> SurfaceFrame {
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_not_configured"),
            message: format!("configure {surface_id} before send"),
        };
    };
    let thread_hint = thread.as_deref().or_else(|| {
        metadata
            .get("thread_id")
            .or_else(|| metadata.get("chat_id"))
            .and_then(serde_json::Value::as_str)
    });
    let message = OutboundMessage {
        session_key: session_key_from_target(surface_id, &recipient, thread_hint),
        text,
        reply_to: metadata
            .get("reply_to")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        metadata,
    };
    let send_result = adapter.lock().await.send(&message).await;
    match send_result {
        Ok(result) if result.success => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": "sent",
                "message_id": result.message_id,
            }),
        },
        Ok(result) => SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_send_failed"),
            message: result
                .error
                .unwrap_or_else(|| format!("{surface_id} send failed")),
        },
        Err(error) => SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_send_failed"),
            message: error.to_string(),
        },
    }
}

async fn action_frame(
    surface_id: &'static str,
    id: String,
    action: String,
    payload: serde_json::Value,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
) -> SurfaceFrame {
    let Some(kind) = MessageActionKind::parse(&action) else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_action_unsupported"),
            message: format!("unsupported {surface_id} action `{action}`"),
        };
    };
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    if matches!(
        kind,
        MessageActionKind::ProcessingComplete | MessageActionKind::ProcessingFailed
    ) {
        return dispatch_lifecycle_action(surface_id, id, action, payload, adapter).await;
    }
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_not_configured"),
            message: format!("configure {surface_id} before action `{action}`"),
        };
    };

    if kind == MessageActionKind::CallbackDispatch {
        return dispatch_callback_action(surface_id, id, payload, adapter, events).await;
    }

    dispatch_message_action(surface_id, id, kind, payload, adapter).await
}

async fn dispatch_lifecycle_action(
    surface_id: &'static str,
    id: String,
    action: String,
    payload: serde_json::Value,
    adapter: Option<Arc<Mutex<Box<dyn PlatformAdapter>>>>,
) -> SurfaceFrame {
    let adapter_payload = if let Some(adapter) = adapter {
        let event = PlatformEvent {
            event_type: action.clone(),
            platform: Platform::parse(surface_id),
            data: payload.clone(),
            timestamp: Utc::now(),
        };
        match adapter.lock().await.on_event(&event).await {
            Ok(Some(message)) => serde_json::json!({
                "status": "received",
                "message": message.text,
            }),
            Ok(None) => serde_json::json!({"status": "acknowledged"}),
            Err(error) => {
                return platform_error_frame(surface_id, id, action, error);
            }
        }
    } else {
        serde_json::json!({"status": "acknowledged", "adapter": "not_configured"})
    };
    SurfaceFrame::Ok {
        id,
        payload: serde_json::json!({
            "status": "acknowledged",
            "surface": surface_id,
            "action": action,
            "adapter": adapter_payload,
        }),
    }
}

async fn dispatch_callback_action(
    surface_id: &'static str,
    id: String,
    payload: serde_json::Value,
    adapter: Arc<Mutex<Box<dyn PlatformAdapter>>>,
    events: mpsc::Sender<SurfaceFrame>,
) -> SurfaceFrame {
    let event_payload = payload.get("payload").cloned().unwrap_or(payload);
    let event_type = event_payload
        .get("event_type")
        .or_else(|| event_payload.get("type"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or(MessageActionKind::CallbackDispatch.as_str())
        .to_string();
    let event = PlatformEvent {
        event_type,
        platform: Platform::parse(surface_id),
        data: event_payload,
        timestamp: Utc::now(),
    };
    let callback_result = {
        let adapter = adapter.lock().await;
        adapter.on_event(&event).await
    };
    match callback_result {
        Ok(Some(message)) => {
            let _ = emit_inbound_event(surface_id, &events, message).await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({"status": "received", "surface": surface_id}),
            }
        }
        Ok(None) => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({"status": "ignored", "surface": surface_id}),
        },
        Err(error) => SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_callback_failed"),
            message: error.to_string(),
        },
    }
}

async fn dispatch_message_action(
    surface_id: &'static str,
    id: String,
    kind: MessageActionKind,
    payload: serde_json::Value,
    adapter: Arc<Mutex<Box<dyn PlatformAdapter>>>,
) -> SurfaceFrame {
    let action = kind.as_str();
    let session_key = match session_key_from_action_payload(surface_id, &payload) {
        Ok(session_key) => session_key,
        Err(message) => {
            return SurfaceFrame::Error {
                id: Some(id),
                code: format!("{surface_id}_action_payload_invalid"),
                message,
            };
        }
    };
    let chat_id = session_key
        .thread_id
        .as_deref()
        .unwrap_or(&session_key.user_id)
        .to_string();
    let result = match kind {
        MessageActionKind::SendText => {
            let text = match payload_text(&payload) {
                Some(text) => text,
                None => {
                    return SurfaceFrame::Error {
                        id: Some(id),
                        code: format!("{surface_id}_action_payload_invalid"),
                        message: "message.send.text requires text or payload_ref".to_string(),
                    };
                }
            };
            adapter
                .lock()
                .await
                .send(&OutboundMessage {
                    session_key,
                    text,
                    reply_to: payload_string(&payload, &["reply_to", "reply_to_message_id"]),
                    metadata: payload
                        .get("metadata")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null),
                })
                .await
                .map(|result| {
                    serde_json::json!({
                        "status": if result.success { "sent" } else { "failed" },
                        "message_id": result.message_id,
                        "error": result.error,
                    })
                })
        }
        MessageActionKind::SendImage => {
            let payload_ref = match payload_ref(&payload) {
                Some(value) => value,
                None => {
                    return missing_payload_ref(surface_id, id, action);
                }
            };
            let adapter = adapter.lock().await;
            let result = if is_remote_ref(&payload_ref) {
                adapter
                    .send_image(&chat_id, &payload_ref, payload_caption(&payload).as_deref())
                    .await
            } else {
                adapter
                    .send_image_file(&chat_id, &payload_ref, payload_caption(&payload).as_deref())
                    .await
            };
            result.map(|()| serde_json::json!({"status": "sent"}))
        }
        MessageActionKind::SendVoice => {
            let Some(payload_ref) = payload_ref(&payload) else {
                return missing_payload_ref(surface_id, id, action);
            };
            adapter
                .lock()
                .await
                .send_voice(&chat_id, &payload_ref, payload_caption(&payload).as_deref())
                .await
                .map(|()| serde_json::json!({"status": "sent"}))
        }
        MessageActionKind::SendDocument => {
            let Some(payload_ref) = payload_ref(&payload) else {
                return missing_payload_ref(surface_id, id, action);
            };
            adapter
                .lock()
                .await
                .send_document(
                    &chat_id,
                    &payload_ref,
                    payload_string(&payload, &["file_name", "filename", "name"]).as_deref(),
                    payload_caption(&payload).as_deref(),
                )
                .await
                .map(|()| serde_json::json!({"status": "sent"}))
        }
        MessageActionKind::SendVideo => {
            let Some(payload_ref) = payload_ref(&payload) else {
                return missing_payload_ref(surface_id, id, action);
            };
            adapter
                .lock()
                .await
                .send_video(&chat_id, &payload_ref, payload_caption(&payload).as_deref())
                .await
                .map(|()| serde_json::json!({"status": "sent"}))
        }
        MessageActionKind::SendCard => {
            let card_json = payload_string(&payload, &["card_json", "payload_ref"])
                .or_else(|| payload.get("card").map(serde_json::Value::to_string))
                .unwrap_or_else(|| payload.to_string());
            adapter
                .lock()
                .await
                .send_card(&chat_id, &card_json)
                .await
                .map(|message_id| serde_json::json!({"status": "sent", "message_id": message_id}))
        }
        MessageActionKind::Edit => {
            let Some(message_id) = payload_string(&payload, &["message_id", "target_message_id"])
            else {
                return missing_field(surface_id, id, action, "message_id");
            };
            let Some(content) = payload_text(&payload) else {
                return missing_field(surface_id, id, action, "text");
            };
            adapter
                .lock()
                .await
                .edit_message(&chat_id, &message_id, &content)
                .await
                .map(|()| serde_json::json!({"status": "edited", "message_id": message_id}))
        }
        MessageActionKind::Delete => {
            let Some(message_id) = payload_string(&payload, &["message_id", "target_message_id"])
            else {
                return missing_field(surface_id, id, action, "message_id");
            };
            adapter
                .lock()
                .await
                .delete_message(&chat_id, &message_id)
                .await
                .map(|()| serde_json::json!({"status": "deleted", "message_id": message_id}))
        }
        MessageActionKind::ChatInfo => adapter
            .lock()
            .await
            .get_chat_info(&chat_id)
            .await
            .map(|chat| serde_json::json!({"status": "ok", "chat": chat})),
        MessageActionKind::CallbackDispatch
        | MessageActionKind::ProcessingComplete
        | MessageActionKind::ProcessingFailed => unreachable!("handled before message dispatch"),
    };

    match result {
        Ok(payload) => SurfaceFrame::Ok { id, payload },
        Err(error) => platform_error_frame(surface_id, id, action.to_string(), error),
    }
}

fn platform_error_frame(
    surface_id: &'static str,
    id: String,
    action: String,
    error: PlatformError,
) -> SurfaceFrame {
    match error {
        PlatformError::NotImplemented(capability) => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": "not_supported",
                "surface": surface_id,
                "action": action,
                "capability": capability,
            }),
        },
        error => SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_action_failed"),
            message: error.to_string(),
        },
    }
}

fn session_key_from_action_payload(
    surface_id: &str,
    payload: &serde_json::Value,
) -> Result<SessionKey, String> {
    let recipient = payload_string(payload, &["recipient", "chat_id", "to", "target"])
        .ok_or_else(|| "message action requires recipient/chat_id/to".to_string())?;
    let thread = payload_string(payload, &["thread", "thread_id"]);
    Ok(session_key_from_target(
        surface_id,
        &recipient,
        thread.as_deref(),
    ))
}

fn payload_string(payload: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| payload.get(*key))
        .find_map(|value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn payload_ref(payload: &serde_json::Value) -> Option<String> {
    payload_string(
        payload,
        &[
            "payload_ref",
            "resource",
            "resource_id",
            "url",
            "path",
            "file_path",
            "image_url",
            "image_path",
            "audio_path",
            "video_path",
        ],
    )
}

fn payload_text(payload: &serde_json::Value) -> Option<String> {
    payload_string(payload, &["text", "content", "payload_ref"])
}

fn payload_caption(payload: &serde_json::Value) -> Option<String> {
    payload_string(payload, &["caption", "summary"])
}

fn is_remote_ref(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn missing_payload_ref(surface_id: &'static str, id: String, action: &str) -> SurfaceFrame {
    missing_field(surface_id, id, action, "payload_ref")
}

fn missing_field(surface_id: &'static str, id: String, action: &str, field: &str) -> SurfaceFrame {
    SurfaceFrame::Error {
        id: Some(id),
        code: format!("{surface_id}_action_payload_invalid"),
        message: format!("{action} requires {field}"),
    }
}

async fn spawn_receive_loop(
    surface_id: &'static str,
    adapter: Arc<Mutex<Box<dyn PlatformAdapter>>>,
    state: Arc<Mutex<MessageSidecarState>>,
    events: mpsc::Sender<SurfaceFrame>,
) {
    {
        let mut state = state.lock().await;
        if state.receive_loop_running {
            return;
        }
        state.receive_loop_running = true;
    }
    tokio::spawn(async move {
        loop {
            let receive = adapter.lock().await.receive().await;
            match receive {
                Ok(Some(message)) => {
                    let _ = emit_inbound_event(surface_id, &events, message).await;
                }
                Ok(None) => {
                    let connected = state.lock().await.connected;
                    if !connected {
                        let mut state = state.lock().await;
                        state.receive_loop_running = false;
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(error) => {
                    let mut state = state.lock().await;
                    state.connected = false;
                    state.receive_loop_running = false;
                    state.last_error = Some(error.to_string());
                    break;
                }
            }
        }
    });
}

async fn emit_inbound_event(
    surface_id: &'static str,
    events: &mpsc::Sender<SurfaceFrame>,
    message: InboundMessage,
) -> Result<(), mpsc::error::SendError<SurfaceFrame>> {
    events
        .send(SurfaceFrame::Event {
            surface: surface_id.to_string(),
            event: "message.received".to_string(),
            payload: serde_json::json!({
                "platform": message.platform.name(),
                "session": message.session_key.as_str(),
                "user_id": message.session_key.user_id,
                "thread_id": message.session_key.thread_id,
                "text": message.text,
                "sender_name": message.sender_name,
                "timestamp": message.timestamp,
                "metadata": message.metadata,
                "message_type": format!("{:?}", message.message_type).to_ascii_lowercase(),
                "message_id": message.message_id,
                "reply_to_message_id": message.reply_to_message_id,
                "media_urls": message.media_urls,
                "media_types": message.media_types,
            }),
        })
        .await
}

fn session_key_from_target(surface_id: &str, recipient: &str, thread: Option<&str>) -> SessionKey {
    if let Some(rest) = recipient.strip_prefix(&format!("{surface_id}:")) {
        let parts: Vec<&str> = rest.split(':').filter(|part| !part.is_empty()).collect();
        if let Some(thread_id) = parts.get(1) {
            return SessionKey::with_thread(surface_id, parts[0], *thread_id);
        }
        if let Some(single) = parts.first() {
            return thread
                .map(|thread| SessionKey::with_thread(surface_id, *single, thread))
                .unwrap_or_else(|| SessionKey::new(surface_id, *single));
        }
    }
    let recipient = recipient
        .strip_prefix("chat:")
        .or_else(|| recipient.strip_prefix("open_id:"))
        .or_else(|| recipient.strip_prefix("mailto:"))
        .unwrap_or(recipient);
    thread
        .map(|thread| SessionKey::with_thread(surface_id, recipient, thread))
        .unwrap_or_else(|| SessionKey::new(surface_id, recipient))
}

fn unexpected_frame(id: String) -> SurfaceFrame {
    SurfaceFrame::Error {
        id: Some(id),
        code: "surface_unexpected_request_frame".to_string(),
        message: "sidecar received response frame as request".to_string(),
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

pub fn email_adapter(settings: &serde_json::Value) -> PlatformResult<Box<dyn PlatformAdapter>> {
    Ok(Box::new(crate::platform::email::create_email_adapter(
        settings,
    )?))
}

pub fn feishu_adapter(settings: &serde_json::Value) -> PlatformResult<Box<dyn PlatformAdapter>> {
    Ok(Box::new(crate::platform::feishu::create_feishu_adapter(
        settings,
    )?))
}

pub fn wecom_adapter(settings: &serde_json::Value) -> PlatformResult<Box<dyn PlatformAdapter>> {
    Ok(Box::new(crate::platform::wecom::create_wecom_adapter(
        settings,
    )?))
}

pub fn wechat_ilink_adapter(
    settings: &serde_json::Value,
) -> PlatformResult<Box<dyn PlatformAdapter>> {
    Ok(Box::new(
        crate::platform::wechat_ilink::create_wechat_ilink_adapter(settings)?,
    ))
}

pub fn config_error(message: impl Into<String>) -> PlatformError {
    PlatformError::ConfigError(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex as StdMutex};

    use crate::platform::{ChatInfo, SendResult};

    #[test]
    fn parses_surface_prefixed_target_with_thread() {
        let key = session_key_from_target("wecom", "wecom:user-1:chat-2", None);
        assert_eq!(key.platform, "wecom");
        assert_eq!(key.user_id, "user-1");
        assert_eq!(key.thread_id.as_deref(), Some("chat-2"));
    }

    #[test]
    fn parses_mailto_target() {
        let key = session_key_from_target("email", "mailto:ops@example.com", None);
        assert_eq!(key.platform, "email");
        assert_eq!(key.user_id, "ops@example.com");
        assert_eq!(key.thread_id, None);
    }

    #[test]
    fn thread_hint_is_preserved() {
        let key = session_key_from_target("wechat-ilink", "user-1", Some("thread-1"));
        assert_eq!(key.platform, "wechat-ilink");
        assert_eq!(key.user_id, "user-1");
        assert_eq!(key.thread_id.as_deref(), Some("thread-1"));
    }

    #[tokio::test]
    async fn typed_image_action_dispatches_to_adapter() {
        let calls = Arc::new(StdMutex::new(Vec::new()));
        let adapter: Arc<Mutex<Box<dyn PlatformAdapter>>> =
            Arc::new(Mutex::new(Box::new(FakeAdapter {
                calls: calls.clone(),
            })));

        let frame = dispatch_message_action(
            "feishu",
            "frame-1".to_string(),
            MessageActionKind::SendImage,
            serde_json::json!({
                "recipient": "chat-1",
                "payload_ref": "https://example.test/image.png",
                "caption": "preview"
            }),
            adapter,
        )
        .await;

        assert_ok_status(frame, "sent");
        assert_eq!(
            calls.lock().unwrap().as_slice(),
            &["send_image:chat-1:https://example.test/image.png:preview"]
        );
    }

    #[tokio::test]
    async fn typed_delete_action_dispatches_to_adapter() {
        let calls = Arc::new(StdMutex::new(Vec::new()));
        let adapter: Arc<Mutex<Box<dyn PlatformAdapter>>> =
            Arc::new(Mutex::new(Box::new(FakeAdapter {
                calls: calls.clone(),
            })));

        let frame = dispatch_message_action(
            "feishu",
            "frame-2".to_string(),
            MessageActionKind::Delete,
            serde_json::json!({
                "recipient": "chat-1",
                "message_id": "om_123"
            }),
            adapter,
        )
        .await;

        assert_ok_status(frame, "deleted");
        assert_eq!(calls.lock().unwrap().as_slice(), &["delete:chat-1:om_123"]);
    }

    fn assert_ok_status(frame: SurfaceFrame, expected: &str) {
        match frame {
            SurfaceFrame::Ok { payload, .. } => {
                assert_eq!(payload["status"].as_str(), Some(expected));
            }
            other => panic!("expected ok frame, got {other:?}"),
        }
    }

    struct FakeAdapter {
        calls: Arc<StdMutex<Vec<String>>>,
    }

    #[async_trait]
    impl PlatformAdapter for FakeAdapter {
        fn platform(&self) -> Platform {
            Platform::Custom("fake".to_string())
        }

        fn platform_name(&self) -> &str {
            "fake"
        }

        async fn connect(&mut self) -> PlatformResult<()> {
            Ok(())
        }

        async fn disconnect(&mut self) -> PlatformResult<()> {
            Ok(())
        }

        fn is_connected(&self) -> bool {
            true
        }

        async fn receive(&mut self) -> PlatformResult<Option<InboundMessage>> {
            Ok(None)
        }

        async fn send(&self, msg: &OutboundMessage) -> PlatformResult<SendResult> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("send:{}", msg.text));
            Ok(SendResult::success(Some("msg-1".to_string())))
        }

        async fn send_image(
            &self,
            chat_id: &str,
            image_url: &str,
            caption: Option<&str>,
        ) -> PlatformResult<()> {
            self.calls.lock().unwrap().push(format!(
                "send_image:{chat_id}:{image_url}:{}",
                caption.unwrap_or("")
            ));
            Ok(())
        }

        async fn delete_message(&self, chat_id: &str, message_id: &str) -> PlatformResult<()> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("delete:{chat_id}:{message_id}"));
            Ok(())
        }

        async fn get_chat_info(&self, chat_id: &str) -> PlatformResult<ChatInfo> {
            Ok(ChatInfo {
                chat_id: chat_id.to_string(),
                name: "fake chat".to_string(),
                chat_type: "group".to_string(),
            })
        }
    }
}
