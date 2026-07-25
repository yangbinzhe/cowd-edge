//! Email platform adapter.
//!
//! Provides SMTP email sending and IMAP email receiving with attachment handling.

use crate::platform::adapter::{
    InboundMessage, MessageType, OutboundMessage, Platform, PlatformAdapter, PlatformError,
    PlatformResult,
};
use crate::platform::types::{SendResult, SessionKey};
use async_trait::async_trait;
use chrono::Utc;
use lettre::Transport;
use mail_parser::MimeHeaders;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, RwLock};

/// Email adapter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub use_tls: bool,
    pub imap_host: Option<String>,
    pub imap_port: Option<u16>,
    pub imap_username: Option<String>,
    pub imap_password: Option<String>,
    pub from_address: String,
    pub polling_interval_secs: u64,
}

impl Default for EmailConfig {
    fn default() -> Self {
        Self {
            smtp_host: String::new(),
            smtp_port: 587,
            smtp_username: String::new(),
            smtp_password: String::new(),
            use_tls: true,
            imap_host: None,
            imap_port: None,
            imap_username: None,
            imap_password: None,
            from_address: String::new(),
            polling_interval_secs: 60,
        }
    }
}

impl EmailConfig {
    pub fn is_smtp_configured(&self) -> bool {
        !self.smtp_host.trim().is_empty() && !self.from_address.trim().is_empty()
    }

    pub fn is_imap_configured(&self) -> bool {
        self.imap_host
            .as_ref()
            .is_some_and(|host| !host.trim().is_empty())
            && self
                .imap_username
                .as_ref()
                .is_some_and(|username| !username.trim().is_empty())
            && self
                .imap_password
                .as_ref()
                .is_some_and(|password| !password.is_empty())
    }

    pub fn new(
        smtp_host: impl Into<String>,
        smtp_username: impl Into<String>,
        smtp_password: impl Into<String>,
        from_address: impl Into<String>,
    ) -> Self {
        Self {
            smtp_host: smtp_host.into(),
            smtp_port: 587,
            smtp_username: smtp_username.into(),
            smtp_password: smtp_password.into(),
            use_tls: true,
            imap_host: None,
            imap_port: None,
            imap_username: None,
            imap_password: None,
            from_address: from_address.into(),
            polling_interval_secs: 60,
        }
    }

    pub fn with_imap(
        mut self,
        host: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        self.imap_host = Some(host.into());
        self.imap_port = Some(993);
        self.imap_username = Some(username.into());
        self.imap_password = Some(password.into());
        self
    }
}

/// Email platform adapter with real SMTP sending and IMAP receiving.
pub struct EmailAdapter {
    config: EmailConfig,
    connected: Arc<AtomicBool>,
    last_poll: Arc<RwLock<Option<Instant>>>,
    pending_inbox: Arc<Mutex<VecDeque<InboundMessage>>>,
}

