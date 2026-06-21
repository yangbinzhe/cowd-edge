use std::io::{self, BufRead, Write};

use surface::SurfaceFrame;

pub fn run_stdio_surface(surface_id: &str, capabilities: &[&str]) -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let frame = match SurfaceFrame::decode_jsonl(&line) {
            Ok(frame) => frame,
            Err(error) => {
                write_frame(
                    &mut stdout,
                    &SurfaceFrame::Error {
                        id: None,
                        code: "surface_frame_parse_failed".to_string(),
                        message: error.to_string(),
                    },
                )?;
                continue;
            }
        };
        let response = response_for_frame(surface_id, capabilities, frame);
        write_frame(&mut stdout, &response)?;
    }
    Ok(())
}

fn response_for_frame(
    surface_id: &str,
    capabilities: &[&str],
    frame: SurfaceFrame,
) -> SurfaceFrame {
    match frame {
        SurfaceFrame::Handshake {
            id,
            protocol,
            gateway_version: _,
        } if protocol == surface::SURFACE_PROTOCOL => SurfaceFrame::HandshakeOk {
            id,
            surface_id: surface_id.to_string(),
            capabilities: capabilities.iter().map(|item| (*item).to_string()).collect(),
        },
        SurfaceFrame::Health { id, .. } => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": "degraded",
                "surface": surface_id,
                "reason": "surface sidecar protocol is alive; platform adapter configuration is not connected in this binary yet",
                "capabilities": capabilities,
            }),
        },
        SurfaceFrame::Send { id, .. } | SurfaceFrame::Action { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "surface_adapter_not_configured".to_string(),
            message: format!(
                "{surface_id} sidecar binary is available, but real platform adapter execution is not configured yet"
            ),
        },
        SurfaceFrame::Configure { id, .. }
        | SurfaceFrame::Connect { id, .. }
        | SurfaceFrame::Disconnect { id, .. } => SurfaceFrame::Ok {
            id,
            payload: serde_json::json!({
                "status": "ok",
                "surface": surface_id,
            }),
        },
        SurfaceFrame::Handshake { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "surface_protocol_mismatch".to_string(),
            message: format!("expected protocol `{}`", surface::SURFACE_PROTOCOL),
        },
        SurfaceFrame::HandshakeOk { id, .. } | SurfaceFrame::Ok { id, .. } => SurfaceFrame::Error {
            id: Some(id),
            code: "surface_unexpected_request_frame".to_string(),
            message: "sidecar received response frame as request".to_string(),
        },
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

fn write_frame(stdout: &mut io::Stdout, frame: &SurfaceFrame) -> io::Result<()> {
    let encoded = frame
        .encode_jsonl()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    stdout.write_all(encoded.as_bytes())?;
    stdout.flush()
}
