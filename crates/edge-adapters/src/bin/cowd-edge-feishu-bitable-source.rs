#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::source_sidecar::run_stdio_source_connector(
        "feishu-bitable",
        "feishu_bitable",
        "https://open.feishu.cn",
    )
    .await
}
