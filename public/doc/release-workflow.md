# Qx Release Workflow

This is the canonical public workflow for releasing the Qx desktop clients.
Plugin packaging and marketplace publication are separate and live in
[`plugin-marketplace.md`](./plugin-marketplace.md). `AGENTS.md` keeps only the
short execution checklist and links back to this workflow.

## Scope

Only run this flow when the user explicitly asks to release, tag, publish, or
push a version. Do not move an already-pushed tag unless the user explicitly
asks to rewrite release history.

## Preflight

1. Inspect the worktree.

```bash
git status --short
git diff --stat
```

Review tracked and untracked files. Preserve existing user or concurrent
changes. If a dirty file is unrelated to the release, leave it alone.

2. Find the next unused version.

```bash
git tag --list 'v*' --sort=-version:refname
git ls-remote --tags origin 'v*'
```

If local and remote differ, choose the next version above both. In the v0.4.48
release, local had `v0.4.47` while remote only showed through `v0.4.46`, so the
safe next version was `v0.4.48`.

## Version Sync

Update all release version files together:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `README.md`

Use `0.X.Y` in package and Tauri files, and `v0.X.Y` in human-facing README
status lines.

Verify there are no stale old-version references in those release files:

```bash
rg -n '0\.X\.OLD|v0\.X\.OLD|0\.X\.Y|v0\.X\.Y' \
  package.json package-lock.json \
  src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md
```

## Validation

Run the smallest useful release validation set:

```bash
npx tsc --noEmit
npm run build
cargo fmt --check
cargo check
```

Run Rust commands from `src-tauri/`.

If UI controls changed, also scan for visible native controls:

```bash
rg '<select|type="range"|type="checkbox"|type="radio"' src
```

A hit in Markdown-rendered content, such as `.qx-md-body li input[type="checkbox"]`,
is not a product control violation by itself. Report it as a non-blocking scan
result.

Known release warnings are acceptable if they are pre-existing and not related
to the change. For v0.4.48, `cargo check` passed with existing warnings in
`rss/fetcher.rs`, `system_stats.rs`, and `v2ex.rs`.

## Commit And Tag

Stage only the release-related files:

```bash
git add <files>
git diff --cached --check
git diff --cached --stat
git commit -m "vX.Y.Z: <summary>"
```

Create the tag only after the commit succeeds:

```bash
git tag --list 'vX.Y.Z'
git tag vX.Y.Z
```

Use a lightweight tag unless the project explicitly switches to annotated tags.
The repository has historically used lightweight tags for several releases.

## Push

Try the configured remote first:

```bash
git push origin main
git push origin vX.Y.Z

# CNB 不会因为 GitHub Release 自动触发；必须推送同一个 Tag。
git push cnb vX.Y.Z
```

CNB 只需要这个 release Tag，不要为了触发镜像而把 `main` 推到 CNB。推送顺序应保持为：
先推 release remote 的分支和 Tag，再推 CNB 的同名 Tag。这样 `.cnb.yml` 的
`tag_push` 会使用同一提交，并等待 GitHub 桌面端 Release 产物准备完成。

If `origin` is HTTPS and push fails with:

```text
fatal: could not read Username for 'https://github.com': Device not configured
```

check whether GitHub CLI or SSH can authenticate:

```bash
git remote -v
gh auth status
ssh -T git@github.com
ssh -T -p 443 git@ssh.github.com
```

Common outcomes:

- `gh auth status` may show an invalid token. Do not start an interactive auth
  flow unless the user asks.
- SSH on port 22 may be blocked.
- GitHub SSH over port 443 can still work. A successful test prints:
  `Hi <user>! You've successfully authenticated, but GitHub does not provide shell access.`

When SSH-over-443 works, push without changing `origin`:

```bash
git push ssh://git@ssh.github.com:443/<owner>/<repo>.git main
git push ssh://git@ssh.github.com:443/<owner>/<repo>.git vX.Y.Z
```

For Qx, the current repository URL is:

```bash
ssh://git@ssh.github.com:443/mcxen/qx.git
```

## Remote Confirmation

