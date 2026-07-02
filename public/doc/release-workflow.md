# Qx Release Workflow

This document records the practical release flow agents should use when asked to
commit, tag, or publish Qx. It complements the short checklist in `AGENTS.md`.

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
```

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
