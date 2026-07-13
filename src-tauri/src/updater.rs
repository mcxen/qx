use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const GITHUB_LATEST_MANIFEST: &str =
    "https://github.com/mcxen/qx/releases/latest/download/latest.json";
const GITHUB_RELEASE_DOWNLOAD_BASE: &str = "https://github.com/mcxen/qx/releases/download";
const GITHUB_RELEASE_TAG_BASE: &str = "https://github.com/mcxen/qx/releases/tag";
const UPDATE_TARGET: &str = "aarch64-apple-darwin";
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

        let target_app = current_app_bundle()?;
        let staged = download_and_stage(&latest_version, &asset_url, &expected_sha, update.size)?;
        validate_staged_app(&staged, &target_app, &latest_version)?;
        let helper = spawn_update_helper(&staged, &target_app, &latest_version)?;

        Ok(QxUpdateInstallResult {
            version: latest_version,
            staged_app: staged.display().to_string(),
            target_app: target_app.display().to_string(),
            helper_path: helper.display().to_string(),
            message: "Update staged. Qx will quit, replace the app bundle, and relaunch."
                .to_string(),
        })
    })
    .await
    .map_err(|e| format!("update install task failed: {e}"))??;

    let app_for_exit = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(350));
        app_for_exit.exit(0);
    });

    Ok(result)
}

pub(crate) fn maybe_run_update_helper_from_args() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some(HELPER_FLAG) {
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
    }
    true
}

fn check_for_update(current_version: &str) -> Result<QxUpdateInfo, String> {
    check_for_update_via_latest_manifest(current_version)
}

fn check_for_update_via_latest_manifest(current_version: &str) -> Result<QxUpdateInfo, String> {
    let manifest: QxUpdateManifest = http_client()?
        .get(GITHUB_LATEST_MANIFEST)
        .send()
        .map_err(|e| format!("fetch latest update manifest: {e}"))?
        .error_for_status()
        .map_err(|e| format!("fetch latest update manifest: {e}"))?
        .json()
        .map_err(|e| format!("parse latest update manifest: {e}"))?;

    update_info_from_manifest(current_version, manifest)
}

