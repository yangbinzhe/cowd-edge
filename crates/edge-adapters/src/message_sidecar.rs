use std::io;
use std::sync::Arc;

use chrono::Utc;
use edge_contract::SurfaceFrame;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use crate::platform::{
    InboundMessage, OutboundMessage, Platform, PlatformAdapter, PlatformError, PlatformEvent,
    PlatformResult, SessionKey,
};

type AdapterFactory = fn(&serde_json::Value) -> PlatformResult<Box<dyn PlatformAdapter>>;

#[derive(Default)]
struct MessageSidecarState {
    adapter: Option<Arc<Mutex<Box<dyn PlatformAdapter>>>>,
    configured: bool,
    connected: bool,
    receive_loop_running: bool,
    last_error: Option<String>,
}

pub async fn run_stdio_platform_message_connector(
    surface_id: &'static str,
    capabilities: &'static [&'static str],
    factory: AdapterFactory,
) -> io::Result<()> {
    let state = Arc::new(Mutex::new(MessageSidecarState::default()));
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
                    surface_id,
                    capabilities,
                    factory,
                    frame,
                    state.clone(),
                    stdout.clone(),
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
    stdout: Arc<Mutex<tokio::io::Stdout>>,
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
        } => configure_adapter(surface_id, id, config, factory, state, stdout).await,
        SurfaceFrame::Connect { id, .. } => connect_adapter(surface_id, id, state, stdout).await,
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
        } => action_frame(surface_id, id, action, payload, state, stdout).await,
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
    stdout: Arc<Mutex<tokio::io::Stdout>>,
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
                spawn_receive_loop(surface_id, adapter, state, stdout).await;
                SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ready",
                        "surface": surface_id,
                        "transport": "edge-message-sidecar",
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
    stdout: Arc<Mutex<tokio::io::Stdout>>,
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
            spawn_receive_loop(surface_id, adapter, state, stdout).await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({"status": "ready", "surface": surface_id}),
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
        }),
    }
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
    stdout: Arc<Mutex<tokio::io::Stdout>>,
) -> SurfaceFrame {
    if matches!(
        action.as_str(),
        "message.processing_complete" | "message.processing_failed"
    ) {
        return SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": "acknowledged",
                "surface": surface_id,
                "action": action,
            }),
        };
    }
    if action != "callback.dispatch" {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_action_unsupported"),
            message: format!("unsupported {surface_id} action `{action}`"),
        };
    }
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: format!("{surface_id}_not_configured"),
            message: format!("configure {surface_id} before callback dispatch"),
        };
    };

    let event_payload = payload.get("payload").cloned().unwrap_or(payload);
    let event_type = event_payload
        .get("event_type")
        .or_else(|| event_payload.get("type"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("callback.dispatch")
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
            let _ = emit_inbound_event(surface_id, &stdout, message).await;
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

async fn spawn_receive_loop(
    surface_id: &'static str,
    adapter: Arc<Mutex<Box<dyn PlatformAdapter>>>,
    state: Arc<Mutex<MessageSidecarState>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
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
                    let _ = emit_inbound_event(surface_id, &stdout, message).await;
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
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    message: InboundMessage,
) -> io::Result<()> {
    write_frame(
        stdout,
        &SurfaceFrame::Event {
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
        },
    )
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
}
