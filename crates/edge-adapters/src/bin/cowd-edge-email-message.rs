#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::message_sidecar::run_stdio_platform_message_connector(
        "email",
        &[
            "message.ingress",
            "message.egress",
            "message.smtp",
            "message.imap",
            "message.health",
        ],
        edge_adapters::message_sidecar::email_adapter,
    )
    .await
}
