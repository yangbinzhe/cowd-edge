use std::collections::VecDeque;
use std::convert::Infallible;
use std::future::Future;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use edge_contract::{
    EdgeBootstrapRequest, EdgeBootstrapResponse, EdgeEventAck, EdgeEventEnvelope, SurfaceFrame,
    EDGE_PROTOCOL_V2,
};
use futures::{stream, StreamExt};
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full, Limited, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioExecutor, TokioIo};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc, Mutex, Notify, RwLock, Semaphore};

const AUTH_HEADER: &str = "x-cowd-edge-token";
const MAX_REQUEST_BODY: usize = 1024 * 1024;
const MAX_IN_FLIGHT: usize = 256;
const EVENT_REPLAY_CAPACITY: usize = 4096;

type ResponseBody = UnsyncBoxBody<Bytes, Infallible>;
type HandlerFuture = Pin<Box<dyn Future<Output = Result<SurfaceFrame, String>> + Send>>;

#[async_trait]
pub trait ManagedEdgeHandler: Send + Sync + 'static {
    async fn handle(&self, frame: SurfaceFrame) -> Result<SurfaceFrame, String>;
}

pub type ManagedHandlerFactory = Arc<
    dyn Fn(
            &EdgeBootstrapRequest,
            mpsc::Sender<SurfaceFrame>,
        ) -> Result<(Arc<dyn ManagedEdgeHandler>, Vec<String>), String>
        + Send
        + Sync,
>;

#[derive(Debug)]
struct ManagedServerArgs {
    socket: PathBuf,
    credential_file: PathBuf,
}

impl ManagedServerArgs {
    fn parse() -> Result<Self, String> {
        let mut socket = None;
        let mut credential_file = None;
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--socket" => socket = args.next().map(PathBuf::from),
                "--credential-file" => credential_file = args.next().map(PathBuf::from),
                other => return Err(format!("unknown managed edge argument `{other}`")),
            }
        }
        Ok(Self {
            socket: socket.ok_or_else(|| "missing --socket".to_string())?,
            credential_file: credential_file
                .ok_or_else(|| "missing --credential-file".to_string())?,
        })
    }
}

#[derive(Debug)]
struct ReplayState {
    next_sequence: u64,
    acked_sequence: u64,
    events: VecDeque<EdgeEventEnvelope>,
}

impl Default for ReplayState {
    fn default() -> Self {
        Self {
            next_sequence: 1,
            acked_sequence: 0,
            events: VecDeque::new(),
        }
    }
}

struct ManagedServerState {
    token: Arc<str>,
    factory: ManagedHandlerFactory,
    bootstrap: Mutex<Option<EdgeBootstrapRequest>>,
    handler: RwLock<Option<Arc<dyn ManagedEdgeHandler>>>,
    capabilities: RwLock<Vec<String>>,
    in_flight: Arc<Semaphore>,
    event_input: mpsc::Sender<SurfaceFrame>,
    replay: Arc<Mutex<ReplayState>>,
    replay_space: Arc<Notify>,
    live_events: broadcast::Sender<EdgeEventEnvelope>,
}

pub async fn run_managed_server(factory: ManagedHandlerFactory) -> std::io::Result<()> {
    let args = ManagedServerArgs::parse().map_err(invalid_input)?;
    validate_runtime_path(&args.socket)?;
    validate_runtime_path(&args.credential_file)?;
    let token = tokio::fs::read_to_string(&args.credential_file)
        .await?
        .trim()
        .to_string();
    if token.len() < 32 {
        return Err(invalid_input("managed edge credential is too short"));
    }
    tokio::fs::remove_file(&args.credential_file).await?;
    if tokio::fs::try_exists(&args.socket).await? {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!(
                "managed edge socket already exists: {}",
                args.socket.display()
            ),
        ));
    }

    let listener = UnixListener::bind(&args.socket)?;
    tokio::fs::set_permissions(&args.socket, std::fs::Permissions::from_mode(0o600)).await?;
    serve_managed_listener(listener, token, factory).await
}

