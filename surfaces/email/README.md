# Email Surface

Builds to `cowd-surface-email`. It owns SMTP/IMAP dependencies and keeps those
dependencies out of the core Cowd binary.

Gateway sends JSONL frames to this surface for delivery and receives JSONL event
frames for inbound mail.
