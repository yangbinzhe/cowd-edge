use std::io;
use std::sync::Arc;

use surface::SurfaceFrame;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use crate::platform::adapter::{OutboundMessage, PlatformAdapter};
use crate::platform::feishu::{create_feishu_adapter, FeishuAdapter};
use crate::platform::{InboundMessage, SessionKey};

const SURFACE_ID: &str = "feishu";

#[derive(Default)]
struct FeishuSidecarState {
    adapter: Option<Arc<Mutex<FeishuAdapter>>>,
    configured: bool,
    connected: bool,
    receive_loop_running: bool,
    last_error: Option<String>,
}

pub async fn run_stdio_feishu_surface() -> io::Result<()> {
    let state = Arc::new(Mutex::new(FeishuSidecarState::default()));
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let response = match SurfaceFrame::decode_jsonl(&line) {
            Ok(frame) => handle_frame(frame, state.clone(), stdout.clone()).await,
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
    frame: SurfaceFrame,
    state: Arc<Mutex<FeishuSidecarState>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
) -> SurfaceFrame {
    match frame {
        SurfaceFrame::Handshake {
            id,
            protocol,
            gateway_version: _,
        } if protocol == surface::SURFACE_PROTOCOL => SurfaceFrame::HandshakeOk {
            id,
            surface_id: SURFACE_ID.to_string(),
            capabilities: vec![
                "send_text".to_string(),
                "callback".to_string(),
                "inbound".to_string(),
                "health".to_string(),
                "websocket".to_string(),
                "processing_lifecycle".to_string(),
            ],
        },
        SurfaceFrame::Configure {
            id,
            surface: _,
            config,
        } => configure_adapter(id, config, state, stdout).await,
        SurfaceFrame::Connect { id, .. } => connect_adapter(id, state, stdout).await,
        SurfaceFrame::Disconnect { id, .. } => disconnect_adapter(id, state).await,
        SurfaceFrame::Health { id, .. } => health_frame(id, state).await,
        SurfaceFrame::Send {
            id,
            recipient,
            thread,
            text,
            metadata,
            ..
        } => send_text_frame(id, recipient, thread, text, metadata, state).await,
        SurfaceFrame::Action {
            id,
            action,
            payload,
            ..
        } => action_frame(id, action, payload, state, stdout).await,
        SurfaceFrame::Handshake { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "surface_protocol_mismatch".to_string(),
            message: format!("expected protocol `{}`", surface::SURFACE_PROTOCOL),
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
    id: String,
    config: serde_json::Value,
    state: Arc<Mutex<FeishuSidecarState>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
) -> SurfaceFrame {
    match create_feishu_adapter(&config) {
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
                spawn_receive_loop(adapter, state, stdout).await;
                SurfaceFrame::Ok {
                    id,
                    payload: serde_json::json!({
                        "status": "ready",
                        "surface": SURFACE_ID,
                        "transport": "feishu-websocket",
                    }),
                }
            }
            Err(error) => {
                let message = error.to_string();
                let mut state = state.lock().await;
                state.configured = true;
                state.connected = false;
                state.receive_loop_running = false;
                state.last_error = Some(message.clone());
                SurfaceFrame::Error {
                    id: Some(id),
                    code: "feishu_connect_failed".to_string(),
                    message,
                }
            }
        },
        Err(error) => {
            let message = error.to_string();
            let mut state = state.lock().await;
            state.configured = false;
            state.connected = false;
            state.receive_loop_running = false;
            state.last_error = Some(message.clone());
            SurfaceFrame::Error {
                id: Some(id),
                code: "feishu_config_invalid".to_string(),
                message,
            }
        }
    }
}

async fn connect_adapter(
    id: String,
    state: Arc<Mutex<FeishuSidecarState>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
) -> SurfaceFrame {
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_not_configured".to_string(),
            message: "configure feishu before connect".to_string(),
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
            spawn_receive_loop(adapter.clone(), state, stdout).await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({"status": "ready", "surface": SURFACE_ID}),
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
                code: "feishu_connect_failed".to_string(),
                message,
            }
        }
    }
}

async fn disconnect_adapter(id: String, state: Arc<Mutex<FeishuSidecarState>>) -> SurfaceFrame {
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
        payload: serde_json::json!({"status": "disconnected", "surface": SURFACE_ID}),
    }
}

async fn health_frame(id: String, state: Arc<Mutex<FeishuSidecarState>>) -> SurfaceFrame {
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
            "surface": SURFACE_ID,
            "configured": state.configured,
            "connected": state.connected,
            "transport": "feishu-websocket",
            "last_error": state.last_error,
        }),
    }
}

async fn send_text_frame(
    id: String,
    recipient: String,
    thread: Option<String>,
    text: String,
    metadata: serde_json::Value,
    state: Arc<Mutex<FeishuSidecarState>>,
) -> SurfaceFrame {
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_not_configured".to_string(),
            message: "configure feishu before send".to_string(),
        };
    };
    let thread_hint = thread.as_deref().or_else(|| {
        metadata
            .get("thread_id")
            .or_else(|| metadata.get("chat_id"))
            .and_then(|value| value.as_str())
    });
    let session_key = session_key_from_target(&recipient, thread_hint);
    let message = OutboundMessage {
        session_key,
        text,
        reply_to: metadata
            .get("reply_to")
            .and_then(|value| value.as_str())
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
            code: "feishu_send_failed".to_string(),
            message: result
                .error
                .unwrap_or_else(|| "feishu send failed".to_string()),
        },
        Err(error) => SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_send_failed".to_string(),
            message: error.to_string(),
        },
    }
}

