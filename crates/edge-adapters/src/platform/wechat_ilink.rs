//! WeChat iLink Bot platform adapter.
//!
//! This adapter provides integration with Tencent's WeChat iLink Bot API,
//! supporting long-polling for messages, text sending, typing indicators,
//! QR code generation, and media upload URLs.
//!
//! The iLink API is a personal WeChat bot service that uses:
//! - Token-based authentication (POST `/ilink/bot/gettoken`)
//! - Long-polling for message updates (GET `/ilink/bot/getupdates`)
//! - Context token echoing for session continuity
//!
//! ## Hermes Reference
//!
//! Corresponds to `Hermes/hermes/providers/platforms/weixin.py` iLink
//! implementation. Base URL: `https://ilinkai.weixin.qq.com`.

use crate::platform::adapter::{
    ChatInfo, InboundMessage, MessageType, OutboundMessage, Platform, PlatformAdapter,
    PlatformError, PlatformEvent, PlatformResult,
};
use crate::platform::dedup::DedupStore;
use crate::platform::types::{SendResult, SessionKey};
use async_trait::async_trait;
use base64::Engine as _;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

/// Default iLink API base URL.
pub const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
pub const ILINK_APP_ID: &str = "bot";
pub const ILINK_APP_CLIENT_VERSION: &str = "131584";
const QR_TIMEOUT_SECS: u64 = 8;
const API_TIMEOUT_SECS: u64 = 15;
const ILINK_SESSION_EXPIRED: i64 = -14;
const ILINK_RATE_LIMITED: i64 = -2;
const TRANSIENT_RETRY_DELAY_SECS: u64 = 2;
const TRANSIENT_BACKOFF_SECS: u64 = 30;
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

/// Default long-polling timeout in seconds.
pub const DEFAULT_LONG_POLLING_TIMEOUT: u64 = 30;

/// WeChat iLink adapter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeChatLinkConfig {
    /// Bot ID (from WeChat iLink console).
    pub bot_id: String,
    /// Bot secret for authentication.
    pub bot_secret: String,
    /// QR-authorized iLink account id, when using personal WeChat login.
    #[serde(default)]
    pub account_id: Option<String>,
    /// QR-authorized bot token. Kept out of normal config files; loaded from account store.
    #[serde(default)]
    pub token: Option<String>,
    /// QR-authorized user id returned by iLink.
    #[serde(default)]
    pub user_id: Option<String>,
    /// Use Hermes-compatible QR token protocol instead of bot_id/bot_secret exchange.
    #[serde(default)]
    pub qr_token_mode: bool,
    /// Base URL for the iLink API.
    /// Default: `https://ilinkai.weixin.qq.com`
    pub base_url: String,
}

impl WeChatLinkConfig {
    /// Create a new WeChat iLink config.
    pub fn new(bot_id: impl Into<String>, bot_secret: impl Into<String>) -> Self {
        Self {
            bot_id: bot_id.into(),
            bot_secret: bot_secret.into(),
            account_id: None,
            token: None,
            user_id: None,
            base_url: ILINK_BASE_URL.to_string(),
            qr_token_mode: false,
        }
    }

