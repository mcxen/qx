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
- 生成 `latest.json` updater manifest，记录版本、zip URL、SHA256 和 size
- 上传为 GitHub release asset
- 触发 `mcxen/homebrew-qx` 的 `repository_dispatch` 事件（`event_type=qx-release`），带上版本号和 SHA256

Homebrew tap (`mcxen/homebrew-qx`) 收到 dispatch 后会自动更新 Formula 并 push。用户 `brew upgrade --cask qx` 就能拿到新版。

## 自动更新

Qx 使用自定义 macOS helper 更新，不依赖 Tauri signed updater：

- 前端通过 `qx_update_check` 读取 GitHub latest release。
- Release 里优先使用 `latest.json`，fallback 到 `_aarch64-apple-darwin.app.zip` asset。
- 只有 SHA256 存在且当前运行位置是 `.app` bundle 时才允许自动安装。
- `qx_update_download_and_install` 下载 zip、校验 SHA256 和 size、解压到 staging。
- **签名策略（不买 Apple 开发者账号）**：
  - CI 与本地均使用 **ad-hoc** `codesign --sign -`（免费，非公证）。
  - 从 `Qx.app` 复制出的 update helper 必须再次：去 quarantine（`xattr -cr`）+ ad-hoc 重签，否则 Gatekeeper 会拦截 helper 进程。
  - 解压后的 staging `Qx.app` 与替换后的目标 bundle 同样清理 xattr 并 ad-hoc 重签。
- 主程序退出后，helper 用 `ditto` 替换目标 `Qx.app`，再通过 `/usr/bin/open` 重启。

### 更新缓存路径与清理

工作目录：`~/.qx/cache/updates/`

| 产物 | 说明 |
|------|------|
| `<version>/Qx.app.zip` | 下载的安装包 |
| `<version>/staging/Qx.app` | 解压后的待替换 bundle |
| `qx-update-helper-<pid>` | 从当前进程复制的 helper 二进制 |
| `backup-Qx-<version>.app` | 替换时临时备份（成功后删除） |
| `last-update-status.json` | 最近一次 helper 结果 |

**历史问题**：旧逻辑成功后只删 `staging/Qx.app`，zip 与 helper 二进制会一直堆在磁盘上（每次约 15–30MB+）。

**当前清理策略**（`updater.rs`）：

1. 下载新版本前 `prune_update_cache`，去掉其它版本与 orphan helper  
2. helper 成功替换后删除整个 `<version>/` 目录 + 删除自身 helper 文件  
3. 普通启动时也会 prune orphan（保留 status 文件）  
4. Settings 存储清理的 cache 桶包含 `~/.qx/cache/updates`

用户在 Settings 里打开 `Automatically install updates` 后，启动时会后台检查并自动下载可安装版本；About 页面也可以手动检查和安装。

## 未做的事

- **Apple Developer ID / notarization**：故意不接入（不付费）。用 **ad-hoc 签名** 保证本地 helper 与覆盖安装可执行；用户从网上下载的首次打开仍可能要「右键 → 打开」。
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

如果手工发版也要支持应用内自动更新，同时上传同版本 `latest.json`，字段至少包含：

```json
{
  "version": "0.X.Y",
  "tag": "v0.X.Y",
  "platform": "macos",
  "target": "aarch64-apple-darwin",
  "asset_name": "qx_v0.X.Y_aarch64-apple-darwin.app.zip",
  "asset_url": "https://github.com/mcxen/qx/releases/download/v0.X.Y/qx_v0.X.Y_aarch64-apple-darwin.app.zip",
  "sha256": "<zip-sha256>",
  "size": 12345678
}
```

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
- `src-tauri/src/updater.rs` — 应用内更新检查、下载、helper 替换逻辑
- `src-tauri/tauri.conf.json` `bundle.macOS.*` — bundle 配置（icon、identifier、entitlements）
- `src-tauri/entitlements.plist` — macOS entitlements（screen recording、accessibility 等）
- `AGENTS.md` — 一致性检查与流程约束
