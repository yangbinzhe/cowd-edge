use edge_adapters::managed_server::run_managed_server;
use edge_adapters::message_sidecar::{managed_message_factory, wecom_adapter};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    run_managed_server(managed_message_factory("wecom-message", wecom_adapter)).await
}