Confirm the pushed branch and tag point to the release commit:

```bash
git ls-remote ssh://git@ssh.github.com:443/mcxen/qx.git main 'refs/tags/vX.Y.Z'
```

Use SSH for confirmation if HTTPS is failing or rate-limited. GitHub unauthenticated
API calls may return rate-limit errors, and HTTPS `git ls-remote` can fail with
SSL errors even after an SSH push succeeded.

Expected successful confirmation shape:

```text
<commit-sha> refs/heads/main
<commit-sha> refs/tags/vX.Y.Z
```

同时确认 CNB 的 Tag：

```bash
git ls-remote cnb refs/tags/vX.Y.Z
```

两个远端的 Tag 必须解析到同一个 commit SHA。只确认 GitHub 的 Tag 不足以证明
CNB 镜像流水线已经触发。

## GitHub Actions And Release Artifacts

The tag push should trigger the release workflow. If API access is available,
check:

```bash
curl -sS 'https://api.github.com/repos/mcxen/qx/actions/runs?per_page=5'
curl -sS 'https://api.github.com/repos/mcxen/qx/releases/tags/vX.Y.Z'
```

Quote URLs containing `?` in zsh. If unauthenticated GitHub API rate limits block
the check, report that the branch and tag were confirmed by `git ls-remote` and
that Actions/Release artifact confirmation could not be completed from the
current environment.

The release assets must include all of:

- `qx_vX.Y.Z_aarch64-apple-darwin.app.zip`
- `qx_vX.Y.Z_aarch64-apple-darwin.dmg` (drag-to-Applications installer with
  `Read Me.html`, `install.sh`, and the quarantine guidance)
- `Qx_X.Y.Z_x64-setup.exe`
- `latest.json`

The DMG is the user-facing macOS installer. The updater continues to use the
`.app.zip` artifact because `latest.json` intentionally points at a package
with stable updater semantics. `scripts/create-macos-dmg.sh` keeps the Finder
layout and installer guidance reproducible in CI; `scripts/dmg-install.sh`
copies the app to `/Applications` (or `~/Applications` when needed) and only
removes the `com.apple.quarantine` extended attribute.

### Windows in-place upgrades

The bundled Everything engine is a long-running Qx-specific instance and can
hold `resources/search/everything.exe` open while an installer upgrades the app.
`src-tauri/windows/hooks.nsh` must stop only the `Qx` instance and remove its
indexing service in `NSIS_HOOK_PREINSTALL` before NSIS copies files. The
pre-install hook explains that this is Qx's private search engine, asks the
service to stop, and probes write access to the executable for up to 65 seconds;
Everything service removal can return before Windows releases the image. If the
file is still locked, abort with a clear retry message instead of leaving a
partially upgraded installation. The post-install hook reinstalls the service.
Keep the same cleanup in
`NSIS_HOOK_PREUNINSTALL`; never use a broad `taskkill` that would terminate a
user's unrelated Everything installation. Runtime file search must likewise use
only Qx's bundled `everything.exe` and `es.exe`; a missing bundle is an
unavailable Qx search engine, not permission to fall back to binaries under the
user's system-wide Everything installation.

`latest.json` is the app updater manifest. Its legacy top-level fields continue
to point at the ARM64 app zip for older macOS clients. Its `artifacts[]` must also
contain both the ARM64 app zip and Windows x64 NSIS installer, each with matching
target, SHA256, and size. The release workflow generates it before uploading
`release-assets/*`. The app checks it through the API-free stable URL
`https://github.com/mcxen/qx/releases/latest/download/latest.json`, which GitHub
redirects to the latest published release. The updater selects only the artifact
for its compiled target. If that artifact is missing or invalid, update discovery
fails safely because the app cannot identify and verify the platform package.

### Optional China WebDAV mirror

The same release workflow can mirror every GitHub Release to an HTTPS WebDAV
origin. Configure these repository Actions settings:

- Secret `WEBDAV_UPLOAD_BASE`: writable WebDAV collection root, for example
  `https://dav.example.cn/dav/qx`.
