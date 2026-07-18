use edge_adapters::managed_server::run_managed_server;
use edge_adapters::message_sidecar::{managed_message_factory, wechat_ilink_adapter};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    run_managed_server(managed_message_factory(
        "wechat-ilink-message",
        wechat_ilink_adapter,
    ))
    .await
}