    /// Set a custom base URL for the iLink API.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    pub fn from_qr_account(
        account_id: impl Into<String>,
        token: impl Into<String>,
        base_url: impl Into<String>,
        user_id: Option<String>,
    ) -> Self {
        Self {
            bot_id: String::new(),
            bot_secret: String::new(),
            account_id: Some(account_id.into()),
            token: Some(token.into()),
            user_id,
            base_url: base_url.into(),
            qr_token_mode: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeChatQrCode {
    pub qrcode: String,
    pub scan_data: String,
    pub qrcode_img_content: Option<String>,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeChatQrStatus {
    pub status: String,
    pub base_url: String,
    pub redirect_host: Option<String>,
    pub credentials: Option<WeChatQrCredentials>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeChatQrCredentials {
    pub account_id: String,
    pub token: String,
    pub base_url: String,
    pub user_id: Option<String>,
    pub saved_at: String,
}

fn wechat_account_dir(base: Option<&Path>) -> PathBuf {
    base.map(Path::to_path_buf)
        .or_else(|| crate::managed_server::managed_state_dir().map(|root| root.join("accounts")))
        .unwrap_or_else(|| {
            crate::cowd_dirs::config_home_dir()
                .join("messages")
                .join("wechat-ilink")
                .join("accounts")
        })
}

pub fn save_wechat_qr_account(
    credentials: &WeChatQrCredentials,
    base: Option<&Path>,
) -> PlatformResult<PathBuf> {
    let dir = wechat_account_dir(base);
    std::fs::create_dir_all(&dir)
        .map_err(|e| PlatformError::ConfigError(format!("create wechat account dir: {e}")))?;
    let path = dir.join(format!(
        "{}.json",
        sanitize_account_id(&credentials.account_id)
    ));
    let credential_rotated = std::fs::read(&path)
        .ok()
        .and_then(|data| serde_json::from_slice::<WeChatQrCredentials>(&data).ok())
        .is_some_and(|current| current.token != credentials.token);
    let data = serde_json::to_vec_pretty(credentials)
        .map_err(|e| PlatformError::ConfigError(format!("serialize wechat account: {e}")))?;
    std::fs::write(&path, data)
        .map_err(|e| PlatformError::ConfigError(format!("write wechat account: {e}")))?;
    if credential_rotated {
        let _ = std::fs::remove_file(wechat_sync_buf_path(&credentials.account_id, base));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

pub fn load_wechat_qr_account(
    account_id: &str,
    base: Option<&Path>,
) -> PlatformResult<WeChatQrCredentials> {
    let path = wechat_account_dir(base).join(format!("{}.json", sanitize_account_id(account_id)));
    let data = std::fs::read(&path).map_err(|e| {
        PlatformError::ConfigError(format!("read wechat account {}: {e}", path.display()))
    })?;
    serde_json::from_slice(&data).map_err(|e| {
        PlatformError::ConfigError(format!("parse wechat account {}: {e}", path.display()))
    })
}

pub fn list_wechat_qr_accounts(base: Option<&Path>) -> PlatformResult<Vec<WeChatQrCredentials>> {
    let dir = wechat_account_dir(base);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut accounts = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| PlatformError::ConfigError(format!("read wechat account dir: {e}")))?
    {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(data) = std::fs::read(&path) {
            if let Ok(account) = serde_json::from_slice::<WeChatQrCredentials>(&data) {
                accounts.push(account);
            }
        }
    }
    accounts.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(accounts)
}

fn sanitize_account_id(account_id: &str) -> String {
    account_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '@' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn json_scalar_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) if !value.is_empty() => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn wechat_sync_buf_path(account_id: &str, base: Option<&Path>) -> PathBuf {
    wechat_account_dir(base).join(format!("{}.sync.json", sanitize_account_id(account_id)))
}

fn load_wechat_sync_buf(account_id: &str, base: Option<&Path>) -> String {
    let path = wechat_sync_buf_path(account_id, base);
    std::fs::read(&path)
        .ok()
        .and_then(|data| serde_json::from_slice::<serde_json::Value>(&data).ok())
        .and_then(|value| {
            value
                .get("get_updates_buf")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_default()
}

fn save_wechat_sync_buf(
    account_id: &str,
    sync_buf: &str,
    base: Option<&Path>,
) -> PlatformResult<()> {
    let path = wechat_sync_buf_path(account_id, base);
    let parent = path
        .parent()
        .ok_or_else(|| PlatformError::ConfigError("invalid WeChat sync path".to_string()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| PlatformError::ConfigError(format!("create sync dir: {error}")))?;
    let temp = path.with_extension(format!("sync.{}.tmp", Uuid::new_v4().simple()));
    let data = serde_json::to_vec(&serde_json::json!({
        "get_updates_buf": sync_buf,
        "updated_at": Utc::now().to_rfc3339(),
    }))
    .map_err(|error| PlatformError::ConfigError(format!("serialize sync cursor: {error}")))?;
    std::fs::write(&temp, data)
        .map_err(|error| PlatformError::ConfigError(format!("write sync cursor: {error}")))?;
    std::fs::rename(&temp, &path)
        .map_err(|error| PlatformError::ConfigError(format!("commit sync cursor: {error}")))?;
    Ok(())
}

fn ilink_headers(token: Option<&str>, body_len: Option<usize>) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE};
    let mut headers = HeaderMap::new();
    headers.insert("iLink-App-Id", HeaderValue::from_static(ILINK_APP_ID));
    headers.insert(
        "iLink-App-ClientVersion",
        HeaderValue::from_static(ILINK_APP_CLIENT_VERSION),
    );
    headers.insert(
        "AuthorizationType",
        HeaderValue::from_static("ilink_bot_token"),
    );
    let random_uin = rand::random::<u32>().to_string();
    let encoded_uin = base64::engine::general_purpose::STANDARD.encode(random_uin.as_bytes());
    if let Ok(value) = HeaderValue::from_str(&encoded_uin) {
        headers.insert("X-WECHAT-UIN", value);
    }
    if let Some(len) = body_len {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
            headers.insert(CONTENT_LENGTH, value);
        }
    }
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        if let Ok(value) = HeaderValue::from_str(&format!("Bearer {token}")) {
            headers.insert(AUTHORIZATION, value);
        }
    }
    headers
}

fn ilink_protocol_error(value: &serde_json::Value, operation: &str) -> Option<PlatformError> {
    let ret = value
        .get("ret")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let errcode = value
        .get("errcode")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if ret == 0 && errcode == 0 {
        return None;
    }
    let code = if errcode != 0 { errcode } else { ret };
    let message = value
        .get("errmsg")
        .or_else(|| value.get("msg"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown iLink error");
    let stale_rate_limit =
        code == ILINK_RATE_LIMITED && message.eq_ignore_ascii_case("unknown error");
    if code == ILINK_SESSION_EXPIRED || stale_rate_limit {
        return Some(PlatformError::AuthenticationFailed(format!(
            "reauth_required: {operation} rejected the saved WeChat session ({code}: {message})"
        )));
    }
    if code == ILINK_RATE_LIMITED {
        return Some(PlatformError::RateLimited(format!(
            "{operation} rate limited ({code}: {message})"
        )));
    }
    Some(PlatformError::ReceiveFailed(format!(
        "{operation} failed ({code}: {message})"
    )))
}

async fn ilink_get_json(
    client: &reqwest::Client,
    base_url: &str,
    endpoint: &str,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    );
    let response = client
        .get(url)
        .headers(ilink_headers(None, None))
        .timeout(std::time::Duration::from_secs(QR_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("parse ilink response: {e}"))?;
    if !status.is_success() {
        return Err(format!("iLink HTTP {status}: {value}"));
    }
    Ok(value)
}

async fn ilink_post_json(
    client: &reqwest::Client,
    base_url: &str,
    endpoint: &str,
    payload: serde_json::Value,
    token: Option<&str>,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let mut body = payload.as_object().cloned().unwrap_or_default();
    body.insert(
        "base_info".to_string(),
        serde_json::json!({"channel_version": "2.2.0"}),
    );
    let body = serde_json::Value::Object(body).to_string();
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    );
    let response = client
        .post(url)
        .headers(ilink_headers(token, Some(body.len())))
        .body(body)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("parse ilink response: {e}"))?;
    if !status.is_success() {
        return Err(format!("iLink HTTP {status}: {value}"));
    }
    Ok(value)
}

pub async fn request_wechat_qr_login(bot_type: &str) -> PlatformResult<WeChatQrCode> {
    let client = reqwest::Client::new();
    let endpoint = format!("ilink/bot/get_bot_qrcode?bot_type={}", bot_type.trim());
    let value = ilink_get_json(&client, ILINK_BASE_URL, &endpoint)
        .await
        .map_err(PlatformError::AuthenticationFailed)?;
    let qrcode = value
        .get("qrcode")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            PlatformError::AuthenticationFailed("QR response missing qrcode".to_string())
        })?
        .to_string();
    let qrcode_img_content = value
        .get("qrcode_img_content")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let scan_data = qrcode_img_content.clone().unwrap_or_else(|| qrcode.clone());
    Ok(WeChatQrCode {
        qrcode,
        scan_data,
        qrcode_img_content,
        base_url: ILINK_BASE_URL.to_string(),
    })
}

pub async fn poll_wechat_qr_login(
    qrcode: &str,
    base_url: Option<&str>,
) -> PlatformResult<WeChatQrStatus> {
    let client = reqwest::Client::new();
    let base_url = normalize_wechat_base_url(base_url.unwrap_or(ILINK_BASE_URL))?;
    let endpoint = format!("ilink/bot/get_qrcode_status?qrcode={qrcode}");
    let value = match ilink_get_json(&client, &base_url, &endpoint).await {
        Ok(value) => value,
        Err(_) => {
            return Ok(WeChatQrStatus {
                status: "wait".to_string(),
                base_url,
                redirect_host: None,
                credentials: None,
            });
        }
    };
    let status = value
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("wait")
        .to_string();
    let redirect_host = value
        .get("redirect_host")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let next_base_url = match redirect_host.as_deref() {
        Some(host) if status == "scaned_but_redirect" => {
            normalize_wechat_base_url(&format!("https://{host}"))?
        }
        _ => base_url.clone(),
    };
    let credentials = if status == "confirmed" {
        let account_id = value
            .get("ilink_bot_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PlatformError::AuthenticationFailed("QR confirmed without ilink_bot_id".to_string())
            })?
            .to_string();
        let token = value
            .get("bot_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                PlatformError::AuthenticationFailed("QR confirmed without bot_token".to_string())
            })?
            .to_string();
        Some(WeChatQrCredentials {
            account_id,
            token,
            base_url: value
                .get("baseurl")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(normalize_wechat_base_url)
                .transpose()?
                .unwrap_or_else(|| next_base_url.clone()),
            user_id: value
                .get("ilink_user_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(ToString::to_string),
            saved_at: Utc::now().to_rfc3339(),
        })
    } else {
        None
    };
    Ok(WeChatQrStatus {
        status,
        base_url: next_base_url,
        redirect_host,
        credentials,
    })
}

fn normalize_wechat_base_url(value: &str) -> PlatformResult<String> {
    let parsed = reqwest::Url::parse(value).map_err(|error| {
        PlatformError::AuthenticationFailed(format!("invalid WeChat iLink base URL: {error}"))
    })?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let official_host = host == "weixin.qq.com" || host.ends_with(".weixin.qq.com");
    if parsed.scheme() != "https"
        || !official_host
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(PlatformError::AuthenticationFailed(
            "WeChat iLink base URL must be an official HTTPS weixin.qq.com endpoint".to_string(),
        ));
    }
    Ok(format!("https://{host}"))
}

