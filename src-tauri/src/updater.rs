use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[path = "updater/support.rs"]
mod support;
#[cfg(target_os = "windows")]
#[path = "updater/windows.rs"]
mod windows;

use support::{compare_versions, current_binary_name, prune_update_cache, update_cache_dir};

const GITHUB_LATEST_MANIFEST: &str =
    "https://github.com/mcxen/qx/releases/latest/download/latest.json";
const GITHUB_RELEASE_DOWNLOAD_BASE: &str = "https://github.com/mcxen/qx/releases/download";
const GITHUB_RELEASE_TAG_BASE: &str = "https://github.com/mcxen/qx/releases/tag";
const MIRROR_LATEST_MANIFEST: Option<&str> = option_env!("QX_UPDATE_MIRROR_MANIFEST_URL");
#[cfg(target_os = "macos")]
const UPDATE_PLATFORM: &str = "macos";
#[cfg(target_os = "macos")]
const UPDATE_TARGET: &str = "aarch64-apple-darwin";
#[cfg(target_os = "windows")]
const UPDATE_PLATFORM: &str = "windows";
#[cfg(target_os = "windows")]
const UPDATE_TARGET: &str = "x86_64-pc-windows-msvc";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const UPDATE_PLATFORM: &str = "unsupported";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const UPDATE_TARGET: &str = "unsupported";
const HELPER_FLAG: &str = "--qx-update-helper";
const STATUS_FILE: &str = "last-update-status.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QxUpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    pub notes: Option<String>,
    pub can_install: bool,
    pub install_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QxUpdateInstallResult {
    pub version: String,
    pub staged_app: String,
    pub target_app: String,
    pub helper_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QxUpdateManifest {
    version: String,
    #[serde(default)]
    tag: String,
    #[serde(default)]
    platform: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    asset_name: String,
    #[serde(default)]
    asset_url: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    artifacts: Vec<QxUpdateArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QxUpdateArtifact {
    platform: String,
    target: String,
    asset_name: String,
    #[serde(default)]
    asset_url: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct HelperStatus {
    ok: bool,
    version: Option<String>,
    message: String,
    target_app: String,
}

#[tauri::command]
pub async fn qx_update_check(app: AppHandle) -> Result<QxUpdateInfo, String> {
    let current = app.package_info().version.to_string();
    tokio::task::spawn_blocking(move || check_for_update(&current))
        .await
        .map_err(|e| format!("update check task failed: {e}"))?
}

#[tauri::command]
pub async fn qx_update_download_and_install(
    app: AppHandle,
) -> Result<QxUpdateInstallResult, String> {
    let current = app.package_info().version.to_string();
    let result = tokio::task::spawn_blocking(move || {
        let update = check_for_update(&current)?;
        if !update.available {
            return Err("Qx is already on the latest version.".to_string());
        }
        if !update.can_install {
            return Err(update
                .install_reason
                .unwrap_or_else(|| "This update is not installable automatically.".to_string()));
        }

        let asset_url = update
            .asset_url
            .clone()
            .ok_or_else(|| "update asset URL missing".to_string())?;
        let expected_sha = update
            .sha256
            .clone()
            .ok_or_else(|| "update SHA256 missing".to_string())?;
        let latest_version = update
            .latest_version
            .clone()
            .ok_or_else(|| "latest version missing".to_string())?;

        let plan = prepare_install(&latest_version, &asset_url, &expected_sha, update.size)?;

        Ok(QxUpdateInstallResult {
            version: latest_version,
            staged_app: plan.payload.display().to_string(),
            target_app: plan.target.display().to_string(),
            helper_path: plan.helper.display().to_string(),
            message: plan.message,
        })
    })
    .await
    .map_err(|e| format!("update install task failed: {e}"))??;

    // Helper is already spawned and waiting on this PID. Must force-quit so
    // macOS double-⌘Q confirmation does not intercept ExitRequested and leave
    // the process alive (helper would then time out after ~90s).
    let app_for_exit = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(350));
        crate::app_quit::force_quit(&app_for_exit);
    });

    Ok(result)
}