async fn serve_managed_listener(
    listener: UnixListener,
    token: String,
    factory: ManagedHandlerFactory,
) -> std::io::Result<()> {
    let (event_input, event_rx) = mpsc::channel(EVENT_REPLAY_CAPACITY);
    let (live_events, _) = broadcast::channel(256);
    let replay = Arc::new(Mutex::new(ReplayState::default()));
    let replay_space = Arc::new(Notify::new());
    spawn_event_owner(
        event_rx,
        replay.clone(),
        replay_space.clone(),
        live_events.clone(),
    );
    let state = Arc::new(ManagedServerState {
        token: Arc::from(token),
        factory,
        bootstrap: Mutex::new(None),
        handler: RwLock::new(None),
        capabilities: RwLock::new(Vec::new()),
        in_flight: Arc::new(Semaphore::new(MAX_IN_FLIGHT)),
        event_input,
        replay,
        replay_space,
        live_events,
    });

    loop {
        let (stream, _) = listener.accept().await?;
        if !peer_is_current_user(&stream) {
            continue;
        }
        let state = state.clone();
        tokio::spawn(async move {
            let service = service_fn(move |request| handle_request(request, state.clone()));
            let connection = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                .max_concurrent_streams(MAX_IN_FLIGHT as u32)
                .serve_connection(TokioIo::new(stream), service);
            if let Err(error) = connection.await {
                tracing::warn!(error = %error, "managed edge h2 connection closed");
            }
        });
    }
}

fn spawn_event_owner(
    mut rx: mpsc::Receiver<SurfaceFrame>,
    replay: Arc<Mutex<ReplayState>>,
    replay_space: Arc<Notify>,
    live: broadcast::Sender<EdgeEventEnvelope>,
) {
    tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            loop {
                let mut state = replay.lock().await;
                while state
                    .events
                    .front()
                    .is_some_and(|event| event.sequence <= state.acked_sequence)
                {
                    state.events.pop_front();
                }
                if state.events.len() < EVENT_REPLAY_CAPACITY {
                    let envelope = EdgeEventEnvelope {
                        sequence: state.next_sequence,
                        frame,
                    };
                    state.next_sequence = state.next_sequence.saturating_add(1);
                    state.events.push_back(envelope.clone());
                    drop(state);
                    let _ = live.send(envelope);
                    break;
                }
                drop(state);
                replay_space.notified().await;
            }
        }
    });
}

async fn handle_request(
    request: Request<Incoming>,
    state: Arc<ManagedServerState>,
) -> Result<Response<ResponseBody>, Infallible> {
    if !authorized(&request, &state.token) {
        return Ok(json_error(StatusCode::UNAUTHORIZED, "edge_auth_failed"));
    }
    let Ok(_permit) = state.in_flight.clone().try_acquire_owned() else {
        return Ok(json_error(StatusCode::TOO_MANY_REQUESTS, "edge_overloaded"));
    };
    let path = request.uri().path().to_string();
    let method = request.method().clone();

    let response = match (method, path.as_str()) {
        (Method::POST, "/_cowd/edge/v2/handshake") => bootstrap(request, &state).await,
        (Method::GET, "/_cowd/edge/v2/events") => event_stream(request, &state).await,
        (Method::POST, "/_cowd/edge/v2/events/ack") => ack_events(request, &state).await,
        (Method::POST, "/_cowd/edge/v2/configure")
        | (Method::POST, "/_cowd/edge/v2/connect")
        | (Method::POST, "/_cowd/edge/v2/disconnect")
        | (Method::GET, "/_cowd/edge/v2/health")
        | (Method::POST, "/_cowd/edge/v2/message/send")
        | (Method::POST, "/_cowd/edge/v2/action")
        | (Method::POST, "/_cowd/edge/v2/source/read")
        | (Method::POST, "/_cowd/edge/v2/source/schema")
        | (Method::POST, "/_cowd/edge/v2/source/incremental")
        | (Method::POST, "/_cowd/edge/v2/source/watermark/commit") => {
            dispatch_frame(request, &state).await
        }
        _ => json_error(StatusCode::NOT_FOUND, "edge_endpoint_not_found"),
    };
    Ok(response)
}

