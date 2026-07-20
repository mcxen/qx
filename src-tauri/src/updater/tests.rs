use super::*;
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::net::TcpListener;
#[cfg(target_os = "macos")]
use std::thread;

#[test]
fn compares_semver_like_versions() {
    assert!(compare_versions("0.4.49", "0.4.48") > 0);
    assert!(compare_versions("v0.5.0", "0.4.99") > 0);
    assert_eq!(compare_versions("0.4.48", "v0.4.48"), 0);
    assert!(compare_versions("0.4.8", "0.4.48") < 0);
}

#[test]
fn resolves_release_asset_from_latest_manifest() {
    let asset_name = default_asset_name("0.5.3");
    let asset_url = format!("https://github.com/mcxen/qx/releases/download/v0.5.3/{asset_name}");
    let info = update_info_from_manifest(
        "0.4.48",
        QxUpdateManifest {
            version: "0.5.3".to_string(),
            tag: "v0.5.3".to_string(),
            platform: UPDATE_PLATFORM.to_string(),
            target: UPDATE_TARGET.to_string(),
            asset_name: asset_name.clone(),
            asset_url: asset_url.clone(),
            sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".to_string(),
            size: Some(200),
            artifacts: Vec::new(),
        },
    )
    .expect("manifest should resolve");

    assert!(info.available);
    assert_eq!(info.latest_version.as_deref(), Some("0.5.3"));
    assert_eq!(info.asset_name.as_deref(), Some(asset_name.as_str()));
    assert_eq!(info.asset_url.as_deref(), Some(asset_url.as_str()));
    assert_eq!(info.size, Some(200));
}

#[test]
fn constructs_versioned_asset_url_when_manifest_omits_it() {
    let asset_name = default_asset_name("0.5.3");
    let expected_url = format!("https://github.com/mcxen/qx/releases/download/v0.5.3/{asset_name}");
    let info = update_info_from_manifest(
        "0.5.3",
        QxUpdateManifest {
            version: "0.5.3".to_string(),
            tag: String::new(),
            platform: UPDATE_PLATFORM.to_string(),
            target: UPDATE_TARGET.to_string(),
            asset_name: String::new(),
            asset_url: String::new(),
            sha256: String::new(),
            size: None,
            artifacts: Vec::new(),
        },
    )
    .expect("manifest defaults should resolve");

    assert_eq!(info.asset_url.as_deref(), Some(expected_url.as_str()));
}

#[test]
fn selects_current_target_from_multi_platform_manifest() {
    let current_asset = default_asset_name("0.5.4");
    let info = update_info_from_manifest(
        "0.5.3",
        QxUpdateManifest {
            version: "0.5.4".to_string(),
            tag: "v0.5.4".to_string(),
            platform: "macos".to_string(),
            target: "aarch64-apple-darwin".to_string(),
            asset_name: "qx_v0.5.4_aarch64-apple-darwin.app.zip".to_string(),
            asset_url: "https://github.com/mcxen/qx/releases/download/v0.5.4/qx_v0.5.4_aarch64-apple-darwin.app.zip".to_string(),
            sha256:
                "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
                    .to_string(),
            size: Some(200),
            artifacts: vec![
                QxUpdateArtifact {
                    platform: "other".to_string(),
                    target: "other-target".to_string(),
                    asset_name: "Qx_0.5.4_x64-setup.exe".to_string(),
                    asset_url: "https://github.com/mcxen/qx/releases/download/v0.5.4/Qx_0.5.4_x64-setup.exe".to_string(),
                    sha256: "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
                    size: Some(300),
                },
                QxUpdateArtifact {
                    platform: UPDATE_PLATFORM.to_string(),
                    target: UPDATE_TARGET.to_string(),
                    asset_name: current_asset.clone(),
                    asset_url: format!(
                        "https://github.com/mcxen/qx/releases/download/v0.5.4/{current_asset}"
                    ),
                    sha256: "2222222222222222222222222222222222222222222222222222222222222222".to_string(),
                    size: Some(400),
                },
            ],
        },
    )
    .expect("current target artifact should resolve");

    assert_eq!(info.asset_name.as_deref(), Some(current_asset.as_str()));
    assert_eq!(
        info.sha256.as_deref(),
        Some("2222222222222222222222222222222222222222222222222222222222222222")
    );
    assert_eq!(info.size, Some(400));
}

#[test]
fn rejects_non_qx_release_asset_url() {
    let error = validate_release_asset_url(
        "https://example.com/qx.zip",
        "v0.5.3",
        "qx_v0.5.3_aarch64-apple-darwin.app.zip",
    )
    .expect_err("foreign asset URL must be rejected");
    assert!(error.contains("not an allowed Qx release asset"));
}

