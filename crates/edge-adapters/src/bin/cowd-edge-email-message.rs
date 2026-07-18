use edge_adapters::managed_server::run_managed_server;
use edge_adapters::message_sidecar::{email_adapter, managed_message_factory};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    run_managed_server(managed_message_factory("email-message", email_adapter)).await
}
