#[tokio::main]
async fn main() -> std::io::Result<()> {
    edge_adapters::source_sidecar::run_stdio_source_connector(
        "lark-bitable",
        "lark_bitable",
        "https://open.larksuite.com",
    )
    .await
}