#[test]
#[cfg(target_os = "macos")]
fn prepares_app_bundle_for_launch() {
    let root = unique_temp_dir("qx-updater-test");
    let app = root.join("Qx.app");
    let executable = write_fake_app_bundle(&app, b"#!/bin/sh\n");

    let _ = Command::new("/usr/bin/xattr")
        .args(["-w", "com.apple.quarantine", "0081;00000000;Qx;"])
        .arg(&app)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    prepare_app_for_launch(&app).expect("prepare app");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&executable)
            .expect("metadata")
            .permissions()
            .mode();
        assert_ne!(mode & 0o111, 0, "main executable should be executable");
    }
    let has_quarantine = Command::new("/usr/bin/xattr")
        .args(["-p", "com.apple.quarantine"])
        .arg(&app)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    assert!(!has_quarantine, "quarantine xattr should be absent");

    let _ = fs::remove_dir_all(root);
}

#[test]
#[cfg(target_os = "macos")]
fn replaces_app_bundle_and_prepares_target_for_launch() {
    let root = unique_temp_dir("qx-updater-replace-test");
    let staged = root.join("staged/Qx.app");
    let target = root.join("Applications/Qx.app");
    let backup = root.join("backup/Qx.app");
    write_fake_app_bundle(&target, b"old");
    let staged_executable = write_fake_app_bundle(&staged, b"new");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staged_executable, fs::Permissions::from_mode(0o644))
            .expect("make staged executable non-executable");
    }
    let _ = Command::new("/usr/bin/xattr")
        .args(["-w", "com.apple.quarantine", "0081;00000000;Qx;"])
        .arg(&staged)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    replace_app_bundle(&staged, &target, &backup).expect("replace app");

    assert!(!staged.exists(), "staged app should be removed");
    assert!(backup.exists(), "previous app should be kept as backup");
    let target_executable = target.join("Contents/MacOS/Qx");
    assert_eq!(fs::read(&target_executable).expect("read target"), b"new");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&target_executable)
            .expect("metadata")
            .permissions()
            .mode();
        assert_ne!(mode & 0o111, 0, "target executable should be executable");
    }
    let has_quarantine = Command::new("/usr/bin/xattr")
        .args(["-p", "com.apple.quarantine"])
        .arg(&target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    assert!(!has_quarantine, "target quarantine xattr should be absent");

    let _ = fs::remove_dir_all(root);
}

#[test]
#[cfg(target_os = "macos")]
fn downloads_verifies_and_stages_app_zip() {
    let root = unique_temp_dir("qx-updater-download-test");
    let source_app = root.join("source/Qx.app");
    write_fake_app_bundle(&source_app, b"downloaded");
    let zip_path = root.join("Qx.app.zip");
    let status = Command::new("/usr/bin/ditto")
        .args(["-c", "-k", "--sequesterRsrc", "--keepParent"])
        .arg(&source_app)
        .arg(&zip_path)
        .status()
        .expect("run ditto zip");
    assert!(status.success(), "ditto should create test zip");
    let zip_bytes = fs::read(&zip_path).expect("read zip");
    let sha256 = hex::encode(Sha256::digest(&zip_bytes));
    let size = zip_bytes.len() as u64;
    let url = serve_once(zip_bytes);

    let staged = download_and_stage_in_dir(root.join("cache/0.0.test"), &url, &sha256, Some(size))
        .expect("download and stage");

    assert!(staged.ends_with("Qx.app"));
    assert_eq!(
        fs::read(staged.join("Contents/MacOS/Qx")).expect("read staged executable"),
        b"downloaded"
    );

    let _ = fs::remove_dir_all(root);
}

#[cfg(target_os = "macos")]
fn write_fake_app_bundle(app: &Path, executable_contents: &[u8]) -> PathBuf {
    let macos_dir = app.join("Contents/MacOS");
    fs::create_dir_all(&macos_dir).expect("create app dirs");
    fs::write(
        app.join("Contents/Info.plist"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Qx</string>
</dict>
</plist>
"#,
    )
    .expect("write Info.plist");
    let executable = macos_dir.join("Qx");
    fs::write(&executable, executable_contents).expect("write executable");
    executable
}

#[cfg(target_os = "macos")]
fn serve_once(body: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let addr = listener.local_addr().expect("local addr");
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0; 1024];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    format!("http://{addr}/Qx.app.zip")
}

#[cfg(target_os = "macos")]
fn unique_temp_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
