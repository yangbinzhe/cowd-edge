# Email Message Connector

Builds to `cowd-edge-email-message`. It owns SMTP/IMAP dependencies and keeps those
dependencies out of the core Cowd binary.

Gateway sends JSONL frames to this connector for delivery and receives JSONL event
frames for inbound mail.