/// WeChat iLink platform adapter.
///
/// Uses HTTP long-polling (no WebSocket) to receive messages from WeChat
/// users via Tencent's iLink Bot API. Simpler than Feishu — just token
/// auth, long-poll getupdates with a durable sync cursor, and sendmessage.
pub struct WeChatLinkAdapter {
    config: WeChatLinkConfig,
    connected: Arc<RwLock<bool>>,
    /// Auth token obtained via `/ilink/bot/gettoken`.
    token: Arc<RwLock<Option<String>>>,
    /// Durable get_updates_buf cursor. This is not a conversation context token.
    sync_buf: Arc<RwLock<String>>,
    /// Per-user context tokens used only when replying to an inbound message.
    reply_contexts: Arc<RwLock<HashMap<String, String>>>,
    /// Parsed updates waiting to be emitted. A long-poll response may contain
    /// several messages and advancing the sync cursor makes dropping any item permanent.
    pending_messages: Arc<Mutex<VecDeque<InboundMessage>>>,
    /// Dedup store: message_id → timestamp.
    seen_ids: DedupStore,
    /// Timestamp of last successful connect, used for reconnect backoff.
    last_connect_attempt: RwLock<Option<std::time::Instant>>,
    /// Count of consecutive auth/receive failures for backoff.
    consecutive_failures: RwLock<u32>,
}

impl WeChatLinkAdapter {
    /// Create a new WeChat iLink adapter.
    pub fn new(config: WeChatLinkConfig) -> Self {
        tracing::info!(
            "wechat_ilink adapter created: mode={} base_url={}",
            if config.qr_token_mode { "qr" } else { "bot" },
            config.base_url
        );
        let sync_buf = config
            .account_id
            .as_deref()
            .map(|account_id| load_wechat_sync_buf(account_id, None))
            .unwrap_or_default();
        Self {
            config,
            connected: Arc::new(RwLock::new(false)),
            token: Arc::new(RwLock::new(None)),
            sync_buf: Arc::new(RwLock::new(sync_buf)),
            reply_contexts: Arc::new(RwLock::new(HashMap::new())),
            pending_messages: Arc::new(Mutex::new(VecDeque::new())),
            seen_ids: DedupStore::new(10_000, 3600),
            last_connect_attempt: RwLock::new(None),
            consecutive_failures: RwLock::new(0),
        }
    }

    async fn try_reconnect(&self) -> PlatformResult<()> {
        let should_retry = {
            let last = self.last_connect_attempt.read().await;
            let fails = *self.consecutive_failures.read().await;
            match *last {
                None => true,
                Some(t) => {
                    let backoff = std::time::Duration::from_secs(
                        (fails.min(6) as u64).saturating_mul(5).max(5),
                    );
                    t.elapsed() >= backoff
                }
            }
        };
        if !should_retry {
            return Ok(());
        }
        match self.connect().await {
            Ok(()) => Ok(()),
            Err(e) => {
                let mut fails = self.consecutive_failures.write().await;
                *fails = fails.saturating_add(1);
                tracing::warn!(
                    "wechat_ilink adapter: reconnect attempt {} failed: {e}",
                    *fails
                );
                Err(e)
            }
        }
    }

    pub async fn request_qr_login(bot_type: &str) -> PlatformResult<WeChatQrCode> {
        request_wechat_qr_login(bot_type).await
    }

    pub async fn poll_qr_login(
        qrcode: &str,
        base_url: Option<&str>,
    ) -> PlatformResult<WeChatQrStatus> {
        poll_wechat_qr_login(qrcode, base_url).await
    }

    // ------------------------------------------------------------------
    // iLink API methods
    // ------------------------------------------------------------------

    /// Get an auth token from the iLink API.
    ///
    /// POST `/ilink/bot/gettoken` with bot_id + bot_secret.
    /// Returns the token string on success.
    pub async fn authenticate(&self) -> PlatformResult<String> {
        if self.config.qr_token_mode {
            return self
                .config
                .token
                .clone()
                .filter(|t| !t.is_empty())
                .ok_or_else(|| {
                    PlatformError::AuthenticationFailed(
                        "missing QR-authorized wechat token; configure the WeChat platform in Gateway/WebUI"
                            .to_string(),
                    )
                });
        }

        let client = reqwest::Client::new();
        let url = format!("{}/ilink/bot/gettoken", self.config.base_url);

        let response = client
            .post(&url)
            .json(&serde_json::json!({
                "bot_id": self.config.bot_id,
                "bot_secret": self.config.bot_secret,
            }))
            .send()
            .await
            .map_err(|e| PlatformError::AuthenticationFailed(e.to_string()))?;

        if !response.status().is_success() {
            return Err(PlatformError::AuthenticationFailed(format!(
                "auth request failed with status: {}",
                response.status()
            )));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            token: Option<String>,
        }

        let token_resp: TokenResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::AuthenticationFailed(e.to_string()))?;

        if token_resp.code != 0 {
            return Err(PlatformError::AuthenticationFailed(format!(
                "auth failed (code={}): {}",
                token_resp.code, token_resp.msg
            )));
        }