pub(crate) fn maybe_run_update_helper_from_args() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some(HELPER_FLAG) {
        // Normal launches: prune off the UI thread so disk I/O never delays
        // tray / shortcuts / first webview paint.
        let _ = std::thread::Builder::new()
            .name("qx-update-prune".to_string())
            .spawn(|| prune_update_cache(None));
        return false;
    }
    let result = run_update_helper(&args);
    if let Err(err) = result {
        eprintln!("Qx update helper failed: {err}");
        let target = arg_value(&args, "--target-app").unwrap_or_default();
        let _ = write_helper_status(HelperStatus {
            ok: false,
            version: arg_value(&args, "--version"),
            message: err,
            target_app: target,
        });
        // Keep the failed version dir for diagnosis; still drop other orphans.
        prune_update_cache(arg_value(&args, "--version").as_deref());
    }
    true
}

fn check_for_update(current_version: &str) -> Result<QxUpdateInfo, String> {
    if let Some(mirror_url) = configured_mirror_manifest_url() {
        match check_for_update_via_manifest(current_version, mirror_url) {
            Ok(info) => return Ok(info),
            Err(mirror_error) => {
                return check_for_update_via_manifest(current_version, GITHUB_LATEST_MANIFEST)
                    .map_err(|github_error| {
                        format!(
                            "update checks failed via mirror ({mirror_error}) and GitHub ({github_error})"
                        )
                    });
            }
        }
    }
    check_for_update_via_manifest(current_version, GITHUB_LATEST_MANIFEST)
}

fn configured_mirror_manifest_url() -> Option<&'static str> {
    MIRROR_LATEST_MANIFEST
        .map(str::trim)
        .filter(|url| !url.is_empty())
}

fn check_for_update_via_manifest(
    current_version: &str,
    manifest_url: &str,
) -> Result<QxUpdateInfo, String> {
    validate_manifest_url(manifest_url)?;
    let manifest: QxUpdateManifest = http_client()?
        .get(manifest_url)
        .send()
        .map_err(|e| format!("fetch latest update manifest: {e}"))?
        .error_for_status()
        .map_err(|e| format!("fetch latest update manifest: {e}"))?
        .json()
        .map_err(|e| format!("parse latest update manifest: {e}"))?;

    update_info_from_manifest_source(current_version, manifest, manifest_url)
}

#[cfg(test)]
fn update_info_from_manifest(
    current_version: &str,
    manifest: QxUpdateManifest,
) -> Result<QxUpdateInfo, String> {
    update_info_from_manifest_source(current_version, manifest, GITHUB_LATEST_MANIFEST)
}

fn update_info_from_manifest_source(
    current_version: &str,
    manifest: QxUpdateManifest,
    manifest_url: &str,
) -> Result<QxUpdateInfo, String> {
    let latest_version = manifest.version.trim().trim_start_matches('v').to_string();
    if latest_version.is_empty() {
        return Err("latest update manifest has no version".to_string());
    }
    let tag = if manifest.tag.trim().is_empty() {
        format!("v{latest_version}")
    } else {
        manifest.tag.trim().to_string()
    };
    if tag.trim_start_matches('v') != latest_version {
        return Err(format!(
            "latest update manifest tag {tag} does not match version {latest_version}"
        ));
    }

    let selected = manifest
        .artifacts
        .iter()
        .find(|artifact| {
            artifact.platform.trim() == UPDATE_PLATFORM && artifact.target.trim() == UPDATE_TARGET
        })
        .cloned()
        .or_else(|| {
            let target_matches =
                manifest.target.trim().is_empty() || manifest.target.trim() == UPDATE_TARGET;
            let platform_matches =
                manifest.platform.trim().is_empty() || manifest.platform.trim() == UPDATE_PLATFORM;
            (target_matches && platform_matches).then(|| QxUpdateArtifact {
                platform: manifest.platform.clone(),
                target: manifest.target.clone(),
                asset_name: manifest.asset_name.clone(),
                asset_url: manifest.asset_url.clone(),
                sha256: manifest.sha256.clone(),
                size: manifest.size,
            })
        });
    let (asset_name, asset_url, sha256, size) = if let Some(artifact) = selected {
        let asset_name = if artifact.asset_name.trim().is_empty() {
            default_asset_name(&latest_version)
        } else {
            artifact.asset_name.trim().to_string()
        };
        let asset_url = if artifact.asset_url.trim().is_empty() {
            default_asset_url(manifest_url, &tag, &asset_name)?
        } else {
            artifact.asset_url.trim().to_string()
        };
        validate_release_asset_url_from_manifest(&asset_url, &tag, &asset_name, manifest_url)?;
        (
            Some(asset_name),
            Some(asset_url),
            Some(normalize_sha256(&artifact.sha256)).filter(|value| !value.trim().is_empty()),
            artifact.size,
        )
    } else {
        (None, None, None, None)
    };

    Ok(build_update_info(
        current_version,
        latest_version,
        Some(format!("{GITHUB_RELEASE_TAG_BASE}/{tag}")),
        asset_name,
        asset_url,
        sha256,
        size,
        None,
    ))
}

