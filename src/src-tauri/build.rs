fn main() {
    let target = std::env::var("TARGET").expect("missing Rust target");
    let suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    println!("cargo:rustc-env=DEDSIWORK_SIDECAR_TARGET={target}{suffix}");
    tauri_build::build()
}