        token_resp
            .token
            .ok_or_else(|| PlatformError::AuthenticationFailed("no token in response".to_string()))
    }

    /// Ensure a valid token is available.
    ///
    /// Returns the cached token if present, otherwise calls `authenticate()`
    /// and stores the result.
    pub async fn ensure_token(&self) -> PlatformResult<String> {
        if let Some(token) = self.token.read().await.as_ref() {
            if !token.is_empty() {
                return Ok(token.clone());
            }
        }

        let token = self.authenticate().await?;
        *self.token.write().await = Some(token.clone());
        Ok(token)
    }

    /// Long-poll for incoming messages from iLink.
    ///
    /// Poll `/ilink/bot/getupdates` with the durable `get_updates_buf` cursor.
    ///
    /// The QR-token protocol uses this cursor only for stream progress. Each
    /// conversation's `context_token` is tracked separately for replies.
    ///
    /// Returns a list of message JSON objects, or an empty vec on timeout.
    pub async fn get_updates(&self) -> PlatformResult<Vec<serde_json::Value>> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();

        let sync_buf = self.sync_buf.read().await.clone();

        if self.config.qr_token_mode {
            let json = ilink_post_json(
                &client,
                &self.config.base_url,
                "ilink/bot/getupdates",
                serde_json::json!({"get_updates_buf": sync_buf}),
                Some(&token),
                DEFAULT_LONG_POLLING_TIMEOUT,
            )
            .await
            .map_err(|e| PlatformError::ReceiveFailed(e.to_string()))?;
            if let Some(error) = ilink_protocol_error(&json, "get_updates") {
                return Err(error);
            }

            if let Some(new_ctx) = json
                .get("get_updates_buf")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                *self.sync_buf.write().await = new_ctx.to_string();
                if let Some(account_id) = self.config.account_id.as_deref() {
                    save_wechat_sync_buf(account_id, new_ctx, None)?;
                }
            }

            return Ok(json
                .get("msgs")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default());
        }

        let url = format!("{}/ilink/bot/getupdates", self.config.base_url);

        let response = client
            .get(&url)
            .query(&[
                ("token", token.as_str()),
                ("context_token", sync_buf.as_str()),
            ])
            .timeout(std::time::Duration::from_secs(DEFAULT_LONG_POLLING_TIMEOUT))
            .send()
            .await
            .map_err(|e| {
                // Timeout is expected — long-poll may return after the server-side
                // timeout without data. This is not an error.
                if e.is_timeout() {
                    tracing::debug!("ilink get_updates long-poll timeout (expected)");
                    return PlatformError::ReceiveFailed("long-poll timeout".to_string());
                }
                PlatformError::ReceiveFailed(e.to_string())
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PlatformError::ReceiveFailed(format!(
                "get_updates failed {}: {}",
                status, body
            )));
        }

        #[derive(Deserialize)]
        struct UpdatesResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            context_token: Option<String>,
            data: Option<Vec<serde_json::Value>>,
        }

        let updates_resp: UpdatesResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::ReceiveFailed(e.to_string()))?;

        if updates_resp.code != 0 {
            return Err(PlatformError::ReceiveFailed(format!(
                "get_updates error (code={}): {}",
                updates_resp.code, updates_resp.msg
            )));
        }

        // Update the context_token for the next long-poll cycle
        if let Some(new_ctx_token) = updates_resp.context_token {
            *self.sync_buf.write().await = new_ctx_token;
        }

        Ok(updates_resp.data.unwrap_or_default())
    }

    /// Parse a raw iLink message JSON into an `InboundMessage`.
    fn parse_ilink_message(&self, msg: &serde_json::Value) -> Option<InboundMessage> {
        let numeric_type = msg.get("message_type").and_then(serde_json::Value::as_i64);
        let legacy_type = msg.get("msg_type").and_then(serde_json::Value::as_str);
        let is_user_message = numeric_type == Some(1)
            || (numeric_type.is_none()
                && matches!(
                    legacy_type,
                    Some("text" | "image" | "voice" | "video" | "file")
                ));
        if !is_user_message {
            return None;
        }

        let from_user = msg
            .get("from_user")
            .and_then(|v| v.as_str())
            .or_else(|| msg.get("from_user_id").and_then(|v| v.as_str()))
            .unwrap_or("");
        if from_user.is_empty() {
            return None;
        }
        if self
            .config
            .account_id
            .as_deref()
            .is_some_and(|account_id| account_id == from_user)
        {
            return None;
        }

        let message_id = msg
            .get("message_id")
            .and_then(json_scalar_string)
            .or_else(|| msg.get("client_id").and_then(json_scalar_string));

        let items = msg
            .get("item_list")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let text = msg
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .into_iter()
            .chain(items.iter().filter_map(|item| {
                item.get("text_item")
                    .and_then(|value| value.get("text"))
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string)
            }))
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let item_types = items
            .iter()
            .filter_map(|item| item.get("type").and_then(serde_json::Value::as_i64))
            .collect::<Vec<_>>();
        let message_type = if item_types.contains(&2) || legacy_type == Some("image") {
            MessageType::Photo
        } else if item_types.contains(&5) || legacy_type == Some("video") {
            MessageType::Video
        } else if item_types.contains(&3) || legacy_type == Some("voice") {
            MessageType::Voice
        } else if item_types.contains(&4) || legacy_type == Some("file") {
            MessageType::Document
        } else {
            MessageType::Text
        };
        let text = if text.is_empty() {
            match message_type {
                MessageType::Photo => "[Image]".to_string(),
                MessageType::Voice => "[Voice message]".to_string(),
                MessageType::Video => "[Video]".to_string(),
                MessageType::Document => "[File]".to_string(),
                _ => return None,
            }
        } else {
            text
        };

        let msg_timestamp = msg
            .get("timestamp")
            .or_else(|| msg.get("create_time_ms"))
            .or_else(|| msg.get("create_time"))
            .and_then(|v| v.as_i64())
            .map(|ts| {
                let millis = if ts.abs() < 10_000_000_000 {
                    ts.saturating_mul(1_000)
                } else {
                    ts
                };
                chrono::TimeZone::timestamp_millis_opt(&Utc, millis)
                    .single()
                    .unwrap_or_else(Utc::now)
            })
            .unwrap_or_else(Utc::now);

        let session_key = SessionKey::new("wechat-ilink", from_user);
        let context_token = msg
            .get("context_token")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        Some(InboundMessage {
            platform: Platform::WeChat,
            session_key,
            text,
            sender_name: None,
            timestamp: msg_timestamp,
            metadata: serde_json::json!({
                "message_id": message_id,
                "from_user": from_user,
                "message_type": numeric_type,
                "item_types": item_types,
                "context_token": context_token,
            }),
            message_type,
            message_id,
            reply_to_message_id: None,
            media_urls: vec![],
            media_types: vec![],
        })
    }

    /// Send a text message to a user via iLink.
    ///
    /// POST `/ilink/bot/sendmessage` with params: token, touser, msgtype="text", text.
    /// Returns the message ID on success.
    pub async fn send_text(&self, to_user: &str, text: &str) -> PlatformResult<String> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();

        if self.config.qr_token_mode {
            let client_id = format!("cowd-weixin-{}", Uuid::new_v4().simple());
            let reply_context = self
                .reply_contexts
                .read()
                .await
                .get(to_user)
                .cloned()
                .unwrap_or_default();
            let mut msg = serde_json::json!({
                "from_user_id": "",
                "to_user_id": to_user,
                "client_id": client_id,
                "message_type": 2,
                "message_state": 2,
                "item_list": [{
                    "type": 1,
                    "text_item": {"text": text}
                }]
            });
            if !reply_context.is_empty() {
                msg["context_token"] = serde_json::Value::String(reply_context);
            }
            let response = ilink_post_json(
                &client,
                &self.config.base_url,
                "ilink/bot/sendmessage",
                serde_json::json!({"msg": msg}),
                Some(&token),
                API_TIMEOUT_SECS,
            )
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;
            if let Some(error) = ilink_protocol_error(&response, "send_message") {
                return Err(error);
            }
            return Ok(client_id);
        }

        let url = format!("{}/ilink/bot/sendmessage", self.config.base_url);

        let response = client
            .post(&url)
            .json(&serde_json::json!({
                "token": token,
                "touser": to_user,
                "msgtype": "text",
                "text": text,
            }))
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        #[derive(Deserialize)]
        struct SendResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            message_id: Option<String>,
        }

        let send_resp: SendResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if send_resp.code != 0 {
            return Err(PlatformError::SendFailed(format!(
                "send_text failed (code={}): {}",
                send_resp.code, send_resp.msg
            )));
        }

        let msg_id = send_resp.message_id.unwrap_or_default();
        tracing::debug!(to = %to_user, %msg_id, "ilink text message sent");
        Ok(msg_id)
    }

    /// Send a typing indicator to a user.
    ///
    /// POST `/ilink/bot/sendtyping` with params: token, touser.
    pub async fn send_typing_indicator(&self, to_user: &str) -> PlatformResult<()> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();

        if self.config.qr_token_mode {
            let response = ilink_post_json(
                &client,
                &self.config.base_url,
                "ilink/bot/sendtyping",
                serde_json::json!({"ilink_user_id": to_user, "status": 1}),
                Some(&token),
                API_TIMEOUT_SECS,
            )
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;
            if let Some(error) = ilink_protocol_error(&response, "send_typing") {
                return Err(error);
            }
            return Ok(());
        }

        let url = format!("{}/ilink/bot/sendtyping", self.config.base_url);

        let response = client
            .post(&url)
            .json(&serde_json::json!({
                "token": token,
                "touser": to_user,
            }))
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        #[derive(Deserialize)]
        struct TypingResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
        }

        let typing_resp: TypingResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if typing_resp.code != 0 {
            return Err(PlatformError::SendFailed(format!(
                "send_typing failed (code={}): {}",
                typing_resp.code, typing_resp.msg
            )));
        }

        tracing::debug!(to = %to_user, "ilink typing indicator sent");
        Ok(())
    }

    /// Get the QR code URL for bot login.
    ///
    /// GET `/ilink/bot/get_bot_qrcode` with params: token.
    pub async fn get_qr_code(&self) -> PlatformResult<String> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();
        let url = format!("{}/ilink/bot/get_bot_qrcode", self.config.base_url);

        let response = client
            .get(&url)
            .query(&[("token", token.as_str())])
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if !response.status().is_success() {
            return Err(PlatformError::SendFailed(format!(
                "get_qr_code failed with status: {}",
                response.status()
            )));
        }

        #[derive(Deserialize)]
        struct QrCodeResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            qrcode_url: Option<String>,
        }

        let qr_resp: QrCodeResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if qr_resp.code != 0 {
            return Err(PlatformError::SendFailed(format!(
                "get_qr_code failed (code={}): {}",
                qr_resp.code, qr_resp.msg
            )));
        }

        qr_resp
            .qrcode_url
            .ok_or_else(|| PlatformError::SendFailed("no qrcode_url in response".to_string()))
    }

    /// Get a media upload URL from iLink.
    ///
    /// GET `/ilink/bot/getuploadurl` with params: token, file_type.
    pub async fn get_upload_url(&self, file_type: &str) -> PlatformResult<String> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();
        let url = format!("{}/ilink/bot/getuploadurl", self.config.base_url);

        let response = client
            .get(&url)
            .query(&[("token", token.as_str()), ("file_type", file_type)])
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if !response.status().is_success() {
            return Err(PlatformError::SendFailed(format!(
                "get_upload_url failed with status: {}",
                response.status()
            )));
        }

        #[derive(Deserialize)]
        struct UploadUrlResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            upload_url: Option<String>,
        }

        let upload_resp: UploadUrlResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if upload_resp.code != 0 {
            return Err(PlatformError::SendFailed(format!(
                "get_upload_url failed (code={}): {}",
                upload_resp.code, upload_resp.msg
            )));
        }

        upload_resp
            .upload_url
            .ok_or_else(|| PlatformError::SendFailed("no upload_url in response".to_string()))
    }

    /// Check if a message ID has already been seen (within TTL).
    /// Automatically marks the ID as seen if not already present.
    async fn is_duplicate(&self, message_id: &str) -> bool {
        self.seen_ids.is_duplicate(message_id).await
    }
}

