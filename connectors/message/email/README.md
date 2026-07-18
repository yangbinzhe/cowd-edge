# Email Message Connector

Builds to `cowd-edge-email-message`. It owns SMTP/IMAP dependencies and keeps those
dependencies out of the core Cowd binary.

Gateway uses authenticated UDS/H2 streams for delivery and receives sequenced event
frames for inbound mail.