async fn action_frame(
    id: String,
    action: String,
    payload: serde_json::Value,
    state: Arc<Mutex<FeishuSidecarState>>,
    stdout: Arc<Mutex<tokio::io::Stdout>>,
) -> SurfaceFrame {
    if matches!(
        action.as_str(),
        "message.processing_complete" | "message.processing_failed"
    ) {
        return processing_lifecycle_frame(id, action, payload, state).await;
    }
    if action != "callback.dispatch" {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_action_unsupported".to_string(),
            message: format!("unsupported feishu action `{action}`"),
        };
    }
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_not_configured".to_string(),
            message: "configure feishu before callback dispatch".to_string(),
        };
    };
    let event_payload = payload.get("payload").cloned().unwrap_or(payload);
    let callback_result = adapter
        .lock()
        .await
        .process_webhook_event_with_media(event_payload.to_string().as_bytes())
        .await;
    match callback_result {
        Ok(Some(message)) => {
            let _ = emit_inbound_event(&stdout, message).await;
            SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({"status": "received", "surface": SURFACE_ID}),
            }
        }
        Ok(None) => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({"status": "ignored", "surface": SURFACE_ID}),
        },
        Err(error) => SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_callback_failed".to_string(),
            message: error.to_string(),
        },
    }
}

async fn processing_lifecycle_frame(
    id: String,
    action: String,
    payload: serde_json::Value,
    state: Arc<Mutex<FeishuSidecarState>>,
) -> SurfaceFrame {
    let message_id = payload
        .get("message_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let Some(message_id) = message_id else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_processing_lifecycle_missing_message_id".to_string(),
            message: "message processing lifecycle action requires payload.message_id".to_string(),
        };
    };
    let adapter = {
        let state = state.lock().await;
        state.adapter.clone()
    };
    let Some(adapter) = adapter else {
        return SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_not_configured".to_string(),
            message: "configure feishu before processing lifecycle action".to_string(),
        };
    };
    let adapter = adapter.lock().await;
    let token = match adapter.ensure_token().await {
        Ok(token) => token,
        Err(error) => {
            return SurfaceFrame::Error {
                id: Some(id),
                code: "feishu_token_unavailable".to_string(),
                message: error.to_string(),
            };
        }
    };
    let result = if action == "message.processing_complete" {
        adapter.reactions.mark_success(&token, &message_id).await
    } else {
        adapter.reactions.mark_failure(&token, &message_id).await
    };
    match result {
        Ok(()) => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": if action == "message.processing_complete" { "cleared" } else { "failed" },
                "surface": SURFACE_ID,
                "message_id": message_id,
                "action": action,
            }),
        },
        Err(error) => SurfaceFrame::Error {
            id: Some(id),
            code: "feishu_processing_lifecycle_failed".to_string(),
            message: error.to_string(),
        },
    }
}

async fn spawn_receive_loop(
    adapter: Arc<Mutex<FeishuAdapter>>,
    state: Arc<Mutex<FeishuSidecarState>>,
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
                    let _ = emit_inbound_event(&stdout, message).await;
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
                    drop(state);
                    break;
                }
            }
        }
    });
}

async fn emit_inbound_event(
    stdout: &Arc<Mutex<tokio::io::Stdout>>,
    message: InboundMessage,
) -> io::Result<()> {
    write_frame(
        stdout,
        &SurfaceFrame::Event {
            surface: SURFACE_ID.to_string(),
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

fn session_key_from_target(recipient: &str, thread: Option<&str>) -> SessionKey {
    if let Some(rest) = recipient.strip_prefix("feishu:") {
        let parts: Vec<&str> = rest.split(':').filter(|part| !part.is_empty()).collect();
        if let Some(chat_id) = parts.get(1) {
            return SessionKey::with_thread(SURFACE_ID, parts[0], *chat_id);
        }
        if let Some(single) = parts.first() {
            return thread
                .map(|thread| SessionKey::with_thread(SURFACE_ID, *single, thread))
                .unwrap_or_else(|| SessionKey::new(SURFACE_ID, *single));
        }
    }
    let recipient = recipient
        .strip_prefix("chat:")
        .or_else(|| recipient.strip_prefix("open_id:"))
        .unwrap_or(recipient);
    thread
        .map(|thread| SessionKey::with_thread(SURFACE_ID, recipient, thread))
        .unwrap_or_else(|| SessionKey::new(SURFACE_ID, recipient))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_feishu_session_target_for_chat_reply() {
        let key = session_key_from_target("feishu:ou_user:oc_chat", None);
        assert_eq!(key.platform, "feishu");
        assert_eq!(key.user_id, "ou_user");
        assert_eq!(key.thread_id.as_deref(), Some("oc_chat"));
    }

    #[test]
    fn parses_chat_prefixed_target() {
        let key = session_key_from_target("chat:oc_chat", None);
        assert_eq!(key.user_id, "oc_chat");
        assert_eq!(key.thread_id, None);
    }
}