fn default_asset_name(version: &str) -> String {
    #[cfg(target_os = "macos")]
    return format!("qx_v{version}_{UPDATE_TARGET}.app.zip");
    #[cfg(target_os = "windows")]
    return format!("Qx_{version}_x64-setup.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    String::new()
}

#[cfg(test)]
fn validate_release_asset_url(url: &str, tag: &str, asset_name: &str) -> Result<(), String> {
    validate_release_asset_url_from_manifest(url, tag, asset_name, GITHUB_LATEST_MANIFEST)
}

fn validate_manifest_url(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|e| format!("invalid update manifest URL: {e}"))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || (url != GITHUB_LATEST_MANIFEST && !parsed.path().ends_with("/latest.json"))
    {
        return Err(format!("update manifest URL is not allowed: {url}"));
    }
    Ok(())
}

fn default_asset_url(manifest_url: &str, tag: &str, asset_name: &str) -> Result<String, String> {
    if manifest_url == GITHUB_LATEST_MANIFEST {
        return Ok(format!("{GITHUB_RELEASE_DOWNLOAD_BASE}/{tag}/{asset_name}"));
    }
    let manifest = reqwest::Url::parse(manifest_url)
        .map_err(|e| format!("invalid update manifest URL: {e}"))?;
    let expected_path = mirror_asset_path(manifest.path(), asset_name)?;
    let mut asset = manifest;
    asset.set_path(&expected_path);
    Ok(asset.to_string())
}

fn mirror_asset_path(manifest_path: &str, asset_name: &str) -> Result<String, String> {
    if !manifest_path.ends_with("/latest.json") {
        return Err("mirror update manifest URL must end in /latest.json".to_string());
    }
    let root = manifest_path.trim_end_matches("/latest.json");
    Ok(format!("{root}/releases/{asset_name}"))
}

fn validate_release_asset_url_from_manifest(
    url: &str,
    tag: &str,
    asset_name: &str,
    manifest_url: &str,
) -> Result<(), String> {
    if tag.contains(['/', '\\']) || asset_name.contains(['/', '\\']) {
        return Err("update manifest contains an invalid tag or asset name".to_string());
    }
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid update asset URL: {e}"))?;
    let manifest = reqwest::Url::parse(manifest_url)
        .map_err(|e| format!("invalid update manifest URL: {e}"))?;
    let expected_path = if manifest_url == GITHUB_LATEST_MANIFEST {
        format!("/mcxen/qx/releases/download/{tag}/{asset_name}")
    } else {
        mirror_asset_path(manifest.path(), asset_name)?
    };
    if parsed.scheme() != "https"
        || parsed.scheme() != manifest.scheme()
        || parsed.host_str() != manifest.host_str()
        || parsed.port_or_known_default() != manifest.port_or_known_default()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != expected_path
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(format!(
            "update asset URL is not an allowed Qx release asset: {url}"
        ));
    }
    Ok(())
}

