#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::feishu_sidecar::run_stdio_feishu_surface().await
}