impl EmailAdapter {
    pub fn new(config: EmailConfig) -> Self {
        Self {
            config,
            connected: Arc::new(AtomicBool::new(false)),
            last_poll: Arc::new(RwLock::new(None)),
            pending_inbox: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn is_valid_email(email: &str) -> bool {
        email.contains('@') && email.contains('.') && email.len() > 5
    }

    fn validate_config(&self) -> PlatformResult<()> {
        let smtp_started = !self.config.smtp_host.trim().is_empty()
            || !self.config.smtp_username.trim().is_empty()
            || !self.config.smtp_password.is_empty()
            || !self.config.from_address.trim().is_empty();
        let imap_started = self
            .config
            .imap_host
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
            || self
                .config
                .imap_username
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
            || self
                .config
                .imap_password
                .as_ref()
                .is_some_and(|value| !value.is_empty());

        if !smtp_started && !imap_started {
            return Err(PlatformError::ConfigError(
                "email requires a complete SMTP or IMAP configuration".into(),
            ));
        }
        if smtp_started {
            if !self.config.is_smtp_configured() {
                return Err(PlatformError::ConfigError(
                    "SMTP requires smtp_host and from_address".into(),
                ));
            }
            if !Self::is_valid_email(&self.config.from_address) {
                return Err(PlatformError::ConfigError(
                    "from_address is not a valid email address".into(),
                ));
            }
            if self.config.smtp_port == 0 {
                return Err(PlatformError::ConfigError(
                    "smtp_port must be greater than zero".into(),
                ));
            }
            let has_username = !self.config.smtp_username.trim().is_empty();
            let has_password = !self.config.smtp_password.is_empty();
            if has_username != has_password {
                return Err(PlatformError::ConfigError(
                    "smtp_username and smtp_password must be configured together".into(),
                ));
            }
        }
        if imap_started && !self.config.is_imap_configured() {
            return Err(PlatformError::ConfigError(
                "IMAP requires imap_host, imap_username and imap_password".into(),
            ));
        }
        if self.config.imap_port == Some(0) {
            return Err(PlatformError::ConfigError(
                "imap_port must be greater than zero".into(),
            ));
        }
        if self.config.polling_interval_secs == 0 {
            return Err(PlatformError::ConfigError(
                "polling_interval_secs must be greater than zero".into(),
            ));
        }
        Ok(())
    }

    fn smtp_transport(&self) -> PlatformResult<lettre::SmtpTransport> {
        let mut builder = if self.config.use_tls {
            lettre::SmtpTransport::relay(&self.config.smtp_host)
                .map_err(|error| {
                    PlatformError::ConnectionFailed(format!("SMTP relay error: {error}"))
                })?
                .port(self.config.smtp_port)
        } else {
            lettre::SmtpTransport::builder_dangerous(&self.config.smtp_host)
                .port(self.config.smtp_port)
        };
        if !self.config.smtp_username.trim().is_empty() {
            builder =
                builder.credentials(lettre::transport::smtp::authentication::Credentials::new(
                    self.config.smtp_username.clone(),
                    self.config.smtp_password.clone(),
                ));
        }
        Ok(builder.build())
    }

    async fn probe_configured_endpoints(&self) -> PlatformResult<()> {
        if self.config.is_smtp_configured() {
            let transport = self.smtp_transport()?;
            let reachable = tokio::task::spawn_blocking(move || transport.test_connection())
                .await
                .map_err(|error| {
                    PlatformError::ConnectionFailed(format!("SMTP probe task failed: {error}"))
                })?
                .map_err(|error| {
                    PlatformError::ConnectionFailed(format!("SMTP probe failed: {error}"))
                })?;
            if !reachable {
                return Err(PlatformError::ConnectionFailed(
                    "SMTP server rejected the connection probe".into(),
                ));
            }
        }
        if self.config.is_imap_configured() {
            let host = self.config.imap_host.clone().unwrap_or_default();
            let port = self.config.imap_port.unwrap_or(993);
            let username = self.config.imap_username.clone().unwrap_or_default();
            let password = self.config.imap_password.clone().unwrap_or_default();
            tokio::task::spawn_blocking(move || -> PlatformResult<()> {
                let client = imap::ClientBuilder::new(&host, port)
                    .connect()
                    .map_err(|error| {
                        PlatformError::ConnectionFailed(format!("IMAP probe failed: {error}"))
                    })?;
                let mut session = client.login(&username, &password).map_err(|error| {
                    PlatformError::AuthenticationFailed(format!(
                        "IMAP probe login failed: {}",
                        error.0
                    ))
                })?;
                session.select("INBOX").map_err(|error| {
                    PlatformError::ConnectionFailed(format!(
                        "IMAP probe could not select INBOX: {error}"
                    ))
                })?;
                session.logout().map_err(|error| {
                    PlatformError::ConnectionFailed(format!("IMAP probe logout failed: {error}"))
                })?;
                Ok(())
            })
            .await
            .map_err(|error| {
                PlatformError::ConnectionFailed(format!("IMAP probe task failed: {error}"))
            })??;
        }
        Ok(())
    }

    /// Send an email via SMTP.
    async fn send_email(&self, msg: &OutboundMessage) -> PlatformResult<()> {
        if !self.config.is_smtp_configured() {
            return Err(PlatformError::ConfigError(
                "SMTP is not configured for outbound email".into(),
            ));
        }

        let to_address = &msg.session_key.user_id;
        let subject = msg
            .metadata
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or("Message from AI");

        let from = self
            .config
            .from_address
            .parse::<lettre::message::Mailbox>()
            .map_err(|e| PlatformError::SendFailed(format!("invalid from address: {}", e)))?;
        let to = to_address
            .parse::<lettre::message::Mailbox>()
            .map_err(|e| PlatformError::SendFailed(format!("invalid to address: {}", e)))?;

        let email = lettre::Message::builder()
            .from(from)
            .to(to)
            .subject(subject)
            .multipart(
                lettre::message::MultiPart::alternative().singlepart(
                    lettre::message::SinglePart::builder()
                        .header(lettre::message::header::ContentType::TEXT_PLAIN)
                        .body(msg.text.clone()),
                ),
            )
            .map_err(|e| PlatformError::SendFailed(format!("failed to build email: {}", e)))?;

        let mailer = self.smtp_transport()?;

        // lettre send is blocking, so we run it in a spawn_blocking context
        let result: Result<
            lettre::transport::smtp::response::Response,
            lettre::transport::smtp::Error,
        > = tokio::task::spawn_blocking(move || mailer.send(&email))
            .await
            .map_err(|e| PlatformError::SendFailed(format!("send task error: {}", e)))?;

        match result {
            Ok(_) => {
                tracing::info!(to = %to_address, "email sent successfully via SMTP");
                Ok(())
            }
            Err(e) => Err(PlatformError::SendFailed(format!(
                "SMTP send failed: {}",
                e
            ))),
        }
    }

    /// Receive unread emails via IMAP.
    async fn receive_emails(&self) -> PlatformResult<Vec<InboundMessage>> {
        if !self.config.is_imap_configured() {
            return Ok(Vec::new());
        }

        let imap_host = self
            .config
            .imap_host
            .clone()
            .ok_or_else(|| PlatformError::ConfigError("missing imap_host".into()))?;
        let imap_port = self.config.imap_port.unwrap_or(993);
        let imap_user = self
            .config
            .imap_username
            .clone()
            .ok_or_else(|| PlatformError::ConfigError("missing imap_username".into()))?;
        let imap_pass = self
            .config
            .imap_password
            .clone()
            .ok_or_else(|| PlatformError::ConfigError("missing imap_password".into()))?;

        // IMAP is blocking, run in spawn_blocking
        let result = tokio::task::spawn_blocking(move || -> PlatformResult<Vec<InboundMessage>> {
            let client = imap::ClientBuilder::new(&imap_host, imap_port)
                .connect()
                .map_err(|e| PlatformError::ReceiveFailed(format!("IMAP connect error: {}", e)))?;

            let mut session = client.login(&imap_user, &imap_pass).map_err(|e| {
                PlatformError::AuthenticationFailed(format!("IMAP login error: {}", e.0))
            })?;

            session.select("INBOX").map_err(|e| {
                PlatformError::ReceiveFailed(format!("IMAP select INBOX error: {}", e))
            })?;

            // Search for unseen messages
            let uids = session
                .uid_search("UNSEEN")
                .map_err(|e| PlatformError::ReceiveFailed(format!("IMAP search error: {}", e)))?;

            let mut messages = Vec::new();

            for uid in uids.iter().take(50) {
                // Limit to 50 messages per poll
                let msg_data = session.uid_fetch(&uid.to_string(), "RFC822").map_err(|e| {
                    PlatformError::ReceiveFailed(format!("IMAP fetch error: {}", e))
                })?;

                if let Some(msg) = msg_data.iter().next() {
                    if let Some(body) = msg.body() {
                        if let Some(parsed) = mail_parser::MessageParser::default().parse(body) {
                            let subject = parsed.subject().unwrap_or("(No Subject)");
                            let from = parsed
                                .from()
                                .and_then(|addr| addr.first())
                                .and_then(|a| a.address.as_deref().or(a.name.as_deref()))
                                .unwrap_or("unknown")
                                .to_string();
                            let text = parsed
                                .body_text(0)
                                .map(|t| t.to_string())
                                .unwrap_or_default();

                            let attachment_count = parsed.attachment_count();
                            let (media_urls, media_types, attachment_names) =
                                cache_email_attachments(&parsed, &uid.to_string());

                            let sender = from.clone();
                            let session_key = SessionKey::new(Platform::Email.name(), &sender);

                            messages.push(InboundMessage {
                                platform: Platform::Email,
                                session_key,
                                text: format!("Subject: {}\n\n{}", subject, text),
                                sender_name: Some(from),
                                timestamp: Utc::now(),
                                metadata: serde_json::json!({
                                    "subject": subject,
                                    "uid": uid,
                                    "attachments": attachment_count,
                                    "attachment_names": attachment_names,
                                }),
                                message_type: MessageType::Text,
                                message_id: Some(format!("imap:{uid}")),
                                reply_to_message_id: None,
                                media_urls,
                                media_types,
                            });
                            session
                                .uid_store(uid.to_string(), "+FLAGS (\\Seen)")
                                .map_err(|error| {
                                    PlatformError::ReceiveFailed(format!(
                                        "IMAP mark-seen failed for UID {uid}: {error}"
                                    ))
                                })?;
                        }
                    }
                }
            }

            session.logout().ok();
            Ok(messages)
        })
        .await
        .map_err(|e| PlatformError::ReceiveFailed(format!("IMAP task error: {}", e)))?;

        result
    }

    /// Check if enough time has elapsed since the last poll.
    async fn should_poll(&self) -> bool {
        let last = self.last_poll.read().await;
        match *last {
            Some(instant) => {
                let elapsed = instant.elapsed().as_secs();
                elapsed >= self.config.polling_interval_secs
            }
            None => true,
        }
    }

    /// Update the last poll timestamp.
    async fn update_poll_time(&self) {
        *self.last_poll.write().await = Some(Instant::now());
    }
}

fn cache_email_attachments(
    message: &mail_parser::Message<'_>,
    uid: &str,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let root = crate::cowd_dirs::config_home_dir()
        .join("storage")
        .join("resources")
        .join("message")
        .join("email")
        .join(safe_attachment_segment(uid));
    if fs::create_dir_all(&root).is_err() {
        return (Vec::new(), Vec::new(), Vec::new());
    }

    let mut paths = Vec::new();
    let mut mimes = Vec::new();
    let mut names = Vec::new();
    for (index, attachment) in message.attachments().enumerate() {
        if attachment.is_message() {
            continue;
        }
        let name = attachment
            .attachment_name()
            .map(safe_attachment_name)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("attachment-{index}.bin"));
        let path = unique_attachment_path(&root, &name, index);
        if fs::write(&path, attachment.contents()).is_ok() {
            let mime = attachment
                .content_type()
                .map(|content_type| {
                    let subtype = content_type
                        .c_subtype
                        .as_ref()
                        .map(|value| value.as_ref())
                        .unwrap_or("octet-stream");
                    format!("{}/{}", content_type.c_type, subtype)
                })
                .unwrap_or_else(|| "application/octet-stream".to_string());
            paths.push(path.to_string_lossy().to_string());
            mimes.push(mime);
            names.push(name);
        }
    }
    (paths, mimes, names)
}

fn unique_attachment_path(root: &Path, name: &str, index: usize) -> std::path::PathBuf {
    let candidate = root.join(name);
    if !candidate.exists() {
        return candidate;
    }
    root.join(format!("{index}-{name}"))
}

fn safe_attachment_name(name: &str) -> String {
    safe_attachment_segment(
        Path::new(name)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment.bin"),
    )
}

fn safe_attachment_segment(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let cleaned = cleaned.trim_matches('.').trim_matches('_');
    if cleaned.is_empty() {
        "attachment".to_string()
    } else {
        cleaned.to_string()
    }
}

pub fn create_email_adapter(settings: &serde_json::Value) -> PlatformResult<EmailAdapter> {
    let config = serde_json::from_value(settings.clone())
        .map_err(|e| PlatformError::ConfigError(format!("invalid email config: {}", e)))?;
    Ok(EmailAdapter::new(config))
}

#[async_trait]
impl PlatformAdapter for EmailAdapter {
    fn platform(&self) -> Platform {
        Platform::Email
    }
    fn platform_name(&self) -> &str {
        "email"
    }