fn build_update_info(
    current_version: &str,
    latest_version: String,
    release_url: Option<String>,
    asset_name: Option<String>,
    asset_url: Option<String>,
    sha256: Option<String>,
    size: Option<u64>,
    notes: Option<String>,
) -> QxUpdateInfo {
    let available = compare_versions(&latest_version, current_version) > 0;
    let (can_install, install_reason) =
        install_state(available, asset_url.as_ref(), sha256.as_ref());
    QxUpdateInfo {
        available,
        current_version: current_version.to_string(),
        latest_version: Some(latest_version),
        release_url,
        asset_name,
        asset_url,
        sha256,
        size,
        notes,
        can_install,
        install_reason,
    }
}

fn install_state(
    available: bool,
    asset_url: Option<&String>,
    sha256: Option<&String>,
) -> (bool, Option<String>) {
    if !available {
        (false, Some("No newer release is available.".to_string()))
    } else if cfg!(not(any(target_os = "macos", target_os = "windows"))) {
        (
            false,
            Some("Automatic updates are not supported on this platform.".to_string()),
        )
    } else if asset_url.is_none() {
        (
            false,
            Some(format!(
                "No {UPDATE_PLATFORM} update asset was found on the latest release."
            )),
        )
    } else if sha256.map(String::as_str).unwrap_or_default().len() != 64 {
        (
            false,
            Some(
                "Latest release has no SHA256 manifest; open GitHub Releases to install manually."
                    .to_string(),
            ),
        )
    } else if install_location().is_err() {
        (false, Some(install_location_error()))
    } else {
        (true, None)
    }
}

fn normalize_sha256(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("sha256:")
        .to_ascii_lowercase()
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    let user_agent = format!("Qx/{}", env!("CARGO_PKG_VERSION"));
    crate::http_client::blocking_client(
        &user_agent,
        Duration::from_secs(60),
        Some(Duration::from_secs(15)),
    )
    .map_err(|e| format!("build update HTTP client: {e}"))
}

struct InstallPlan {
    payload: PathBuf,
    target: PathBuf,
    helper: PathBuf,
    message: String,
}

