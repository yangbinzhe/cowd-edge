fn main() -> std::io::Result<()> {
    surface_adapters::sidecar::run_stdio_surface(
        "wechat-ilink",
        &[
            "send_text",
            "send_image",
            "callback",
            "qr_login",
            "inbound",
            "health",
        ],
    )
}