// ------------------------------------------------------------------
// PlatformAdapter trait implementation
// ------------------------------------------------------------------

#[async_trait]
impl PlatformAdapter for WeChatLinkAdapter {
    fn platform(&self) -> Platform {
        Platform::WeChat
    }

    fn platform_name(&self) -> &str {
        "wechat_ilink"
    }

    async fn connect(&self) -> PlatformResult<()> {
        tracing::info!("wechat_ilink adapter: attempting connection...");
        *self.last_connect_attempt.write().await = Some(std::time::Instant::now());
        let token = self.authenticate().await?;
        *self.token.write().await = Some(token.clone());
        *self.connected.write().await = true;
        *self.consecutive_failures.write().await = 0;
        tracing::info!(
            "wechat_ilink adapter: connected successfully (token={}...{})",
            &token[..token.len().min(8)],
            &token[token.len().saturating_sub(8)..]
        );
        Ok(())
    }

    async fn disconnect(&self) -> PlatformResult<()> {
        *self.connected.write().await = false;
        *self.token.write().await = None;
        self.reply_contexts.write().await.clear();
        self.pending_messages.lock().await.clear();
        *self.last_connect_attempt.write().await = None;
        *self.consecutive_failures.write().await = 0;
        tracing::info!("wechat_ilink adapter disconnected");
        Ok(())
    }

    fn is_connected(&self) -> bool {
        let connected = self.connected.blocking_read();
        *connected
    }

    async fn receive(&self) -> PlatformResult<Option<InboundMessage>> {
        if let Some(message) = self.pending_messages.lock().await.pop_front() {
            return Ok(Some(message));
        }
        let connected = *self.connected.read().await;
        if !connected {
            if let Err(e) = self.try_reconnect().await {
                tracing::debug!("wechat_ilink adapter: reconnect pending ({e})");
            }
            return Ok(None);
        }

        let updates = match self.get_updates().await {
            Ok(updates) => {
                *self.consecutive_failures.write().await = 0;
                updates
            }
            Err(error @ PlatformError::AuthenticationFailed(_)) => {
                *self.connected.write().await = false;
                *self.token.write().await = None;
                tracing::error!("wechat_ilink adapter requires a new QR authorization: {error}");
                return Err(error);
            }
            Err(PlatformError::RateLimited(message)) => {
                tracing::warn!("wechat_ilink adapter rate limited: {message}");
                tokio::time::sleep(std::time::Duration::from_secs(TRANSIENT_BACKOFF_SECS)).await;
                return Ok(None);
            }
            Err(error) => {
                let message = error.to_string();
                if message.contains("timed out") || message.contains("timeout") {
                    tracing::debug!("wechat_ilink long-poll timeout");
                    return Ok(None);
                }
                let mut failures = self.consecutive_failures.write().await;
                *failures = failures.saturating_add(1);
                let delay = if *failures >= MAX_CONSECUTIVE_FAILURES {
                    *failures = 0;
                    TRANSIENT_BACKOFF_SECS
                } else {
                    TRANSIENT_RETRY_DELAY_SECS
                };
                tracing::warn!(delay, "wechat_ilink transient receive failure: {message}");
                drop(failures);
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                return Ok(None);
            }
        };

        for msg in updates {
            let msg_id = msg
                .get("message_id")
                .and_then(json_scalar_string)
                .or_else(|| msg.get("client_id").and_then(json_scalar_string));

            if let Some(ref mid) = msg_id {
                if self.is_duplicate(mid).await {
                    tracing::debug!(%mid, "ilink skipping duplicate message");
                    continue;
                }
            }

            if let Some(inbound) = self.parse_ilink_message(&msg) {
                if let Some(context_token) = msg
                    .get("context_token")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    self.reply_contexts.write().await.insert(
                        inbound.session_key.user_id.clone(),
                        context_token.to_string(),
                    );
                }
                self.pending_messages.lock().await.push_back(inbound);
            }
        }