#[cfg(target_os = "macos")]
fn prepare_install(
    version: &str,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<InstallPlan, String> {
    let target = current_app_bundle()?;
    let payload = download_and_stage(version, asset_url, expected_sha256, expected_size)?;
    validate_staged_app(&payload, &target, version)?;
    let helper = spawn_update_helper(&payload, &target, version)?;
    Ok(InstallPlan {
        payload,
        target,
        helper,
        message: "Update staged. Qx will quit, replace the app bundle, and relaunch.".to_string(),
    })
}

#[cfg(target_os = "windows")]
fn prepare_install(
    version: &str,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<InstallPlan, String> {
    windows::prepare_install(version, asset_url, expected_sha256, expected_size)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn prepare_install(
    _version: &str,
    _asset_url: &str,
    _expected_sha256: &str,
    _expected_size: Option<u64>,
) -> Result<InstallPlan, String> {
    Err("Automatic updates are not supported on this platform.".to_string())
}

fn download_and_stage(
    version: &str,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<PathBuf, String> {
    // Drop previous versions / helper binaries before downloading a new one.
    prune_update_cache(Some(version));
    let update_dir = update_cache_dir().join(version);
    // Fresh download: wipe this version dir too so we never reuse a partial zip.
    let _ = fs::remove_dir_all(&update_dir);
    download_and_stage_in_dir(update_dir, asset_url, expected_sha256, expected_size)
}

fn download_and_stage_in_dir(
    update_dir: PathBuf,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<PathBuf, String> {
    let download_path = update_dir.join("Qx.app.zip");
    let staging_root = update_dir.join("staging");
    let _ = fs::remove_dir_all(&staging_root);
    fs::create_dir_all(&update_dir).map_err(|e| format!("create update dir: {e}"))?;

    download_verified_file(asset_url, &download_path, expected_sha256, expected_size)?;

    unzip_app(&download_path, &staging_root)?;
    let staged_app = staging_root.join("Qx.app");
    if !staged_app.exists() {
        return Err("update archive did not contain Qx.app".to_string());
    }
    // GitHub zip always arrives quarantined; clear + ad-hoc re-sign free of charge
    // so the helper can open the staged bundle after swap.
    prepare_app_for_launch(&staged_app)?;
    Ok(staged_app)
}

fn download_verified_file(
    asset_url: &str,
    download_path: &Path,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<(), String> {
    let mut response = http_client()?
        .get(asset_url)
        .send()
        .map_err(|e| format!("download update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download update: {e}"))?;
    let mut file = fs::File::create(download_path)
        .map_err(|e| format!("create {}: {e}", download_path.display()))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("read update download: {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("write update download: {e}"))?;
        hasher.update(&buffer[..read]);
        downloaded += read as u64;
    }
    file.sync_all()
        .map_err(|e| format!("sync update download: {e}"))?;

    if let Some(size) = expected_size {
        if downloaded != size {
            return Err(format!(
                "downloaded size mismatch: expected {size}, got {downloaded}"
            ));
        }
    }

    let actual_sha = hex::encode(hasher.finalize());
    if actual_sha != normalize_sha256(expected_sha256) {
        return Err(format!(
            "downloaded SHA256 mismatch: expected {}, got {}",
            normalize_sha256(expected_sha256),
            actual_sha
        ));
    }

    Ok(())
}

fn unzip_app(zip_path: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create staging dir: {e}"))?;
    let output = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(zip_path)
        .arg(dest)
        .output()
        .map_err(|e| format!("run ditto to extract update archive: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!(
            "ditto failed to extract update archive with status {}",
            output.status
        )
    } else {
        format!("ditto failed to extract update archive: {stderr}")
    })
}

fn validate_staged_app(staged_app: &Path, target_app: &Path, version: &str) -> Result<(), String> {
    if staged_app.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("staged update is not a .app bundle".to_string());
    }
    let info_plist = staged_app.join("Contents/Info.plist");
    if !info_plist.exists() {
        return Err("staged app is missing Contents/Info.plist".to_string());
    }
    let target_binary = current_binary_name()?;
    if !staged_app
        .join("Contents/MacOS")
        .join(&target_binary)
        .exists()
    {
        return Err(format!(
            "staged app is missing Contents/MacOS/{target_binary}"
        ));
    }
    if let Ok(bundle_id) = plist_value(&info_plist, "CFBundleIdentifier") {
        if bundle_id.trim() != "com.mcx.qx" {
            return Err(format!("staged app has unexpected bundle id {bundle_id}"));
        }
    }
    if let Ok(staged_version) = plist_value(&info_plist, "CFBundleShortVersionString") {
        if compare_versions(&staged_version, version) != 0 {
            return Err(format!(
                "staged app version mismatch: expected {version}, got {staged_version}"
            ));
        }
    }
    if target_app.file_name().and_then(|value| value.to_str()) != Some("Qx.app") {
        return Err("target app must be named Qx.app".to_string());
    }
    Ok(())
}

fn plist_value(info_plist: &Path, key: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(info_plist)
        .output()
        .map_err(|e| format!("run plutil: {e}"))?;
    if !output.status.success() {
        return Err(format!("plutil failed for {key}"));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|e| format!("parse plutil output: {e}"))
}

fn spawn_update_helper(
    staged_app: &Path,
    target_app: &Path,
    version: &str,
) -> Result<PathBuf, String> {
    // Prepare the staged replacement app before the main process exits so the
    // helper only renames/ditto and does not fight Gatekeeper mid-flight.
    prepare_app_for_launch(staged_app)?;

    let helper_path = update_cache_dir().join(format!("qx-update-helper-{}", std::process::id()));
    // Prefer the *staged* binary as the helper so this install already carries
    // force-quit / SIGTERM wait logic. Copying the currently running (older)
    // binary cannot fix double-⌘Q exit interception when upgrading from that build.
    let current_exe = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    let staged_exe = {
        let name = current_binary_name().unwrap_or_else(|_| "Qx".to_string());
        staged_app.join("Contents/MacOS").join(name)
    };
    let helper_source = if staged_exe.is_file() {
        staged_exe
    } else {
        current_exe
    };
    // Remove a previous copy so codesign never sees a broken half-file.
    let _ = fs::remove_file(&helper_path);
    fs::copy(&helper_source, &helper_path).map_err(|e| {
        format!(
            "copy update helper from {} to {}: {e}",
            helper_source.display(),
            helper_path.display()
        )
    })?;
    // Copying the binary out of Qx.app drops its seal and may inherit
    // com.apple.quarantine — Gatekeeper then kills the helper ("process was
    // intercepted"). Free ad-hoc re-sign + strip quarantine; no Apple paid cert.
    prepare_detached_helper(&helper_path)?;

    let backup_app = update_cache_dir().join(format!("backup-Qx-{version}.app"));
    let mut child = Command::new(&helper_path)
        .arg(HELPER_FLAG)
        .arg("--pid")
        .arg(std::process::id().to_string())
        .arg("--version")
        .arg(version)
        .arg("--staged-app")
        .arg(staged_app)
        .arg("--target-app")
        .arg(target_app)
        .arg("--backup-app")
        .arg(&backup_app)
        .arg("--restart")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "spawn update helper {} failed (often Gatekeeper): {e}. \
                 Try: xattr -cr ~/.qx/cache/updates && codesign --force --sign - {}",
                helper_path.display(),
                helper_path.display()
            )
        })?;

    // If Gatekeeper aborts immediately, surface a clear error instead of a silent no-op.
    std::thread::sleep(Duration::from_millis(120));
    match child.try_wait() {
        Ok(Some(status)) => {
            let mut err = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut err);
            }
            return Err(format!(
                "update helper exited immediately with {status}{}",
                if err.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", err.trim())
                }
            ));
        }
        Ok(None) => {}
        Err(e) => return Err(format!("poll update helper: {e}")),
    }

    Ok(helper_path)
}