fn update_info_from_manifest(
    current_version: &str,
    manifest: QxUpdateManifest,
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

    let target_matches =
        manifest.target.trim().is_empty() || manifest.target.trim() == UPDATE_TARGET;
    let platform_matches =
        manifest.platform.trim().is_empty() || manifest.platform.trim() == "macos";
    let (asset_name, asset_url, sha256, size) = if target_matches && platform_matches {
        let asset_name = if manifest.asset_name.trim().is_empty() {
            format!("qx_v{}_{}.app.zip", latest_version, UPDATE_TARGET)
        } else {
            manifest.asset_name.trim().to_string()
        };
        let asset_url = if manifest.asset_url.trim().is_empty() {
            format!("{GITHUB_RELEASE_DOWNLOAD_BASE}/{tag}/{asset_name}")
        } else {
            manifest.asset_url.trim().to_string()
        };
        validate_release_asset_url(&asset_url, &tag, &asset_name)?;
        (
            Some(asset_name),
            Some(asset_url),
            Some(normalize_sha256(&manifest.sha256)).filter(|value| !value.trim().is_empty()),
            manifest.size,
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

fn validate_release_asset_url(url: &str, tag: &str, asset_name: &str) -> Result<(), String> {
    if tag.contains(['/', '\\']) || asset_name.contains(['/', '\\']) {
        return Err("update manifest contains an invalid tag or asset name".to_string());
    }
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid update asset URL: {e}"))?;
    let expected_path = format!("/mcxen/qx/releases/download/{tag}/{asset_name}");
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
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
    } else if cfg!(not(target_os = "macos")) {
        (
            false,
            Some("Automatic app replacement is currently supported on macOS only.".to_string()),
        )
    } else if asset_url.is_none() {
        (
            false,
            Some("No macOS app zip asset was found on the latest release.".to_string()),
        )
    } else if sha256.map(String::as_str).unwrap_or_default().len() != 64 {
        (
            false,
            Some(
                "Latest release has no SHA256 manifest; open GitHub Releases to install manually."
                    .to_string(),
            ),
        )
    } else if current_app_bundle().is_err() {
        (
            false,
            Some(
                "Automatic replacement only works when Qx is running from a .app bundle."
                    .to_string(),
            ),
        )
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

fn download_and_stage(
    version: &str,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<PathBuf, String> {
    let update_dir = update_cache_dir().join(version);
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

    let mut response = http_client()?
        .get(asset_url)
        .send()
        .map_err(|e| format!("download update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download update: {e}"))?;

    let mut file = fs::File::create(&download_path)
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

    unzip_app(&download_path, &staging_root)?;
    let staged_app = staging_root.join("Qx.app");
    if !staged_app.exists() {
        return Err("update archive did not contain Qx.app".to_string());
    }
    Ok(staged_app)
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
    let helper_path = update_cache_dir().join(format!("qx-update-helper-{}", std::process::id()));
    let current_exe = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    fs::copy(&current_exe, &helper_path).map_err(|e| {
        format!(
            "copy update helper from {} to {}: {e}",
            current_exe.display(),
            helper_path.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&helper_path, fs::Permissions::from_mode(0o755));
    }

    let backup_app = update_cache_dir().join(format!("backup-Qx-{version}.app"));
    Command::new(&helper_path)
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
        .arg(backup_app)
        .arg("--restart")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn update helper: {e}"))?;
    Ok(helper_path)
}

fn run_update_helper(args: &[String]) -> Result<(), String> {
    let pid = arg_value(args, "--pid")
        .ok_or_else(|| "missing --pid".to_string())?
        .parse::<i32>()
        .map_err(|e| format!("invalid --pid: {e}"))?;
    let version = arg_value(args, "--version");
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
    let _ = write_helper_status(HelperStatus {
        ok: true,
        version,
        message: "Update installed and Qx relaunched.".to_string(),
        target_app: target_app.display().to_string(),
    });
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
    clear_quarantine_xattr(app)?;
    ensure_bundle_executable_permission(app)
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
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !process_exists(pid) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!("timed out waiting for process {pid} to exit"))
}

#[cfg(unix)]
fn process_exists(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(not(unix))]
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

fn update_cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(home).join(".qx/cache/updates");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn current_binary_name() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("resolve current exe: {e}"))?
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .ok_or_else(|| "current executable has no valid filename".to_string())
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

fn compare_versions(left: &str, right: &str) -> i32 {
    let a = version_parts(left);
    let b = version_parts(right);
    let len = a.len().max(b.len());
    for index in 0..len {
        let diff =
            a.get(index).copied().unwrap_or(0) as i32 - b.get(index).copied().unwrap_or(0) as i32;
        if diff != 0 {
            return diff;
        }
    }
    0
}

fn version_parts(version: &str) -> Vec<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::net::TcpListener;
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
        let info = update_info_from_manifest(
            "0.4.48",
            QxUpdateManifest {
                version: "0.5.3".to_string(),
                tag: "v0.5.3".to_string(),
                platform: "macos".to_string(),
                target: UPDATE_TARGET.to_string(),
                asset_name: "qx_v0.5.3_aarch64-apple-darwin.app.zip".to_string(),
                asset_url: "https://github.com/mcxen/qx/releases/download/v0.5.3/qx_v0.5.3_aarch64-apple-darwin.app.zip".to_string(),
                sha256:
                    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
                        .to_string(),
                size: Some(200),
            },
        )
        .expect("manifest should resolve");

        assert!(info.available);
        assert_eq!(info.latest_version.as_deref(), Some("0.5.3"));
        assert_eq!(
            info.asset_name.as_deref(),
            Some("qx_v0.5.3_aarch64-apple-darwin.app.zip")
        );
        assert_eq!(
            info.asset_url.as_deref(),
            Some("https://github.com/mcxen/qx/releases/download/v0.5.3/qx_v0.5.3_aarch64-apple-darwin.app.zip")
        );
        assert_eq!(info.size, Some(200));
    }

    #[test]
    fn constructs_versioned_asset_url_when_manifest_omits_it() {
        let info = update_info_from_manifest(
            "0.5.3",
            QxUpdateManifest {
                version: "0.5.3".to_string(),
                tag: String::new(),
                platform: "macos".to_string(),
                target: UPDATE_TARGET.to_string(),
                asset_name: String::new(),
                asset_url: String::new(),
                sha256: String::new(),
                size: None,
            },
        )
        .expect("manifest defaults should resolve");

        assert_eq!(
            info.asset_url.as_deref(),
            Some("https://github.com/mcxen/qx/releases/download/v0.5.3/qx_v0.5.3_aarch64-apple-darwin.app.zip")
        );
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

        let staged =
            download_and_stage_in_dir(root.join("cache/0.0.test"), &url, &sha256, Some(size))
                .expect("download and stage");

        assert!(staged.ends_with("Qx.app"));
        assert_eq!(
            fs::read(staged.join("Contents/MacOS/Qx")).expect("read staged executable"),
            b"downloaded"
        );

        let _ = fs::remove_dir_all(root);
    }

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

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{prefix}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