        Ok(self.pending_messages.lock().await.pop_front())
    }

    async fn send(&self, msg: &OutboundMessage) -> PlatformResult<SendResult> {
        let to_user = &msg.session_key.user_id;
        self.send_text(to_user, &msg.text).await?;
        Ok(SendResult::success(None))
    }

    async fn send_typing(&self, chat_id: &str) -> Result<(), PlatformError> {
        self.send_typing_indicator(chat_id).await
    }

    // Optional actions that iLink does not advertise remain fail-closed.

    async fn send_image(
        &self,
        chat_id: &str,
        image_url: &str,
        caption: Option<&str>,
    ) -> PlatformResult<()> {
        let token = self.ensure_token().await?;
        let client = reqwest::Client::new();

        // 1. Download the image
        let image_bytes = client
            .get(image_url)
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(format!("download image: {e}")))?
            .bytes()
            .await
            .map_err(|e| PlatformError::SendFailed(format!("read image bytes: {e}")))?;

        // 2. Get upload URL from iLink and upload the image
        let upload_url = self.get_upload_url("image").await?;

        let upload_resp = client
            .post(&upload_url)
            .body(image_bytes.to_vec())
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(format!("upload image: {e}")))?;

        let upload_json: serde_json::Value = upload_resp
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(format!("parse upload response: {e}")))?;

        let image_key = upload_json["image_key"]
            .as_str()
            .or_else(|| upload_json["media_id"].as_str())
            .ok_or_else(|| PlatformError::SendFailed("no image_key in upload response".into()))?;

        // 3. Send image message via iLink
        let url = format!("{}/ilink/bot/sendmessage", self.config.base_url);

        let mut payload = serde_json::json!({
            "token": token,
            "touser": chat_id,
            "msgtype": "image",
            "image": {
                "media_id": image_key,
            },
        });

        if let Some(cap) = caption {
            payload["image"]["caption"] = serde_json::Value::String(cap.to_string());
        }

        let response = client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| PlatformError::SendFailed(format!("send image: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PlatformError::SendFailed(format!(
                "send_image failed {}: {}",
                status, body
            )));
        }

        #[derive(Deserialize)]
        struct SendResponse {
            #[serde(default)]
            code: i32,
            #[serde(default)]
            msg: String,
            message_id: Option<String>,
        }

        let send_resp: SendResponse = response
            .json()
            .await
            .map_err(|e| PlatformError::SendFailed(e.to_string()))?;

        if send_resp.code != 0 {
            return Err(PlatformError::SendFailed(format!(
                "send_image failed (code={}): {}",
                send_resp.code, send_resp.msg
            )));
        }

        tracing::debug!(
            to = %chat_id,
            msg_id = %send_resp.message_id.unwrap_or_default(),
            "ilink image message sent"
        );
        Ok(())
    }

    async fn send_image_file(
        &self,
        _chat_id: &str,
        _image_path: &str,
        _caption: Option<&str>,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("send_image_file".into()))
    }

    async fn send_voice(
        &self,
        _chat_id: &str,
        _audio_path: &str,
        _caption: Option<&str>,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("send_voice".into()))
    }

    async fn send_document(
        &self,
        _chat_id: &str,
        _file_path: &str,
        _file_name: Option<&str>,
        _caption: Option<&str>,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("send_document".into()))
    }

    async fn send_video(
        &self,
        _chat_id: &str,
        _video_path: &str,
        _caption: Option<&str>,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("send_video".into()))
    }

    async fn send_animation(
        &self,
        _chat_id: &str,
        _animation_url: &str,
        _caption: Option<&str>,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("send_animation".into()))
    }

    async fn edit_message(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _content: &str,
    ) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("edit_message".into()))
    }

    async fn delete_message(&self, _chat_id: &str, _message_id: &str) -> PlatformResult<()> {
        Err(PlatformError::NotImplemented("delete_message".into()))
    }

    async fn get_chat_info(&self, chat_id: &str) -> PlatformResult<ChatInfo> {
        Ok(ChatInfo {
            chat_id: chat_id.to_string(),
            name: "WeChat iLink Chat".into(),
            chat_type: "wechat_ilink".into(),
        })
    }

    async fn send_card(&self, _chat_id: &str, _card_json: &str) -> PlatformResult<String> {
        Err(PlatformError::NotImplemented("send_card".into()))
    }

    async fn on_event(&self, _event: &PlatformEvent) -> PlatformResult<Option<InboundMessage>> {
        Ok(None)
    }
}

