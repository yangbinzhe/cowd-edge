fn main() -> std::io::Result<()> {
    surface_adapters::sidecar::run_stdio_surface(
        "feishu",
        &[
            "send_text",
            "send_image",
            "send_file",
            "callback",
            "inbound",
            "health",
        ],
    )
}