/// Make a detached copy of the Qx binary launchable without a paid Apple cert.
///
/// - Strip quarantine / download xattrs (inherited from zip or the parent app)
/// - Ensure +x
/// - Ad-hoc codesign (`codesign -s -`) so the kernel accepts the new inode
fn prepare_detached_helper(path: &Path) -> Result<(), String> {
    clear_quarantine_xattr(path)?;
    // Broader xattr wipe: some macOS builds flag com.apple.macl / provenance.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-cr"])
        .arg(path)
        .status();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("set helper executable bit on {}: {e}", path.display()))?;
    }
    adhoc_codesign(path, false)?;
    Ok(())
}

/// Free ad-hoc signature. Does **not** require an Apple Developer Program membership.
/// Gatekeeper still prompts on first open of a downloaded .app; local helper
/// copies re-signed this way should not be intercepted when replacing Qx.app.
fn adhoc_codesign(path: &Path, deep: bool) -> Result<(), String> {
    let mut cmd = Command::new("/usr/bin/codesign");
    cmd.arg("--force").arg("--sign").arg("-");
    // Stable id so Gatekeeper can track the free ad-hoc identity across updates.
    cmd.arg("--identifier").arg("com.mcx.qx");
    if deep {
        cmd.arg("--deep");
        let entitlements = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("entitlements.plist");
        if entitlements.is_file() {
            cmd.arg("--entitlements").arg(entitlements);
        }
    }
    // Avoid network timestamp servers (would require a real identity).
    cmd.arg("--timestamp=none");
    cmd.arg(path);
    let output = cmd
        .output()
        .map_err(|e| format!("run codesign on {}: {e}", path.display()))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!(
            "codesign ad-hoc failed on {} with status {}",
            path.display(),
            output.status
        )
    } else {
        format!("codesign ad-hoc failed on {}: {stderr}", path.display())
    })
}