async fn bootstrap(
    request: Request<Incoming>,
    state: &Arc<ManagedServerState>,
) -> Response<ResponseBody> {
    let bootstrap = match decode_json::<EdgeBootstrapRequest>(request).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if bootstrap.protocol != EDGE_PROTOCOL_V2 {
        return json_error(StatusCode::BAD_REQUEST, "edge_protocol_mismatch");
    }
    let mut bootstrap_owner = state.bootstrap.lock().await;
    if let Some(existing) = bootstrap_owner.as_ref() {
        if existing != &bootstrap {
            return json_error(StatusCode::CONFLICT, "edge_bootstrap_conflict");
        }
        return bootstrap_response(state, existing).await;
    }
    let (handler, capabilities) = match (state.factory)(&bootstrap, state.event_input.clone()) {
        Ok(result) => result,
        Err(error) => return json_message(StatusCode::BAD_REQUEST, "edge_profile_rejected", error),
    };
    if !bootstrap
        .capabilities
        .iter()
        .all(|capability| capabilities.contains(capability))
    {
        return json_error(StatusCode::BAD_REQUEST, "edge_capability_mismatch");
    }
    *state.capabilities.write().await = capabilities;
    *state.handler.write().await = Some(handler);
    *bootstrap_owner = Some(bootstrap.clone());
    bootstrap_response(state, &bootstrap).await
}

async fn bootstrap_response(
    state: &ManagedServerState,
    bootstrap: &EdgeBootstrapRequest,
) -> Response<ResponseBody> {
    json_response(
        StatusCode::OK,
        &EdgeBootstrapResponse {
            protocol: EDGE_PROTOCOL_V2.to_string(),
            surface_id: bootstrap.surface_id.clone(),
            driver_profile: bootstrap.driver_profile.clone(),
            capabilities: state.capabilities.read().await.clone(),
            max_in_flight: MAX_IN_FLIGHT,
        },
    )
}

async fn dispatch_frame(
    request: Request<Incoming>,
    state: &ManagedServerState,
) -> Response<ResponseBody> {
    let frame = match decode_json::<SurfaceFrame>(request).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(handler) = state.handler.read().await.clone() else {
        return json_error(StatusCode::PRECONDITION_REQUIRED, "edge_not_bootstrapped");
    };
    let future: HandlerFuture = Box::pin(async move { handler.handle(frame).await });
    match tokio::time::timeout(std::time::Duration::from_secs(30), future).await {
        Ok(Ok(response)) => json_response(StatusCode::OK, &response),
        Ok(Err(error)) => json_message(StatusCode::BAD_GATEWAY, "edge_handler_failed", error),
        Err(_) => json_error(StatusCode::GATEWAY_TIMEOUT, "edge_handler_timeout"),
    }
}

async fn ack_events(
    request: Request<Incoming>,
    state: &ManagedServerState,
) -> Response<ResponseBody> {
    let ack = match decode_json::<EdgeEventAck>(request).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut replay = state.replay.lock().await;
    if ack.sequence >= replay.next_sequence {
        return json_error(StatusCode::CONFLICT, "edge_event_ack_out_of_range");
    }
    replay.acked_sequence = replay.acked_sequence.max(ack.sequence);
    while replay
        .events
        .front()
        .is_some_and(|event| event.sequence <= replay.acked_sequence)
    {
        replay.events.pop_front();
    }
    drop(replay);
    state.replay_space.notify_one();
    json_response(StatusCode::OK, &ack)
}

