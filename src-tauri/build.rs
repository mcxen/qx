fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/display_macos.m")
            .flag("-fmodules")
            .flag("-fobjc-arc")
            .compile("qx_display_macos");

        for framework in [
            "ApplicationServices",
            "CoreDisplay",
            "CoreGraphics",
            "DisplayServices",
            "Foundation",
            "IOKit",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-search=framework=/System/Library/PrivateFrameworks");
        println!("cargo:rerun-if-changed=src/display_macos.m");
    }
    tauri_build::build()
}
