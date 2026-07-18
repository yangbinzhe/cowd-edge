use edge_adapters::managed_server::run_managed_server;
use edge_adapters::source_sidecar::managed_source_factory;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    run_managed_server(managed_source_factory("cowd-edge-bitable-source")).await
}