async fn event_stream(
    request: Request<Incoming>,
    state: &ManagedServerState,
) -> Response<ResponseBody> {
    if state.handler.read().await.is_none() {
        return json_error(StatusCode::PRECONDITION_REQUIRED, "edge_not_bootstrapped");
    }
    let after = request
        .uri()
        .query()
        .and_then(|query| {
            query
                .split('&')
                .find_map(|part| part.strip_prefix("after="))
        })
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let receiver = state.live_events.subscribe();
    let initial = state
        .replay
        .lock()
        .await
        .events
        .iter()
        .filter(|event| event.sequence > after)
        .cloned()
        .collect::<Vec<_>>();
    let last = initial.last().map_or(after, |event| event.sequence);
    let replay = state.replay.clone();
    let initial_stream = stream::iter(initial.into_iter().map(event_frame));
    let live_stream = stream::unfold(
        (receiver, replay, last),
        |(mut rx, replay, last)| async move {
            loop {
                match rx.recv().await {
                    Ok(event) if event.sequence > last => {
                        let next = event.sequence;
                        return Some((event_frame(event), (rx, replay, next)));
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let recovered = replay
                            .lock()
                            .await
                            .events
                            .iter()
                            .find(|event| event.sequence > last)
                            .cloned();
                        if let Some(event) = recovered {
                            let next = event.sequence;
                            return Some((event_frame(event), (rx, replay, next)));
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );
    let body = StreamBody::new(initial_stream.chain(live_stream)).boxed_unsync();
    let mut response = Response::new(body);
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    response
}

fn event_frame(event: EdgeEventEnvelope) -> Result<Frame<Bytes>, Infallible> {
    let mut bytes = serde_json::to_vec(&event).unwrap_or_else(|_| b"{}".to_vec());
    bytes.push(b'\n');
    Ok(Frame::data(Bytes::from(bytes)))
}

async fn decode_json<T: serde::de::DeserializeOwned>(
    request: Request<Incoming>,
) -> Result<T, Response<ResponseBody>> {
    let collected = Limited::new(request.into_body(), MAX_REQUEST_BODY)
        .collect()
        .await
        .map_err(|error| {
            if error.is::<http_body_util::LengthLimitError>() {
                json_error(StatusCode::PAYLOAD_TOO_LARGE, "edge_body_too_large")
            } else {
                json_error(StatusCode::BAD_REQUEST, "edge_body_read_failed")
            }
        })?;
    let bytes = collected.to_bytes();
    serde_json::from_slice(&bytes)
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, "edge_body_invalid"))
}

fn json_response<T: serde::Serialize>(status: StatusCode, value: &T) -> Response<ResponseBody> {
    let bytes = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::new(Full::new(Bytes::from(bytes)).boxed_unsync());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn json_error(status: StatusCode, code: &str) -> Response<ResponseBody> {
    json_message(status, code, code.to_string())
}

fn json_message(status: StatusCode, code: &str, message: String) -> Response<ResponseBody> {
    json_response(
        status,
        &serde_json::json!({"code": code, "message": message}),
    )
}

fn authorized(request: &Request<Incoming>, expected: &str) -> bool {
    let Some(actual) = request.headers().get(AUTH_HEADER) else {
        return false;
    };
    let Ok(actual) = actual.to_str() else {
        return false;
    };
    constant_time_eq(actual.as_bytes(), expected.as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

fn peer_is_current_user(stream: &UnixStream) -> bool {
    stream
        .peer_cred()
        .ok()
        .is_some_and(|credential| credential.uid() == unsafe { libc::geteuid() })
}

fn validate_runtime_path(path: &Path) -> std::io::Result<()> {
    if !path.is_absolute() || path.components().any(|part| part.as_os_str() == "..") {
        return Err(invalid_input(format!(
            "managed edge runtime path must be absolute and normalized: {}",
            path.display()
        )));
    }
    Ok(())
}

fn invalid_input(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use http_body_util::Full;
    use hyper::client::conn::http2::SendRequest;

    struct DelayedHandler {
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        completed: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl ManagedEdgeHandler for DelayedHandler {
        async fn handle(&self, frame: SurfaceFrame) -> Result<SurfaceFrame, String> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active.fetch_max(active, Ordering::SeqCst);
            struct ActiveGuard(Arc<AtomicUsize>);
            impl Drop for ActiveGuard {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let _guard = ActiveGuard(self.active.clone());
            let (id, delay_ms) = match frame {
                SurfaceFrame::Action { id, payload, .. } => (
                    id,
                    payload
                        .get("delay_ms")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                ),
                SurfaceFrame::Health { id, .. } => (id, 0),
                other => return Err(format!("unexpected fixture frame: {other:?}")),
            };
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            self.completed.fetch_add(1, Ordering::SeqCst);
            Ok(SurfaceFrame::Ok {
                id,
                payload: serde_json::json!({"delayed_ms": delay_ms}),
            })
        }
    }

    type TestSender = Arc<Mutex<SendRequest<Full<Bytes>>>>;

    async fn fixture_server() -> (
        TestSender,
        tokio::task::JoinHandle<std::io::Result<()>>,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
    ) {
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let completed = Arc::new(AtomicUsize::new(0));
        let handler: Arc<dyn ManagedEdgeHandler> = Arc::new(DelayedHandler {
            active: active.clone(),
            max_active: max_active.clone(),
            completed: completed.clone(),
        });
        let factory: ManagedHandlerFactory = Arc::new(move |bootstrap, events| {
            events
                .try_send(SurfaceFrame::Event {
                    surface: bootstrap.surface_id.clone(),
                    event: "fixture.ready".to_string(),
                    payload: serde_json::json!({"profile": bootstrap.driver_profile}),
                })
                .map_err(|error| error.to_string())?;
            Ok((handler.clone(), vec!["fixture.action".to_string()]))
        });
        let root = std::env::temp_dir().join(format!("cowd-edge-h2-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let socket = root.join("edge.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let server = tokio::spawn(serve_managed_listener(
            listener,
            "fixture-token-at-least-thirty-two-bytes".to_string(),
            factory,
        ));
        let stream = UnixStream::connect(&socket).await.unwrap();
        let (sender, connection) =
            hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(stream))
                .await
                .unwrap();
        tokio::spawn(async move {
            let _ = connection.await;
            let _ = std::fs::remove_dir_all(root);
        });
        let sender = Arc::new(Mutex::new(sender));
        let bootstrap = EdgeBootstrapRequest {
            protocol: EDGE_PROTOCOL_V2.to_string(),
            gateway_version: "test".to_string(),
            surface_id: "fixture".to_string(),
            driver_profile: "fixture".to_string(),
            capabilities: vec!["fixture.action".to_string()],
        };
        let response = request_json(
            &sender,
            Method::POST,
            "/_cowd/edge/v2/handshake",
            &bootstrap,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        (sender, server, active, max_active, completed)
    }

    async fn request_json<T: serde::Serialize>(
        sender: &TestSender,
        method: Method,
        path: &str,
        value: &T,
    ) -> hyper::Response<Incoming> {
        let request = Request::builder()
            .method(method)
            .version(hyper::Version::HTTP_2)
            .uri(format!("http://cowd-edge{path}"))
            .header(AUTH_HEADER, "fixture-token-at-least-thirty-two-bytes")
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from(serde_json::to_vec(value).unwrap())))
            .unwrap();
        let future = {
            let mut sender = sender.lock().await;
            sender.send_request(request)
        };
        future.await.unwrap()
    }

    #[test]
    fn constant_time_token_comparison_rejects_length_and_content_mismatch() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"same", b"shorter"));
    }

    #[test]
    fn runtime_paths_reject_relative_and_parent_components() {
        assert!(validate_runtime_path(Path::new("relative.sock")).is_err());
        assert!(validate_runtime_path(Path::new("/tmp/a/../edge.sock")).is_err());
        assert!(validate_runtime_path(Path::new("/tmp/edge.sock")).is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn h2_multiplexes_64_delayed_actions_on_one_uds_connection() {
        let (sender, server, _, max_active, completed) = fixture_server().await;
        let started = Instant::now();
        let mut tasks = Vec::new();
        for index in 0..64 {
            let sender = sender.clone();
            tasks.push(tokio::spawn(async move {
                let frame = SurfaceFrame::Action {
                    id: format!("request-{index}"),
                    surface: "fixture".to_string(),
                    action: "fixture.delay".to_string(),
                    payload: serde_json::json!({"delay_ms": 50}),
                };
                let response =
                    request_json(&sender, Method::POST, "/_cowd/edge/v2/action", &frame).await;
                assert_eq!(response.status(), StatusCode::OK);
                let bytes = response.into_body().collect().await.unwrap().to_bytes();
                let decoded: SurfaceFrame = serde_json::from_slice(&bytes).unwrap();
                assert!(matches!(decoded, SurfaceFrame::Ok { .. }));
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        let elapsed = started.elapsed();
        assert_eq!(completed.load(Ordering::SeqCst), 64);
        assert!(max_active.load(Ordering::SeqCst) >= 8);
        assert!(elapsed < Duration::from_millis(500), "elapsed={elapsed:?}");
        eprintln!(
            "managed_h2_64 elapsed_ms={} max_active={}",
            elapsed.as_micros() as f64 / 1_000.0,
            max_active.load(Ordering::SeqCst)
        );
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn event_stream_replays_bootstrap_event_and_accepts_ack() {
        let (sender, server, _, _, _) = fixture_server().await;
        let request = Request::builder()
            .method(Method::GET)
            .version(hyper::Version::HTTP_2)
            .uri("http://cowd-edge/_cowd/edge/v2/events?after=0")
            .header(AUTH_HEADER, "fixture-token-at-least-thirty-two-bytes")
            .body(Full::new(Bytes::new()))
            .unwrap();
        let response = {
            let mut sender = sender.lock().await;
            sender.send_request(request)
        }
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body();
        let data = tokio::time::timeout(Duration::from_secs(1), body.frame())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .into_data()
            .unwrap();
        let envelope: EdgeEventEnvelope = serde_json::from_slice(data.trim_ascii()).unwrap();
        assert_eq!(envelope.sequence, 1);
        assert!(matches!(envelope.frame, SurfaceFrame::Event { .. }));
        drop(body);
        let response = request_json(
            &sender,
            Method::POST,
            "/_cowd/edge/v2/events/ack",
            &EdgeEventAck { sequence: 1 },
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_h2_stream_cancels_handler_future() {
        let (sender, server, active, _, completed) = fixture_server().await;
        let request_sender = sender.clone();
        let task = tokio::spawn(async move {
            let frame = SurfaceFrame::Action {
                id: "cancel-me".to_string(),
                surface: "fixture".to_string(),
                action: "fixture.delay".to_string(),
                payload: serde_json::json!({"delay_ms": 5_000}),
            };
            request_json(
                &request_sender,
                Method::POST,
                "/_cowd/edge/v2/action",
                &frame,
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(active.load(Ordering::SeqCst), 1);
        task.abort();
        tokio::time::timeout(Duration::from_secs(1), async {
            while active.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cancelled H2 stream must drop its handler future");
        assert_eq!(completed.load(Ordering::SeqCst), 0);
        eprintln!("managed_h2_cancellation active=0 completed=0");
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rejects_oversized_request_and_future_event_ack() {
        let (sender, server, _, _, _) = fixture_server().await;
        let oversized = serde_json::json!({"payload": "x".repeat(MAX_REQUEST_BODY + 1)});
        let response =
            request_json(&sender, Method::POST, "/_cowd/edge/v2/action", &oversized).await;
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);

        let response = request_json(
            &sender,
            Method::POST,
            "/_cowd/edge/v2/events/ack",
            &EdgeEventAck { sequence: 9_999 },
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        server.abort();
    }
}