    async fn connect(&self) -> PlatformResult<()> {
        self.validate_config()?;
        self.probe_configured_endpoints().await?;
        if self.config.is_smtp_configured() {
            tracing::info!(host = %self.config.smtp_host, port = self.config.smtp_port, "email adapter: SMTP configured");
        }
        if self.config.is_imap_configured() {
            tracing::info!(
                host = %self.config.imap_host.as_deref().unwrap_or_default(),
                "email adapter: IMAP configured, polling every {}s",
                self.config.polling_interval_secs
            );
        }
        self.connected.store(true, Ordering::Relaxed);
        Ok(())
    }

    async fn disconnect(&self) -> PlatformResult<()> {
        self.connected.store(false, Ordering::Relaxed);
        self.pending_inbox.lock().await.clear();
        *self.last_poll.write().await = None;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    async fn receive(&self) -> PlatformResult<Option<InboundMessage>> {
        if !self.connected.load(Ordering::Relaxed) {
            return Ok(None);
        }
        if let Some(message) = self.pending_inbox.lock().await.pop_front() {
            return Ok(Some(message));
        }

        if !self.should_poll().await {
            return Ok(None);
        }

        let messages = self.receive_emails().await?;
        self.update_poll_time().await;
        let mut pending = self.pending_inbox.lock().await;
        pending.extend(messages);
        Ok(pending.pop_front())
    }

    async fn send(&self, msg: &OutboundMessage) -> PlatformResult<SendResult> {
        self.send_email(msg).await?;
        Ok(SendResult::success(None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_config() {
        let config = EmailConfig::new("smtp.example.com", "user", "pass", "from@example.com");
        assert_eq!(config.smtp_host, "smtp.example.com");
        assert!(config.is_smtp_configured());
    }

    #[test]
    fn test_email_config_with_imap() {
        let config = EmailConfig::new("smtp.example.com", "user", "pass", "from@example.com")
            .with_imap("imap.example.com", "user", "pass");
        assert!(config.is_imap_configured());
        assert_eq!(config.imap_port, Some(993));
    }

    #[test]
    fn test_email_validation() {
        assert!(EmailAdapter::is_valid_email("user@example.com"));
        assert!(!EmailAdapter::is_valid_email("invalid"));
        assert!(!EmailAdapter::is_valid_email("a@b"));
    }

    #[tokio::test]
    async fn test_email_polling_throttle() {
        let config = EmailConfig::new("smtp.example.com", "user", "pass", "from@example.com");
        let adapter = EmailAdapter::new(config);

        // First poll should be allowed
        assert!(adapter.should_poll().await);

        // Update poll time, then second poll should be throttled (interval is 60s)
        adapter.update_poll_time().await;
        assert!(!adapter.should_poll().await);
    }

    #[tokio::test]
    async fn pending_inbox_drains_every_polled_message_without_dropping_the_tail() {
        let adapter = EmailAdapter::new(EmailConfig::default());
        adapter.connected.store(true, Ordering::Relaxed);
        let messages = ["first", "second", "third"]
            .into_iter()
            .enumerate()
            .map(|(index, text)| InboundMessage {
                platform: Platform::Email,
                session_key: SessionKey::new("email", "sender@example.com"),
                text: text.to_string(),
                sender_name: None,
                timestamp: Utc::now(),
                metadata: serde_json::Value::Null,
                message_type: MessageType::Text,
                message_id: Some(format!("imap:{index}")),
                reply_to_message_id: None,
                media_urls: Vec::new(),
                media_types: Vec::new(),
            });
        adapter.pending_inbox.lock().await.extend(messages);

        assert_eq!(adapter.receive().await.unwrap().unwrap().text, "first");
        assert_eq!(adapter.receive().await.unwrap().unwrap().text, "second");
        assert_eq!(adapter.receive().await.unwrap().unwrap().text, "third");
        assert!(adapter.pending_inbox.lock().await.is_empty());
    }

    #[test]
    fn partial_email_configuration_is_rejected() {
        let config = EmailConfig {
            smtp_host: "smtp.example.com".into(),
            ..EmailConfig::default()
        };
        let adapter = EmailAdapter::new(config);
        assert!(matches!(
            adapter.validate_config(),
            Err(PlatformError::ConfigError(_))
        ));
    }
}