fn run_update_helper(args: &[String]) -> Result<(), String> {
    let pid = arg_value(args, "--pid")
        .ok_or_else(|| "missing --pid".to_string())?
        .parse::<i32>()
        .map_err(|e| format!("invalid --pid: {e}"))?;
    let version = arg_value(args, "--version");
    #[cfg(target_os = "windows")]
    if let Some(installer) = arg_value(args, "--windows-installer") {
        let target_exe = PathBuf::from(
            arg_value(args, "--target-app").ok_or_else(|| "missing --target-app".to_string())?,
        );
        return windows::run_update_helper(
            pid,
            version,
            &PathBuf::from(installer),
            &target_exe,
            args.iter().any(|arg| arg == "--restart"),
        );
    }
    let staged_app = PathBuf::from(
        arg_value(args, "--staged-app").ok_or_else(|| "missing --staged-app".to_string())?,
    );
    let target_app = PathBuf::from(
        arg_value(args, "--target-app").ok_or_else(|| "missing --target-app".to_string())?,
    );
    let backup_app = PathBuf::from(
        arg_value(args, "--backup-app").ok_or_else(|| "missing --backup-app".to_string())?,
    );
    let restart = args.iter().any(|arg| arg == "--restart");

    wait_for_process_exit(pid, Duration::from_secs(90))?;
    prepare_app_for_launch(&staged_app)?;
    replace_app_bundle(&staged_app, &target_app, &backup_app)?;
    if restart {
        Command::new("/usr/bin/open")
            .arg(&target_app)
            .spawn()
            .map_err(|e| format!("restart Qx: {e}"))?;
    }
    let _ = fs::remove_dir_all(&backup_app);
    // staged is .../updates/<ver>/staging/Qx.app — remove the whole version dir
    // (zip + empty staging). Previously only Qx.app was deleted, leaving ~15–30MB
    // zip + helper binaries forever under ~/.qx/cache/updates.
    if let Some(version_dir) = staged_app.parent().and_then(|p| p.parent()) {
        let _ = fs::remove_dir_all(version_dir);
    }
    let _ = write_helper_status(HelperStatus {
        ok: true,
        version: version.clone(),
        message: "Update installed and Qx relaunched.".to_string(),
        target_app: target_app.display().to_string(),
    });
    // Remove this helper binary and any other leftover helpers/zips.
    prune_update_cache(None);
    if let Ok(self_exe) = std::env::current_exe() {
        // Safe on macOS: the running image stays mapped after unlink.
        let _ = fs::remove_file(self_exe);
    }
    Ok(())
}

fn replace_app_bundle(
    staged_app: &Path,
    target_app: &Path,
    backup_app: &Path,
) -> Result<(), String> {
    if !staged_app.exists() {
        return Err(format!(
            "staged app does not exist: {}",
            staged_app.display()
        ));
    }
    if let Some(parent) = backup_app.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create backup dir: {e}"))?;
    }
    let _ = fs::remove_dir_all(backup_app);
    if target_app.exists() {
        fs::rename(target_app, backup_app).map_err(|e| {
            format!(
                "move current app {} to backup {}: {e}",
                target_app.display(),
                backup_app.display()
            )
        })?;
    }

    let copy_result = Command::new("/usr/bin/ditto")
        .arg(staged_app)
        .arg(target_app)
        .status();
    match copy_result {
        Ok(status) if status.success() => {
            if let Err(err) = prepare_app_for_launch(target_app) {
                rollback_app(target_app, backup_app);
                return Err(err);
            }
            let _ = fs::remove_dir_all(staged_app);
            Ok(())
        }
        Ok(status) => {
            rollback_app(target_app, backup_app);
            Err(format!("ditto failed with status {status}"))
        }
        Err(err) => {
            rollback_app(target_app, backup_app);
            Err(format!("run ditto: {err}"))
        }
    }
}

fn prepare_app_for_launch(app: &Path) -> Result<(), String> {
    // Recursively clear quarantine on the whole bundle (download provenance).
    let _ = Command::new("/usr/bin/xattr")
        .args(["-cr"])
        .arg(app)
        .status();
    clear_quarantine_xattr(app)?;
    ensure_bundle_executable_permission(app)?;
    // Free ad-hoc re-sign after ditto/unzip invalidates the previous seal.
    adhoc_codesign(app, true)?;
    Ok(())
}

fn clear_quarantine_xattr(app: &Path) -> Result<(), String> {
    let output = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(app)
        .output()
        .map_err(|e| format!("run xattr for {}: {e}", app.display()))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    // Already-clean trees often return non-zero if the attribute is missing — tolerate that.
    if stderr.contains("No such xattr") || stderr.contains("No such file") {
        return Ok(());
    }
    Err(if stderr.is_empty() {
        format!(
            "xattr failed to clear quarantine on {} with status {}",
            app.display(),
            output.status
        )
    } else {
        format!(
            "xattr failed to clear quarantine on {}: {stderr}",
            app.display()
        )
    })
}

