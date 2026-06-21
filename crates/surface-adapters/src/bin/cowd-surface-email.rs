fn main() -> std::io::Result<()> {
    surface_adapters::sidecar::run_stdio_surface(
        "email",
        &["send_text", "send_file", "inbound", "health"],
    )
}
