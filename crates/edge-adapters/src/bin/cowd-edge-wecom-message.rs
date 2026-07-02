#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::message_sidecar::run_stdio_platform_message_connector(
        "wecom",
        &[
            "message.ingress",
            "message.egress",
            "message.callback",
            "message.crypto",
            "message.health",
        ],
        edge_adapters::message_sidecar::wecom_adapter,
    )
    .await
}
