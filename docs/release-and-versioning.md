# 发布 / CI / 版本管理

## 版本单一来源

版本号在三个文件必须一致：

- `package.json` `"version"`
- `src-tauri/tauri.conf.json` `"version"`
- `src-tauri/Cargo.toml` `[package] version`

`Cargo.lock` 里的 `qx` 条目会自动跟随；改完 `Cargo.toml` 后跑一次 `cargo check` 就会同步。

规则：`0.<major>.<patch>`；`major` 是 feature 大更新，`patch` 是 bugfix / 小 tweak。目前处于 `0.4.x`。

## 发布流程

1. 完成一批变更 → `npm run build` + `cargo check` + `npx tsc --noEmit` 全绿
2. bump 上面 3 个文件的版本
3. `git commit -m "vX.Y.Z: <一句话总结>"`
4. `git tag -a vX.Y.Z -m "vX.Y.Z: ..."`
5. `git push && git push origin vX.Y.Z`
6. tag push 会触发 `.github/workflows/release-desktop.yml`

CI 只跑 macOS 14 (Apple Silicon) 一个 runner：

- 构建 `aarch64-apple-darwin` target 的 `.app` bundle
- `ditto` 打成 `qx_<tag>_aarch64-apple-darwin.app.zip`
- 上传为 GitHub release asset
- 触发 `mcxen/homebrew-qx` 的 `repository_dispatch` 事件（`event_type=qx-release`），带上版本号和 SHA256

Homebrew tap (`mcxen/homebrew-qx`) 收到 dispatch 后会自动更新 Formula 并 push。用户 `brew upgrade --cask qx` 就能拿到新版。

## 未做的事

- **代码签名 / notarization**：未接入 Apple Developer ID。用户首次打开需要右键 → 打开绕过 Gatekeeper。
- **auto-updater**：`tauri-plugin-updater` 已加依赖但 endpoint / pubkey 未配置，前端不会自检更新。
- **Intel + Linux + Windows**：暂无 runner，用户需自己 `git clone && npm run tauri build`。
- **Prerelease channel**：`workflow_dispatch` 支持 `prerelease: true` 输入但流程没差别。
- **CHANGELOG**：靠 `TASK.md` 追踪，未生成用户面向的 CHANGELOG.md。

## Homebrew Cask

远端仓库：`mcxen/homebrew-qx`

用户装法：

```
brew tap mcxen/qx
brew install --cask qx
```

Cask 的 SHA256 只对应 `_aarch64-apple-darwin.app.zip`，装到非 M 系列 Mac 会失败。

## 本地手工发一次

万一 CI 挂了：

```bash
npm run tauri build -- --target aarch64-apple-darwin --bundles app
cd src-tauri/target/aarch64-apple-darwin/release/bundle/macos
ditto -c -k --sequesterRsrc --keepParent Qx.app qx_v0.X.Y_aarch64-apple-darwin.app.zip
gh release upload v0.X.Y qx_*.zip
shasum -a 256 qx_*.zip
```

拿到 SHA256 后手动编辑 `homebrew-qx/Casks/qx.rb` 提交。

## Pre-flight checklist

发版前跑一遍：

- [ ] `npx tsc --noEmit` 无 error
- [ ] `npm run build` 通过
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过（warning 允许）
- [ ] `npm run tauri dev` 能启动、能显示 launcher、能搜到 app、Esc 能隐藏
- [ ] 若改了 plugin runtime / settings schema，测试至少 3 个内置 module 面板还能进
- [ ] `git status` 干净，`package.json` / `tauri.conf.json` / `Cargo.toml` 三处版本一致
- [ ] Tag message 描述用户可见变更，不要写内部改动

## 相关文件

- `.github/workflows/release-desktop.yml` — release CI 定义
- `src-tauri/tauri.conf.json` `bundle.macOS.*` — bundle 配置（icon、identifier、entitlements）
- `src-tauri/entitlements.plist` — macOS entitlements（screen recording、accessibility 等）
- `AGENTS.md` — 一致性检查与流程约束