/// Create a WeChat iLink adapter from config settings.
pub fn create_wechat_ilink_adapter(
    settings: &serde_json::Value,
) -> PlatformResult<WeChatLinkAdapter> {
    let credential_source = settings
        .get("credential_source")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if credential_source == "qr_account" || settings.get("account_id").is_some() {
        let account_id = settings
            .get("account_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PlatformError::ConfigError("missing account_id".to_string()))?;
        let account_store_dir = settings
            .get("account_store_dir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        let account = load_wechat_qr_account(account_id, account_store_dir.as_deref())?;
        let config = WeChatLinkConfig::from_qr_account(
            account.account_id,
            account.token,
            account.base_url,
            account.user_id,
        );
        return Ok(WeChatLinkAdapter::new(config));
    }

    let bot_id = settings
        .get("bot_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| PlatformError::ConfigError("missing bot_id".to_string()))?;

    let bot_secret = settings
        .get("bot_secret")
        .and_then(|v| v.as_str())
        .ok_or_else(|| PlatformError::ConfigError("missing bot_secret".to_string()))?;

    let base_url = settings
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or(ILINK_BASE_URL);

    let config = WeChatLinkConfig::new(bot_id, bot_secret).with_base_url(base_url);
    Ok(WeChatLinkAdapter::new(config))
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // Config tests
    // ------------------------------------------------------------------

    #[test]
    fn test_config_creation() {
        let config = WeChatLinkConfig::new("bot_123", "secret_456");
        assert_eq!(config.bot_id, "bot_123");
        assert_eq!(config.bot_secret, "secret_456");
        assert_eq!(config.base_url, ILINK_BASE_URL);
    }

    #[test]
    fn test_config_with_custom_base_url() {
        let config = WeChatLinkConfig::new("bot_1", "secret_2")
            .with_base_url("https://custom.ilink.example.com");
        assert_eq!(config.base_url, "https://custom.ilink.example.com");
    }

    // ------------------------------------------------------------------
    // Connect / disconnect state tests
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn test_connect_disconnect_state() {
        let config =
            WeChatLinkConfig::new("test_bot", "test_secret").with_base_url("https://localhost:1"); // unreachable, will fail auth
        let adapter = WeChatLinkAdapter::new(config);

        // Initially not connected (check directly via RwLock, avoid
        // is_connected() which uses blocking_read and panics inside tokio runtime)
        {
            let connected = adapter.connected.read().await;
            assert!(!*connected);
        }

        // Manually simulate connect by setting state
        *adapter.connected.write().await = true;
        {
            let connected = adapter.connected.read().await;
            assert!(*connected);
        }

        // Disconnect
        adapter.disconnect().await.unwrap();
        {
            let connected = adapter.connected.read().await;
            assert!(!*connected);
        }

        // Token should be cleared
        let token = adapter.token.read().await;
        assert!(token.is_none());
    }

    #[tokio::test]
    async fn test_sync_cursor_is_independent_from_reply_contexts() {
        let config = WeChatLinkConfig::new("test_bot", "test_secret");
        let adapter = WeChatLinkAdapter::new(config);

        {
            let cursor = adapter.sync_buf.read().await;
            assert!(cursor.is_empty());
        }

        {
            let mut cursor = adapter.sync_buf.write().await;
            *cursor = "sync_cursor_abc123".to_string();
        }
        adapter
            .reply_contexts
            .write()
            .await
            .insert("user_1".to_string(), "reply_context_xyz".to_string());
        {
            let cursor = adapter.sync_buf.read().await;
            assert_eq!(*cursor, "sync_cursor_abc123");
        }
        {
            let contexts = adapter.reply_contexts.read().await;
            assert_eq!(
                contexts.get("user_1").map(String::as_str),
                Some("reply_context_xyz")
            );
        }

        adapter.disconnect().await.unwrap();
        {
            let cursor = adapter.sync_buf.read().await;
            assert_eq!(*cursor, "sync_cursor_abc123");
        }
        assert!(adapter.reply_contexts.read().await.is_empty());
    }

    #[tokio::test]
    async fn test_get_updates_request_format() {
        let config =
            WeChatLinkConfig::new("test_bot", "test_secret").with_base_url("https://localhost:1");
        let adapter = WeChatLinkAdapter::new(config);

        // Set a dummy token so ensure_token doesn't try to auth
        {
            let mut token = adapter.token.write().await;
            *token = Some("dummy_token_xyz".to_string());
        }

        {
            let mut cursor = adapter.sync_buf.write().await;
            *cursor = "prev_sync_cursor".to_string();
        }

        let result = adapter.get_updates().await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_send_text_request_format() {
        let config =
            WeChatLinkConfig::new("test_bot", "test_secret").with_base_url("https://localhost:1");
        let adapter = WeChatLinkAdapter::new(config);

        // Set a dummy token
        {
            let mut token = adapter.token.write().await;
            *token = Some("dummy_token_xyz".to_string());
        }

        let result = adapter.send_text("user_abc", "Hello World!").await;
        // Expected to fail because localhost:1 is unreachable
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // PlatformAdapter trait implementation tests
    // ------------------------------------------------------------------

    #[test]
    fn test_platform_returns_wechat() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);
        assert_eq!(adapter.platform(), Platform::WeChat);
    }

    #[test]
    fn test_platform_name_returns_wechat_ilink() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);
        assert_eq!(adapter.platform_name(), "wechat_ilink");
    }

    #[tokio::test]
    async fn test_send_typing_delegates_to_indicator() {
        let config =
            WeChatLinkConfig::new("test_bot", "test_secret").with_base_url("https://localhost:1");
        let adapter = WeChatLinkAdapter::new(config);

        // Set a dummy token
        {
            let mut token = adapter.token.write().await;
            *token = Some("dummy_token_xyz".to_string());
        }

        let result = adapter.send_typing("user_abc").await;
        // Expected to fail because localhost:1 is unreachable
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_send_delegates_to_send_text() {
        let config =
            WeChatLinkConfig::new("test_bot", "test_secret").with_base_url("https://localhost:1");
        let adapter = WeChatLinkAdapter::new(config);

        // Set a dummy token
        {
            let mut token = adapter.token.write().await;
            *token = Some("dummy_token_xyz".to_string());
        }

        let msg = OutboundMessage {
            session_key: SessionKey::new("wechat_ilink", "user_abc"),
            text: "Test message".to_string(),
            reply_to: None,
            metadata: serde_json::Value::Null,
        };

        let result = adapter.send(&msg).await;
        // Expected to fail because localhost:1 is unreachable
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_receive_returns_none_when_disconnected() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);
        // Not connected by default
        let result = adapter.receive().await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_parse_ilink_text_message() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let msg = serde_json::json!({
            "message_id": "msg_001",
            "from_user": "user_abc",
            "msg_type": "text",
            "text": "Hello World!",
            "timestamp": 1700000000000_i64,
        });

        let parsed = adapter.parse_ilink_message(&msg);
        assert!(parsed.is_some());
        let inbound = parsed.unwrap();
        assert_eq!(inbound.text, "Hello World!");
        assert_eq!(inbound.message_id, Some("msg_001".to_string()));
        assert_eq!(inbound.session_key.user_id, "user_abc");
        assert_eq!(inbound.message_type, MessageType::Text);
        assert_eq!(inbound.platform, Platform::WeChat);
    }

    #[test]
    fn test_parse_official_numeric_text_message() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);
        let msg = serde_json::json!({
            "message_id": 18273645,
            "from_user_id": "user_numeric",
            "message_type": 1,
            "context_token": "reply_context",
            "item_list": [{
                "type": 1,
                "text_item": {"text": "来自微信的真实协议消息"}
            }],
            "create_time_ms": 1700000000000_i64,
        });

        let inbound = adapter.parse_ilink_message(&msg).unwrap();
        assert_eq!(inbound.text, "来自微信的真实协议消息");
        assert_eq!(inbound.message_id.as_deref(), Some("18273645"));
        assert_eq!(inbound.session_key.platform, "wechat-ilink");
        assert_eq!(inbound.session_key.user_id, "user_numeric");
    }

    #[test]
    fn qr_login_user_id_is_an_inbound_sender_not_the_bot_identity() {
        let config = WeChatLinkConfig::from_qr_account(
            "4826e57d2c1e@im.bot",
            "test-token",
            ILINK_BASE_URL,
            Some("ilink-user-who-scanned-the-qr".to_string()),
        );
        let adapter = WeChatLinkAdapter::new(config);
        let msg = serde_json::json!({
            "message_id": 18273646,
            "from_user_id": "ilink-user-who-scanned-the-qr",
            "message_type": 1,
            "context_token": "reply-context",
            "item_list": [{
                "type": 1,
                "text_item": {"text": "扫码用户发给机器人的消息"}
            }]
        });

        let inbound = adapter
            .parse_ilink_message(&msg)
            .expect("the QR user's message must reach Gateway");
        assert_eq!(inbound.text, "扫码用户发给机器人的消息");
        assert_eq!(inbound.session_key.user_id, "ilink-user-who-scanned-the-qr");
    }

    #[test]
    fn qr_login_bot_id_is_still_rejected_as_an_echo() {
        let config = WeChatLinkConfig::from_qr_account(
            "4826e57d2c1e@im.bot",
            "test-token",
            ILINK_BASE_URL,
            Some("ilink-user-who-scanned-the-qr".to_string()),
        );
        let adapter = WeChatLinkAdapter::new(config);
        let msg = serde_json::json!({
            "message_id": 18273647,
            "from_user_id": "4826e57d2c1e@im.bot",
            "message_type": 1,
            "item_list": [{
                "type": 1,
                "text_item": {"text": "bot echo"}
            }]
        });

        assert!(adapter.parse_ilink_message(&msg).is_none());
    }

    #[test]
    fn test_parse_rejects_bot_messages() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);
        let msg = serde_json::json!({
            "message_id": 99,
            "from_user_id": "bot_sender",
            "message_type": 2,
            "item_list": [{
                "type": 1,
                "text_item": {"text": "bot echo"}
            }]
        });

        assert!(adapter.parse_ilink_message(&msg).is_none());
    }

    #[test]
    fn test_ilink_protocol_errors_require_reauthorization() {
        let expired = ilink_protocol_error(
            &serde_json::json!({"errcode": -14, "errmsg": "session timeout"}),
            "get_updates",
        );
        assert!(matches!(
            expired,
            Some(PlatformError::AuthenticationFailed(message))
                if message.contains("reauth_required")
        ));

        let stale = ilink_protocol_error(
            &serde_json::json!({"errcode": -2, "errmsg": "unknown error"}),
            "get_updates",
        );
        assert!(matches!(
            stale,
            Some(PlatformError::AuthenticationFailed(message))
                if message.contains("reauth_required")
        ));

        assert!(ilink_protocol_error(&serde_json::json!({"ret": 0}), "get_updates").is_none());
    }

    #[test]
    fn test_ilink_headers_include_official_auth_contract() {
        let headers = ilink_headers(Some("token"), Some(2));
        assert_eq!(
            headers
                .get("AuthorizationType")
                .and_then(|value| value.to_str().ok()),
            Some("ilink_bot_token")
        );
        assert!(headers.get("X-WECHAT-UIN").is_some());
        assert_eq!(
            headers
                .get(reqwest::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer token")
        );
    }

    #[test]
    fn test_sync_cursor_persists_and_resets_when_credentials_rotate() {
        let root =
            std::env::temp_dir().join(format!("cowd-wechat-sync-test-{}", Uuid::new_v4().simple()));
        let account = WeChatQrCredentials {
            account_id: "account-1".to_string(),
            token: "token-v1".to_string(),
            base_url: ILINK_BASE_URL.to_string(),
            user_id: Some("bot-user".to_string()),
            saved_at: Utc::now().to_rfc3339(),
        };
        save_wechat_qr_account(&account, Some(&root)).unwrap();
        save_wechat_sync_buf(&account.account_id, "cursor-v1", Some(&root)).unwrap();
        assert_eq!(
            load_wechat_sync_buf(&account.account_id, Some(&root)),
            "cursor-v1"
        );

        let mut refreshed = account;
        refreshed.token = "token-v2".to_string();
        save_wechat_qr_account(&refreshed, Some(&root)).unwrap();
        assert!(load_wechat_sync_buf(&refreshed.account_id, Some(&root)).is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_parse_ilink_image_message() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let msg = serde_json::json!({
            "message_id": "msg_002",
            "from_user": "user_abc",
            "msg_type": "image",
            "timestamp": 1700000000000_i64,
        });

        let parsed = adapter.parse_ilink_message(&msg);
        assert!(parsed.is_some());
        let inbound = parsed.unwrap();
        assert_eq!(inbound.text, "[Image]");
        assert_eq!(inbound.message_type, MessageType::Photo);
    }

    #[test]
    fn test_parse_ilink_message_without_from_user() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let msg = serde_json::json!({
            "message_id": "msg_003",
            "msg_type": "text",
            "text": "No sender",
        });

        let parsed = adapter.parse_ilink_message(&msg);
        assert!(parsed.is_none());
    }

    #[test]
    fn test_dedup_seen_ids() {
        // This test verifies the DedupStore behavior directly
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();

        rt.block_on(async {
            // First sighting — not a duplicate (auto-marks as seen)
            assert!(!adapter.is_duplicate("msg_new").await);
            // Second sighting — duplicate within TTL
            assert!(adapter.is_duplicate("msg_new").await);

            // Different message — not a duplicate
            assert!(!adapter.is_duplicate("msg_other").await);
        });
    }

    #[test]
    fn test_ilink_base_url_constant() {
        assert_eq!(ILINK_BASE_URL, "https://ilinkai.weixin.qq.com");
    }

    #[test]
    fn qr_poll_accepts_only_official_https_hosts() {
        assert_eq!(
            normalize_wechat_base_url("https://redirect.weixin.qq.com/").unwrap(),
            "https://redirect.weixin.qq.com"
        );
        assert!(normalize_wechat_base_url("http://ilinkai.weixin.qq.com").is_err());
        assert!(normalize_wechat_base_url("https://attacker.example").is_err());
        assert!(
            normalize_wechat_base_url("https://ilinkai.weixin.qq.com@attacker.example").is_err()
        );
    }

    #[test]
    fn test_default_long_polling_timeout() {
        assert_eq!(DEFAULT_LONG_POLLING_TIMEOUT, 30);
    }

    #[tokio::test]
    async fn chat_info_returns_the_stable_ilink_identity_contract() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let info = adapter.get_chat_info("chat_123").await.unwrap();
        assert_eq!(info.chat_id, "chat_123");
        assert_eq!(info.name, "WeChat iLink Chat");
        assert_eq!(info.chat_type, "wechat_ilink");
    }

    #[tokio::test]
    async fn unadvertised_optional_actions_fail_closed_with_typed_capabilities() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let failures = [
            adapter.send_image_file("c", "p", None).await,
            adapter.send_voice("c", "p", None).await,
            adapter.send_document("c", "f", None, None).await,
            adapter.send_video("c", "p", None).await,
            adapter.send_animation("c", "u", None).await,
            adapter.edit_message("c", "m", "x").await,
            adapter.delete_message("c", "m").await,
        ];
        let expected = [
            "send_image_file",
            "send_voice",
            "send_document",
            "send_video",
            "send_animation",
            "edit_message",
            "delete_message",
        ];
        for (failure, capability) in failures.into_iter().zip(expected) {
            assert!(
                matches!(failure, Err(PlatformError::NotImplemented(ref actual)) if actual == capability),
                "{capability} must fail with its typed unsupported capability"
            );
        }
        assert!(
            matches!(
                adapter.send_card("c", "{}").await,
                Err(PlatformError::NotImplemented(ref capability)) if capability == "send_card"
            ),
            "send_card must fail with its typed unsupported capability"
        );
    }

    #[tokio::test]
    async fn generic_platform_events_do_not_fabricate_inbound_messages() {
        let config = WeChatLinkConfig::new("bot", "secret");
        let adapter = WeChatLinkAdapter::new(config);

        let event = PlatformEvent {
            event_type: "test".into(),
            platform: Platform::WeChat,
            data: serde_json::json!({}),
            timestamp: Utc::now(),
        };
        let result = adapter.on_event(&event).await.unwrap();
        assert!(result.is_none());
    }
}