- Secrets `WEBDAV_USERNAME` and `WEBDAV_PASSWORD`: a least-privilege publishing
  account. They are used only by Actions and must never be embedded in Qx.
- Variable `QX_UPDATE_MIRROR_MANIFEST_URL`: anonymous, public HTTPS download URL
  ending in `/latest.json`, for example
  `https://download.example.cn/qx/latest.json`.

All four values absent means the mirror is intentionally disabled. A partial
configuration fails the publish job instead of silently producing an incomplete
mirror. The WebDAV root must exist; the workflow creates or reuses its
`releases/` collection.

The workflow uploads the macOS and Windows versioned assets first, rewrites a
mirror-specific manifest with public download URLs, uploads a versioned
`releases/vX.Y.Z.json`, and replaces the stable `latest.json` last. Prereleases
are mirrored but never replace the stable pointer. A mirror failure does not
remove the GitHub Release that was already published, and rerunning the workflow
is safe because the same versioned files are overwritten.

`QX_UPDATE_MIRROR_MANIFEST_URL` is also injected when the desktop binaries are
built. A configured client checks that mirror first and falls back to GitHub if
the mirror request or manifest validation fails. Mirror assets are accepted only
over HTTPS, from the manifest's exact origin, and at the sibling
`releases/<asset_name>` path. The public mirror must therefore allow anonymous
GET requests without expiring share tokens; WebDAV credentials remain
write-only release infrastructure.

### CNB domestic release mirror

The repository also contains a `.cnb.yml` pipeline for CNB. The release process
must push the same `v*` Tag to the `cnb` remote after pushing it to the release
remote. A GitHub tag or GitHub Release alone does not create a CNB `tag_push`
event. Once the CNB Tag exists, CNB waits for the GitHub desktop release to
finish, downloads the exact same artifacts, creates the matching CNB Release,
and uploads the packages plus `latest.json` with `cnbcool/attachments`. This
avoids rebuilding native macOS and Windows clients on a Linux runner and keeps
checksums identical.

Qx defaults to automatic source selection and compares the stable CNB manifest,
the optional configured mirror, and GitHub:
`https://cnb.cool/v.ip/Qx/-/releases/latest/download/latest.json`. If CNB is
unavailable or has an older valid manifest, the updater continues through the
other sources and chooses the newest valid release. The About panel can also
pin checks to CNB or GitHub. All requests run in the existing
background update task; no update-network request runs on the UI thread.

On Windows, the detached updater helper waits for Qx to exit and starts the NSIS
installer silently through the native elevation verb. A per-machine install can
show UAC; cancellation is treated as a failed update. The helper relaunches Qx
only after NSIS exits successfully. Do not bypass the existing NSIS hooks: they
stop only Qx's private Everything instance and protect in-place replacement from
Windows file locks.

`qx_update_download_and_install` only starts a background download/stage job and
returns immediately so the main app stays interactive. When the package is
ready, the always-on-top **update-progress** window (non-activating) shows
**Install & Restart**. Only `qx_update_apply_and_restart` spawns the helper and
quits Qx. The window label must stay in `src-tauri/capabilities/default.json`;
the UI also polls `qx_update_progress_snapshot` as a progress fallback.

When the same automatic-update setting is enabled, installed community plugins
use the separate marketplace lane described in
[`plugin-marketplace.md`](./plugin-marketplace.md#52-已安装插件更新检查与升级). That lane selects only
packages compatible with the running Qx build and platform, verifies the
marketplace metadata and package manifest, and isolates per-plugin failures; it
does not alter the Qx binary release asset or require a manual plugin update.
The installed list can still check the marketplace catalog and offer a manual
upgrade when automatic installation is off.

## Dirty Files After Push

After pushing, run:

```bash
git status --short
```

If new local changes appear after the tag has already been pushed, do not amend
the release commit and do not move the tag. Inspect the diff, mention the dirty
files in the final report, and leave them for a later commit unless the user
explicitly asks to publish a follow-up release or rewrite history.

This happened after v0.4.48: `README.md` had new uncommitted documentation edits
after `main` and `v0.4.48` were already pushed. The correct behavior was to leave
the pushed release intact.
