$ErrorActionPreference = 'Stop'
$qxRepo = Split-Path -Parent $PSScriptRoot
$qxMsvc = Join-Path $env:USERPROFILE '.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin'
if (-not (Test-Path -LiteralPath (Join-Path $qxMsvc 'cargo.exe'))) {
    throw 'Windows window ablation requires the stable MSVC toolchain'
}
$qxPreviousPath = $env:Path
Push-Location (Join-Path $qxRepo 'src-tauri')
try {
    $env:Path = "$qxMsvc;$env:Path"
    # Cargo examples do not inherit the app executable's Common Controls/DPI
    # manifest. Embed the same platform requirements without changing Qx's bundle.
    & cargo.exe rustc --release --example window_lifecycle_probe -- `
        -C link-arg=/MANIFEST:EMBED `
        -C link-arg=/MANIFESTINPUT:examples/window_lifecycle_probe.manifest
    if ($LASTEXITCODE -ne 0) { throw 'Window ablation build failed' }
    & './target/release/examples/window_lifecycle_probe.exe'
    if ($LASTEXITCODE -ne 0) { throw "Window ablation failed with exit code $LASTEXITCODE" }
} finally {
    $env:Path = $qxPreviousPath
    Pop-Location
}
