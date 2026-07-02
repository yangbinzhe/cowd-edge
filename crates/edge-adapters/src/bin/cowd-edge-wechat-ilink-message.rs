#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::message_sidecar::run_stdio_platform_message_connector(
        "wechat-ilink",
        &[
            "message.ingress",
            "message.egress",
            "message.callback",
            "message.qr_login",
            "message.health",
        ],
        edge_adapters::message_sidecar::wechat_ilink_adapter,
    )
    .await
}