fn ensure_bundle_executable_permission(app: &Path) -> Result<(), String> {
    let info_plist = app.join("Contents/Info.plist");
    let executable =
        plist_value(&info_plist, "CFBundleExecutable").unwrap_or_else(|_| "Qx".to_string());
    let executable_path = app.join("Contents/MacOS").join(&executable);
    if !executable_path.exists() {
        return Err(format!(
            "updated app is missing executable {}",
            executable_path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable_path, fs::Permissions::from_mode(0o755)).map_err(|e| {
            format!(
                "set executable permission on {}: {e}",
                executable_path.display()
            )
        })?;
    }
    Ok(())
}

fn rollback_app(target_app: &Path, backup_app: &Path) {
    let _ = fs::remove_dir_all(target_app);
    if backup_app.exists() {
        let _ = fs::rename(backup_app, target_app);
    }
}

fn wait_for_process_exit(pid: i32, timeout: Duration) -> Result<(), String> {
    // macOS double-⌘Q policy intercepts bare `app.exit` on older builds, so the
    // parent may stay alive after "install". Soft-signal after a short grace, then
    // hard-kill before giving up so bundle replace can proceed.
    let soft_after = Duration::from_secs(2);
    let hard_after = Duration::from_secs(8);
    let start = Instant::now();
    let mut sent_term = false;
    let mut sent_kill = false;
    while start.elapsed() < timeout {
        if !process_exists(pid) {
            return Ok(());
        }
        let elapsed = start.elapsed();
        if !sent_term && elapsed >= soft_after {
            let _ = signal_process(pid, SignalKind::Term);
            sent_term = true;
        }
        if !sent_kill && elapsed >= hard_after {
            let _ = signal_process(pid, SignalKind::Kill);
            sent_kill = true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    if !process_exists(pid) {
        return Ok(());
    }
    Err(format!("timed out waiting for process {pid} to exit"))
}

enum SignalKind {
    Term,
    Kill,
}

#[cfg(unix)]
fn signal_process(pid: i32, kind: SignalKind) -> Result<(), String> {
    let sig = match kind {
        SignalKind::Term => libc::SIGTERM,
        SignalKind::Kill => libc::SIGKILL,
    };
    let result = unsafe { libc::kill(pid, sig) };
    if result == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(format!("signal process {pid}: {err}"))
}

#[cfg(not(unix))]
fn signal_process(_pid: i32, _kind: SignalKind) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn process_exists(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(target_os = "windows")]
fn process_exists(pid: i32) -> bool {
    windows::process_exists(pid)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn process_exists(_pid: i32) -> bool {
    false
}

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == key)
        .map(|window| window[1].clone())
}

fn write_helper_status(status: HelperStatus) -> Result<(), String> {
    let path = update_cache_dir().join(STATUS_FILE);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create status dir: {e}"))?;
    }
    let json = serde_json::to_vec_pretty(&status).map_err(|e| format!("serialize status: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

fn current_app_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|value| value.to_str()) == Some("app") {
            return ancestor
                .canonicalize()
                .map_err(|e| format!("canonicalize app bundle: {e}"));
        }
    }
    Err("Qx is not running from a .app bundle".to_string())
}

#[cfg(target_os = "macos")]
fn install_location() -> Result<PathBuf, String> {
    current_app_bundle()
}

#[cfg(target_os = "windows")]
fn install_location() -> Result<PathBuf, String> {
    windows::install_location()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn install_location() -> Result<PathBuf, String> {
    Err("unsupported platform".to_string())
}

fn install_location_error() -> String {
    #[cfg(target_os = "macos")]
    return "Automatic replacement only works when Qx is running from a .app bundle.".to_string();
    #[cfg(target_os = "windows")]
    return "Automatic updates only work when Qx is running from the installed NSIS package."
        .to_string();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    "Automatic updates are not supported on this platform.".to_string()
}

#[cfg(test)]
#[path = "updater/tests.rs"]
mod tests;
